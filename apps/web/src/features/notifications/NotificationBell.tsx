import { NavLink } from 'react-router';
import { useNotifications } from './context';
export function NotificationBell() {
  const { status, unreadCount } = useNotifications();
  if (status === 'guest') return null;
  const label =
    unreadCount === null
      ? 'Notifications — unread count unavailable'
      : `Notifications — ${unreadCount} unread`;
  return (
    <NavLink
      to="/notifications"
      className="notification-bell"
      aria-label={label}
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      <span>Notifications</span>
      {unreadCount !== null && unreadCount > 0 && (
        <span className="notification-badge" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {status === 'error' && <span aria-hidden="true">!</span>}
    </NavLink>
  );
}
