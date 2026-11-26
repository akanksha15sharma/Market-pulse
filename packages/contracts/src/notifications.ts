import { z } from 'zod';

export const notificationKindSchema = z.enum([
  'LEGACY',
  'ACCOUNT_CREATED',
  'SIGNED_IN',
  'SESSION_REVOKED',
  'PASSWORD_RESET',
  'EMAIL_VERIFIED',
  'WATCHLIST_CREATED',
  'WATCHLIST_RENAMED',
  'WATCHLIST_DELETED',
  'WATCHLIST_ASSET_ADDED',
  'WATCHLIST_ASSET_REMOVED',
]);
export const notificationEventKindSchema = notificationKindSchema.exclude([
  'LEGACY',
]);
export const notificationSubjectTypeSchema = z.enum(['ACCOUNT', 'WATCHLIST']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type NotificationEventKind = z.infer<typeof notificationEventKindSchema>;

export const notificationCategories = Object.freeze({
  LEGACY: 'LEGACY',
  ACCOUNT_CREATED: 'ACCOUNT_ACTIVITY',
  SIGNED_IN: 'ACCOUNT_ACTIVITY',
  SESSION_REVOKED: 'SECURITY',
  PASSWORD_RESET: 'SECURITY',
  EMAIL_VERIFIED: 'SECURITY',
  WATCHLIST_CREATED: 'WATCHLIST_ACTIVITY',
  WATCHLIST_RENAMED: 'WATCHLIST_ACTIVITY',
  WATCHLIST_DELETED: 'WATCHLIST_ACTIVITY',
  WATCHLIST_ASSET_ADDED: 'WATCHLIST_ACTIVITY',
  WATCHLIST_ASSET_REMOVED: 'WATCHLIST_ACTIVITY',
} as const satisfies Record<NotificationKind, string>);

export type NotificationCategory =
  (typeof notificationCategories)[NotificationKind];

// These defaults do not create database records or enable notification delivery.
export const notificationPreferenceDefaults = Object.freeze({
  accountActivityEnabled: true,
  watchlistActivityEnabled: true,
});
export const notificationPreferencesSchema = z
  .object({
    accountActivityEnabled: z.boolean(),
    watchlistActivityEnabled: z.boolean(),
    securityNotificationsRequired: z.literal(true),
  })
  .strict();
export const notificationPreferencePatchSchema = z
  .object({
    accountActivityEnabled: z.boolean().optional(),
    watchlistActivityEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Choose a preference to update',
  );
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

const operationIdSchema = z.uuidv4().transform((value) => value.toLowerCase());
const keyPattern = new RegExp(
  `^(${notificationEventKindSchema.options.join('|')}):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
);
export const notificationEventKeySchema = z.string().max(160).regex(keyPattern);

// Future producers must reuse the operation UUID across internal transaction retries.
// This does not make arbitrary repeated HTTP business operations idempotent.
export function notificationEventKey(
  kind: NotificationEventKind,
  operationId: string,
) {
  return `${notificationEventKindSchema.parse(kind)}:${operationIdSchema.parse(operationId)}`;
}
export function notificationSubjectType(kind: NotificationEventKind) {
  return notificationCategories[notificationEventKindSchema.parse(kind)] ===
    'WATCHLIST_ACTIVITY'
    ? ('WATCHLIST' as const)
    : ('ACCOUNT' as const);
}

// Internal event data contract, NOT a public create-notification request body.
export const notificationEventSchema = z
  .object({
    userId: z.uuid(),
    kind: notificationEventKindSchema,
    eventKey: notificationEventKeySchema,
    subjectType: notificationSubjectTypeSchema,
    subjectId: z.uuid(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.eventKey.startsWith(`${value.kind}:`))
      ctx.addIssue({
        code: 'custom',
        path: ['eventKey'],
        message: 'Event key must match its kind',
      });
    if (value.subjectType !== notificationSubjectType(value.kind))
      ctx.addIssue({
        code: 'custom',
        path: ['subjectType'],
        message: 'Subject must match the event kind',
      });
    if (
      value.subjectType === 'ACCOUNT' &&
      value.subjectId.toLowerCase() !== value.userId.toLowerCase()
    )
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'Account event must refer to its recipient',
      });
  });
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

// Legacy content stays stored unchanged, but cannot be presented as verified activity.
export const legacyNotificationMessage =
  'Legacy notification retained; details are unavailable because its source is unverified.';
export const notificationHistoryItemSchema = z
  .object({
    id: z.uuid(),
    kind: notificationKindSchema,
    message: z.string().min(1).max(1000),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
    subjectType: notificationSubjectTypeSchema.nullable(),
    subjectId: z.uuid().nullable(),
    actionUrl: z.string().max(128).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'LEGACY') {
      if (
        value.message !== legacyNotificationMessage ||
        value.subjectType !== null ||
        value.subjectId !== null ||
        value.actionUrl !== null
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Unverified legacy records require the neutral legacy display',
        });
    } else if (
      value.subjectType !== notificationSubjectType(value.kind) ||
      value.subjectId === null
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Typed history must include the matching subject',
      });
    }
    if (value.kind !== 'LEGACY') {
      const allowed =
        value.subjectType === 'ACCOUNT'
          ? value.actionUrl === '/account'
          : value.actionUrl === '/watchlists' ||
            value.actionUrl ===
              `/watchlists?list=${value.subjectId?.toLowerCase()}`;
      if (!allowed)
        ctx.addIssue({
          code: 'custom',
          path: ['actionUrl'],
          message: 'Notification links must target their own internal subject',
        });
    }
  });
export type NotificationHistoryItem = z.infer<
  typeof notificationHistoryItemSchema
>;

export const notificationReadSchema = z.object({ read: z.boolean() }).strict();
export const notificationReadAllSchema = z.object({}).strict();
// An opaque cursor is bounded here; E2 must validate/decode its ordering fields.
export const notificationQuerySchema = z
  .object({
    filter: z.enum(['all', 'read', 'unread']).default('all'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict();
export const notificationHistorySchema = z
  .object({
    notifications: z.array(notificationHistoryItemSchema).max(50),
    unreadCount: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).max(256).nullable(),
  })
  .strict();
export const notificationSummarySchema = z.discriminatedUnion('enabled', [
  z
    .object({
      enabled: z.literal(true),
      unreadCount: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ enabled: z.literal(false), unreadCount: z.null() }).strict(),
]);

export type NotificationPreferencePatch = z.infer<
  typeof notificationPreferencePatchSchema
>;
export type NotificationReadInput = z.infer<typeof notificationReadSchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationHistory = z.infer<typeof notificationHistorySchema>;
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;

export const notificationReadResponseSchema = z
  .object({ notification: notificationHistoryItemSchema })
  .strict();
export const notificationReadAllResponseSchema = z
  .object({ updatedCount: z.number().int().nonnegative() })
  .strict();
export type NotificationReadResponse = z.infer<
  typeof notificationReadResponseSchema
>;
export type NotificationReadAllResponse = z.infer<
  typeof notificationReadAllResponseSchema
>;
