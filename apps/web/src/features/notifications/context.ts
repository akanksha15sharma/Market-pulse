import { createContext, useContext } from 'react';
export type NotificationState = {
  status: 'loading' | 'ready' | 'guest' | 'error' | 'disabled';
  unreadCount: number | null;
  revision: number;
};
export const NotificationContext = createContext<
  (NotificationState & { refresh: () => void; expire: () => void }) | null
>(null);
export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('Notification provider required');
  return value;
}
