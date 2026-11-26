import { Link } from 'react-router';
import type { NotificationHistoryItem } from '@marketpulse/contracts';
import { setNotificationRead } from './api';
type Perform = (
  action: () => Promise<void>,
  message: string,
  reload?: boolean,
) => Promise<void>;
const labels = {
  LEGACY: 'Legacy record',
  ACCOUNT_CREATED: 'Account created',
  SIGNED_IN: 'Signed in',
  SESSION_REVOKED: 'Session security',
  PASSWORD_RESET: 'Password reset',
  EMAIL_VERIFIED: 'Email verified',
  WATCHLIST_CREATED: 'Watchlist created',
  WATCHLIST_RENAMED: 'Watchlist renamed',
  WATCHLIST_DELETED: 'Watchlist deleted',
  WATCHLIST_ASSET_ADDED: 'Asset added',
  WATCHLIST_ASSET_REMOVED: 'Asset removed',
};
export function NotificationItem({
  item,
  busy,
  perform,
}: {
  item: NotificationHistoryItem;
  busy: boolean;
  perform: Perform;
}) {
  const unread = item.readAt === null;
  return (
    <li
      className={unread ? 'notification-item is-unread' : 'notification-item'}
    >
      <div className="notification-item-body">
        <div className="notification-meta">
          <strong>{labels[item.kind]}</strong>
          <span className="notification-read-state">
            {unread ? 'Unread' : 'Read'}
          </span>
        </div>
        <p className="notification-message">{item.message}</p>
        <time className="muted" dateTime={item.createdAt}>
          {new Date(item.createdAt).toLocaleString()}
        </time>
        {item.actionUrl && (
          <Link className="notification-action-link" to={item.actionUrl}>
            {item.subjectType === 'ACCOUNT'
              ? 'View account'
              : 'View watchlists'}
          </Link>
        )}
      </div>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => {
          void perform(
            async () => {
              await setNotificationRead(item.id, unread);
            },
            unread
              ? 'Notification marked as read.'
              : 'Notification marked as unread.',
            true,
          );
        }}
      >
        {unread ? 'Mark as read' : 'Mark as unread'}
      </button>
    </li>
  );
}
