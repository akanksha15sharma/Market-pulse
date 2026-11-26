import { NotificationItem } from '../features/notifications/NotificationItem';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import type {
  NotificationHistory,
  NotificationPreferences,
  NotificationQuery,
} from '@marketpulse/contracts';
import { ApiError } from '../lib/api-client';
import { useNotifications } from '../features/notifications/context';
import {
  loadNotifications,
  loadNotificationPreferences,
  saveNotificationPreferences,
  markAllNotificationsRead,
} from '../features/notifications/api';

type Perform = (
  action: () => Promise<void>,
  message: string,
  reload?: boolean,
) => Promise<void>;

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="market-error" role="alert">
      <p>{message}</p>
      <button type="button" className="secondary-button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
function NotificationHistoryList({
  filter,
  busy,
  perform,
}: {
  filter: NotificationQuery['filter'];
  busy: boolean;
  perform: Perform;
}) {
  const { expire } = useNotifications();
  const [state, setState] = useState<{
    data: NotificationHistory | null;
    loading: boolean;
    error: string;
    moreError: string;
  }>({ data: null, loading: true, error: '', moreError: '' });
  const [retry, setRetry] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setState({ data: null, loading: true, error: '', moreError: '' });
      try {
        const data = await loadNotifications({ filter }, controller.signal);
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: '', moreError: '' });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          expire();
          return;
        }
        setState({
          data: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Could not load notifications.',
          moreError: '',
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [filter, retry, expire]);
  // Unmounting/filter changes must also discard an outstanding older-page response.
  const [lifetime] = useState(() => ({ active: true }));
  useEffect(() => {
    lifetime.active = true;
    return () => {
      lifetime.active = false;
    };
  }, [lifetime]);
  async function more() {
    if (!state.data?.nextCursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const next = await loadNotifications({
        filter,
        cursor: state.data.nextCursor,
      });
      if (lifetime.active)
        setState((previous) => ({
          data: {
            ...next,
            notifications: [
              ...(previous.data?.notifications ?? []),
              ...next.notifications,
            ].filter(
              (row, index, rows) =>
                rows.findIndex((item) => item.id === row.id) === index,
            ),
          },
          loading: false,
          error: '',
          moreError: '',
        }));
    } catch (error) {
      if (!lifetime.active) return;
      if (error instanceof ApiError && error.status === 401) expire();
      else
        setState((previous) => ({
          ...previous,
          moreError:
            error instanceof Error
              ? error.message
              : 'Could not load more notifications.',
        }));
    } finally {
      if (lifetime.active) setMoreBusy(false);
    }
  }
  if (state.loading)
    return (
      <p className="notification-empty muted" role="status">
        Loading notifications…
      </p>
    );
  if (state.error)
    return (
      <Failure
        message={state.error}
        retry={() => setRetry((value) => value + 1)}
      />
    );
  return (
    <>
      {!state.data?.notifications.length ? (
        <div className="notification-empty">
          <h2>
            {filter === 'all'
              ? 'You’re all caught up.'
              : `No ${filter} notifications.`}
          </h2>
          <p className="muted">
            Genuine account and watchlist activity will appear here. Native
            price alerts remain unavailable.
          </p>
        </div>
      ) : (
        <ul className="notification-list" aria-label="Notification history">
          {state.data.notifications.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              busy={busy}
              perform={perform}
            />
          ))}
        </ul>
      )}
      {state.moreError && (
        <Failure
          message={state.moreError}
          retry={() => {
            void more();
          }}
        />
      )}
      {state.data?.nextCursor && (
        <div className="notification-pagination">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || moreBusy}
            onClick={() => {
              void more();
            }}
          >
            {moreBusy ? 'Loading more…' : 'Load more notifications'}
          </button>
          <p className="muted">New activity appears when you refresh.</p>
        </div>
      )}
    </>
  );
}

function Preferences({ busy, perform }: { busy: boolean; perform: Perform }) {
  const { expire } = useNotifications();
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError('');
      try {
        const value = await loadNotificationPreferences(controller.signal);
        if (!controller.signal.aborted) setPreferences(value);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          expire();
          return;
        }
        setError(
          error instanceof Error
            ? error.message
            : 'Could not load preferences.',
        );
      }
    }
    void load();
    return () => controller.abort();
  }, [retry, expire]);
  return (
    <section
      className="market-panel notification-preferences"
      aria-labelledby="notification-preferences-title"
    >
      <h2 id="notification-preferences-title">Notification preferences</h2>
      <p className="muted">
        Choose which future activity appears in your inbox. Existing history
        stays available.
      </p>
      {error ? (
        <Failure message={error} retry={() => setRetry((value) => value + 1)} />
      ) : !preferences ? (
        <p role="status">Loading preferences…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              setPreferences(
                await saveNotificationPreferences({
                  accountActivityEnabled: preferences.accountActivityEnabled,
                  watchlistActivityEnabled:
                    preferences.watchlistActivityEnabled,
                }),
              );
            }, 'Notification preferences saved.');
          }}
        >
          <fieldset disabled={busy}>
            <legend className="sr-only">Optional activity notifications</legend>
            <label>
              <input
                type="checkbox"
                checked={preferences.accountActivityEnabled}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    accountActivityEnabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Account activity</strong>
                <span className="muted">
                  Account creation and successful sign-ins.
                </span>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={preferences.watchlistActivityEnabled}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    watchlistActivityEnabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Watchlist activity</strong>
                <span className="muted">
                  List changes and assets added or removed.
                </span>
              </span>
            </label>
            <p className="notification-security muted">
              Security notifications always stay on, including password resets,
              email verification, and session revocation. These settings do not
              enable price alerts or email delivery.
            </p>
            <button type="submit" className="primary-button">
              {busy ? 'Please wait…' : 'Save preferences'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
function Inbox() {
  const { refresh, expire, unreadCount } = useNotifications();
  const [filter, setFilter] = useState<NotificationQuery['filter']>('all');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const perform: Perform = async (action, success, reload = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      if (reload) setVersion((value) => value + 1);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        expire();
        return;
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to save changes. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="market-dashboard notifications-page">
      <div className="market-heading">
        <div>
          <p className="eyebrow">Your private activity</p>
          <h1>Notifications</h1>
          <p className="market-subtitle">
            Account updates and watchlist activity, all in one place.
          </p>
        </div>
        <span className="notification-count">{unreadCount} unread</span>
      </div>
      <p role="status" className="notification-feedback" aria-live="polite">
        {message || (busy ? 'Saving changes…' : '')}
      </p>
      {error && (
        <p className="market-error" role="alert">
          {error}
        </p>
      )}
      <section className="market-panel" aria-label="Your notifications">
        <div className="notification-toolbar">
          <div
            className="market-tabs"
            role="group"
            aria-label="Filter notifications"
          >
            {(['all', 'unread', 'read'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                disabled={busy}
                onClick={() => {
                  setFilter(value);
                  setError('');
                }}
              >
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div className="notification-controls">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setVersion((value) => value + 1);
                refresh();
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || unreadCount === 0}
              onClick={() => {
                void perform(
                  async () => {
                    await markAllNotificationsRead();
                  },
                  'Existing notifications marked as read.',
                  true,
                );
              }}
            >
              Mark all as read
            </button>
          </div>
        </div>
        <NotificationHistoryList
          key={`${filter}:${version}`}
          filter={filter}
          busy={busy}
          perform={perform}
        />
      </section>
      <Preferences busy={busy} perform={perform} />
    </div>
  );
}
export function NotificationsPage() {
  const { status, revision, refresh } = useNotifications();
  if (status === 'guest') return <Navigate to="/login" replace />;
  if (status === 'loading')
    return (
      <section>
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <p role="status" className="notification-empty muted">
          Loading your private inbox…
        </p>
      </section>
    );
  if (status === 'error')
    return (
      <section>
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <Failure
          message="Could not load your inbox. Please try again."
          retry={refresh}
        />
      </section>
    );
  if (status === 'disabled')
    return (
      <section>
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <p className="notification-empty muted">
          Notifications are currently unavailable.
        </p>
      </section>
    );
  return <Inbox key={revision} />;
}
