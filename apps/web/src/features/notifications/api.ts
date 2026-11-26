import { z } from 'zod';
import {
  notificationHistorySchema,
  notificationQuerySchema,
  notificationSummarySchema,
  notificationPreferencesSchema,
  notificationPreferencePatchSchema,
  notificationReadSchema,
  notificationReadResponseSchema,
  notificationReadAllResponseSchema,
} from '@marketpulse/contracts';
import { api, ApiError } from '../../lib/api-client';

async function validated<T>(schema: z.ZodType<T>, request: Promise<unknown>) {
  const result = schema.safeParse(await request);
  if (!result.success)
    throw new ApiError(
      502,
      'Notifications are temporarily unavailable. Please try again.',
    );
  return result.data;
}
export const loadNotificationSummary = (signal?: AbortSignal) =>
  validated(
    notificationSummarySchema,
    api('/notifications/summary', { signal }),
  );
export function loadNotifications(input: unknown, signal?: AbortSignal) {
  const query = notificationQuerySchema.parse(input);
  const params = new URLSearchParams({
    filter: query.filter,
    limit: String(query.limit),
  });
  if (query.cursor) params.set('cursor', query.cursor);
  return validated(
    notificationHistorySchema,
    api(`/notifications?${params}`, { signal }),
  );
}
export const loadNotificationPreferences = (signal?: AbortSignal) =>
  validated(
    notificationPreferencesSchema,
    api('/notifications/preferences', { signal }),
  );
export const saveNotificationPreferences = (input: unknown) =>
  validated(
    notificationPreferencesSchema,
    api('/notifications/preferences', {
      method: 'PATCH',
      body: notificationPreferencePatchSchema.parse(input),
    }),
  );
export const setNotificationRead = (id: string, read: boolean) =>
  validated(
    notificationReadResponseSchema,
    api(`/notifications/${z.uuid().parse(id)}/read`, {
      method: 'PATCH',
      body: notificationReadSchema.parse({ read }),
    }),
  );
export const markAllNotificationsRead = () =>
  validated(
    notificationReadAllResponseSchema,
    api('/notifications/read-all', { method: 'POST', body: {} }),
  );
