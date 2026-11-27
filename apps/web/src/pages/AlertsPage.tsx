import { useEffect, useState } from 'react';
import {
  Link,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from 'react-router';
import { ALERT_ACTIVE_LIMIT } from '@marketpulse/contracts';
import { loadOverview } from '../features/markets/api';
import { useMarketResource } from '../features/markets/use-market-resource';
import {
  MarketSourcePolicy,
  MarketLoading,
  ResourceError,
  DataLabel,
} from '../features/markets/MarketComponents';
import { money, observed, quoteStatus } from '../features/markets/presentation';
import {
  AlertEligibility,
  AlertEventHistory,
} from '../features/alerts/AlertPresentation';
import type { alertsAction, alertsLoader } from '../features/alerts/actions';
export function AlertsPage() {
  const state = useLoaderData<typeof alertsLoader>();
  const [params] = useSearchParams();
  const fetcher = useFetcher<typeof alertsAction>();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== 'idle' || revalidator.state !== 'idle';
  const market = useMarketResource(loadOverview);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (
        !document.hidden &&
        fetcher.state === 'idle' &&
        revalidator.state === 'idle'
      )
        void revalidator.revalidate();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetcher.state, revalidator]);
  const pageLink = (key: string, value: number) => {
    const next = new URLSearchParams(params);
    next.set(key, String(value));
    if (key === 'page') {
      next.delete('inspect');
      next.delete('historyPage');
    }
    return `?${next}`;
  };
  const selected = state.inspected;
  return (
    <div className="market-dashboard workspace-page alerts-page">
      <div className="market-heading">
        <div>
          <p className="eyebrow">Price alerts · USD</p>
          <h1>Know when your target is reached.</h1>
          <p className="market-subtitle">
            Personal targets, verified real observations and a clear event
            history.
          </p>
        </div>
        <span className="catalog-chip">
          {state.activeCount} / {ALERT_ACTIVE_LIMIT} armed
          <span>One event per activation</span>
        </span>
      </div>
      <aside className="market-policy">
        <span className="policy-icon" aria-hidden="true">
          i
        </span>
        <div>
          <strong>Price alerts are currently unavailable.</strong> Existing
          targets and their history remain saved.
          <p>
            Alerts need an authorized native data source. TradingView charts are
            for display only and cannot trigger MarketPulse alerts. You can
            manage or pause saved targets.
          </p>
        </div>
      </aside>
      {fetcher.data && (
        <p
          className={
            fetcher.data.ok ? 'watchlist-feedback positive' : 'market-error'
          }
          role={fetcher.data.ok ? 'status' : 'alert'}
        >
          {fetcher.data.message}
        </p>
      )}
      {fetcher.state !== 'idle' && (
        <p role="status" className="muted">
          Saving alert changes…
        </p>
      )}
      {market.loading && <MarketLoading refreshing={!!market.data} />}
      {market.error && (
        <ResourceError message={market.error} retry={market.retry} />
      )}
      <section className="market-panel" aria-labelledby="create-alert">
        <div className="panel-heading">
          <div>
            <h2 id="create-alert">Set a price target</h2>
            <p>
              Above means at or above; below means at or below. Targets use
              exact USD decimals.
            </p>
          </div>
          <span className="muted">
            {state.activeCount}/{ALERT_ACTIVE_LIMIT} active slots
          </span>
        </div>
        <fetcher.Form
          method="post"
          className="alert-target-form"
          key={state.activeCount}
        >
          <input type="hidden" name="intent" value="create" />
          <label htmlFor="alert-asset">
            Asset
            <select
              id="alert-asset"
              name="assetId"
              required
              disabled={
                busy ||
                !market.data?.quotes.some(
                  (quote) => !quote.simulated && quote.status === 'fresh',
                ) ||
                state.activeCount >= ALERT_ACTIVE_LIMIT
              }
              defaultValue=""
            >
              <option value="" disabled>
                Choose crypto or stock
              </option>
              {market.data?.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ({asset.symbol})
                  {asset.type === 'STOCK' ? ' — native alerts unavailable' : ''}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="alert-direction">
            Condition
            <select id="alert-direction" name="direction" disabled={busy}>
              <option value="ABOVE">At or above (≥)</option>
              <option value="BELOW">At or below (≤)</option>
            </select>
          </label>
          <label htmlFor="alert-threshold">
            Target price (USD)
            <input
              id="alert-threshold"
              name="threshold"
              type="text"
              inputMode="decimal"
              maxLength={39}
              required
              placeholder="e.g. 65000.00"
              disabled={busy}
              aria-describedby="target-help"
            />
          </label>
          <button
            className="primary-button"
            disabled={
              busy ||
              !market.data?.quotes.some(
                (quote) => !quote.simulated && quote.status === 'fresh',
              ) ||
              state.activeCount >= ALERT_ACTIVE_LIMIT
            }
          >
            Save & arm target
          </button>
          <p id="target-help" className="muted">
            Price alerts require an authorized native price source and are
            currently unavailable. Existing targets remain saved; charts do not
            trigger alerts.
          </p>
        </fetcher.Form>
      </section>
      <section className="market-panel" aria-labelledby="your-alerts">
        <div className="panel-heading">
          <div>
            <h2 id="your-alerts">Your alerts</h2>
            <p>
              Manage targets or open an alert to edit and inspect its history.
            </p>
          </div>
          <nav className="market-tabs" aria-label="Filter alerts">
            {(['ALL', 'ACTIVE', 'PAUSED', 'TRIGGERED'] as const).map(
              (status) => (
                <Link
                  key={status}
                  to={status === 'ALL' ? '/alerts' : `?status=${status}`}
                  aria-current={
                    (params.get('status') ?? 'ALL') === status
                      ? 'page'
                      : undefined
                  }
                >
                  {status === 'ALL'
                    ? 'All'
                    : status === 'ACTIVE'
                      ? 'Armed'
                      : status === 'PAUSED'
                        ? 'Paused'
                        : 'Triggered'}
                </Link>
              ),
            )}
          </nav>
        </div>
        {state.alerts.length ? (
          <ul className="alert-cards">
            {state.alerts.map((alert) => {
              const quote = market.data?.quotes.find(
                (value) => value.assetId === alert.asset.id,
              );
              return (
                <li key={alert.id} className="alert-card">
                  <div className="alert-card-top">
                    <div>
                      <Link
                        className="alert-asset-title"
                        to={`/assets/${alert.asset.id}`}
                      >
                        {alert.asset.name}{' '}
                        <span className="muted">{alert.asset.symbol}</span>
                      </Link>
                      <p className="alert-decimal">
                        Target {alert.direction === 'ABOVE' ? '≥' : '≤'} USD{' '}
                        {alert.threshold}
                      </p>
                    </div>
                    <span
                      className={`alert-status ${alert.status === 'TRIGGERED' ? 'positive' : alert.status === 'PAUSED' || alert.eligibility !== 'eligible' ? 'status-stale' : 'muted'}`}
                    >
                      {alert.status === 'ACTIVE'
                        ? 'Armed'
                        : alert.status === 'PAUSED'
                          ? 'Paused'
                          : 'Triggered'}
                    </span>
                  </div>
                  <AlertEligibility alert={alert} />
                  <p className="alert-current-price">
                    Cached price: {money(quote?.price)} ·{' '}
                    <span className={`status-${quoteStatus(quote)}`}>
                      {quoteStatus(quote)}
                    </span>{' '}
                    {quote && <DataLabel simulated={quote.simulated} />}
                  </p>
                  <p className="source-name muted">
                    {quote?.provider ?? 'Source unavailable'} · Observed{' '}
                    {observed(quote?.sourceAt)} · Armed{' '}
                    {observed(alert.armedAt)}
                  </p>
                  {alert.latestEvent?.verifiedReal && (
                    <p className="alert-reached">
                      Last target reached{' '}
                      {observed(alert.latestEvent.triggeredAt)} at USD{' '}
                      {alert.latestEvent.observedPrice}
                    </p>
                  )}
                  <div className="alert-inline-actions">
                    <Link
                      className="secondary-button"
                      to={`?${new URLSearchParams({ ...Object.fromEntries(params), inspect: alert.id, historyPage: '1' })}`}
                    >
                      Manage & history
                    </Link>
                    <fetcher.Form method="post">
                      <input type="hidden" name="id" value={alert.id} />
                      <input
                        type="hidden"
                        name="intent"
                        value={alert.status === 'ACTIVE' ? 'pause' : 'rearm'}
                      />
                      <button
                        className="secondary-button"
                        disabled={
                          busy ||
                          (alert.status !== 'ACTIVE' &&
                            (alert.eligibility !== 'eligible' ||
                              state.activeCount >= ALERT_ACTIVE_LIMIT))
                        }
                      >
                        {alert.status === 'ACTIVE' ? 'Pause' : 'Arm again'}
                      </button>
                    </fetcher.Form>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="catalog-empty">
            <h3>No alerts in this view</h3>
            <p>
              Choose another status filter to find saved targets. Native price
              alerts remain unavailable.
            </p>
          </div>
        )}
        <div className="alert-pagination">
          <span className="muted">
            Page {state.page} · {state.total} alerts
          </span>
          {state.page > 1 && (
            <Link
              className="secondary-button"
              to={pageLink('page', state.page - 1)}
            >
              Previous
            </Link>
          )}
          {state.page * state.limit < state.total && (
            <Link
              className="secondary-button"
              to={pageLink('page', state.page + 1)}
            >
              Next
            </Link>
          )}
        </div>
      </section>
      {selected && (
        <section className="market-panel" aria-labelledby="manage-alert">
          <div className="panel-heading">
            <div>
              <h2 id="manage-alert">
                {selected.asset.name} · Target & history
              </h2>
              <p>
                Asset and source stay fixed. Each rearm starts a new activation.
              </p>
            </div>
            <button
              className="secondary-button watchlist-danger"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(selected.id)}
            >
              Delete alert
            </button>
          </div>
          {confirmDelete === selected.id && (
            <div
              className="watchlist-confirm"
              role="group"
              aria-label="Confirm alert deletion"
            >
              <p>Delete this alert and its trigger history?</p>
              <div className="watchlist-inline-actions">
                <fetcher.Form method="post">
                  <input type="hidden" name="id" value={selected.id} />
                  <input type="hidden" name="intent" value="delete" />
                  <button
                    className="secondary-button watchlist-danger"
                    disabled={busy}
                  >
                    Delete permanently
                  </button>
                </fetcher.Form>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <fetcher.Form
            method="post"
            className="alert-target-form"
            key={`${selected.id}:${selected.threshold}:${selected.direction}`}
          >
            <input type="hidden" name="id" value={selected.id} />
            <input type="hidden" name="intent" value="edit" />
            <label htmlFor="edit-alert-direction">
              Condition
              <select
                id="edit-alert-direction"
                name="direction"
                defaultValue={selected.direction}
                disabled={busy}
              >
                <option value="ABOVE">At or above (≥)</option>
                <option value="BELOW">At or below (≤)</option>
              </select>
            </label>
            <label htmlFor="edit-alert-target">
              Target price (USD)
              <input
                id="edit-alert-target"
                name="threshold"
                inputMode="decimal"
                maxLength={39}
                defaultValue={selected.threshold}
                required
                disabled={busy}
              />
            </label>
            <button className="secondary-button" disabled={busy}>
              Save changes & pause
            </button>
            <p className="muted">
              Editing pauses the alert. Arm it again to evaluate the new target.
              Previous history retains its original target and source.
            </p>
          </fetcher.Form>
          <AlertEligibility alert={selected} />
          <div className="panel-heading">
            <h3>Target reached history</h3>
            <span className="muted">{state.history?.total ?? 0} events</span>
          </div>
          <AlertEventHistory events={state.history?.events ?? []} />
          {state.history && (
            <div className="alert-pagination">
              <span className="muted">History page {state.history.page}</span>
              {state.history.page > 1 && (
                <Link
                  className="secondary-button"
                  to={pageLink('historyPage', state.history.page - 1)}
                >
                  Previous events
                </Link>
              )}
              {state.history.page * state.history.limit <
                state.history.total && (
                <Link
                  className="secondary-button"
                  to={pageLink('historyPage', state.history.page + 1)}
                >
                  Next events
                </Link>
              )}
            </div>
          )}
        </section>
      )}
      {market.data && <MarketSourcePolicy status={market.data.status} />}
    </div>
  );
}
