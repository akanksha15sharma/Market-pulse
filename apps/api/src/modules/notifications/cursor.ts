import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { NotificationQuery } from '@marketpulse/contracts';
import { constantEqual } from '../auth/security.js';
import { HttpError } from '../../lib/http-error.js';

const payloadSchema = z.tuple([
  z.literal(1),
  z.uuid(),
  z.enum(['all', 'read', 'unread']),
  z.iso.datetime({ precision: 3 }),
  z.uuid(),
]);
export type NotificationPosition = { createdAt: Date; id: string };
export function createNotificationCursor(secret: string) {
  const sign = (payload: string) =>
    createHmac('sha256', secret)
      .update(`marketpulse:notifications:cursor:${payload}`)
      .digest('base64url');
  return {
    encode(
      userId: string,
      filter: NotificationQuery['filter'],
      row: NotificationPosition,
    ) {
      const payload = Buffer.from(
        JSON.stringify([
          1,
          userId,
          filter,
          row.createdAt.toISOString(),
          row.id,
        ]),
      ).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    decode(
      token: string,
      userId: string,
      filter: NotificationQuery['filter'],
    ): NotificationPosition {
      try {
        if (
          token.length > 256 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
        )
          throw new Error('Invalid cursor');
        const [payload, signature] = token.split('.') as [string, string];
        if (!constantEqual(sign(payload), signature))
          throw new Error('Invalid cursor');
        const [, owner, scope, date, id] = payloadSchema.parse(
          JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        );
        if (owner !== userId || scope !== filter)
          throw new Error('Invalid cursor');
        return { createdAt: new Date(date), id };
      } catch {
        throw new HttpError(400, 'Invalid notification cursor');
      }
    },
  };
}
