import {
  alertCreateSchema,
  alertSchema,
  alertTargetSchema,
  alertEventSchema,
} from '@marketpulse/contracts';
import type {
  AlertEvent,
  PrismaClient,
} from '../../generated/prisma/client.js';
import { marketSettings, type MarketSettings } from '../../config/markets.js';
import { createAlertRepository, type StoredAlert } from './repository.js';
function publicEvent(event: AlertEvent) {
  return alertEventSchema.parse({
    ...event,
    observedPrice: event.observedPrice.toFixed(18),
    targetPrice: event.targetPrice?.toFixed(18) ?? null,
    sourceAt: event.sourceAt.toISOString(),
    triggeredAt: event.triggeredAt.toISOString(),
    fetchedAt: event.fetchedAt?.toISOString() ?? null,
    verifiedReal:
      event.provider === 'COINPAPRIKA' &&
      event.mode === 'REAL' &&
      event.fetchedAt !== null &&
      event.targetPrice !== null &&
      event.direction !== null,
  });
}
export function createAlertService(
  db: PrismaClient,
  settings: MarketSettings = marketSettings,
) {
  const repo = createAlertRepository(db);
  const view = (alert: StoredAlert) =>
    alertSchema.parse({
      ...alert,
      threshold: alert.threshold.toFixed(18),
      armedAt: alert.armedAt.toISOString(),
      createdAt: alert.createdAt.toISOString(),
      latestEvent: alert.events[0] ? publicEvent(alert.events[0]) : null,
      eligibility: !alert.asset.isActive
        ? 'inactive_asset'
        : alert.asset.type !== 'CRYPTO' ||
            alert.asset.isDemoOnly ||
            alert.mode !== 'REAL'
          ? 'real_data_required'
          : alert.provider !== 'COINPAPRIKA'
            ? 'unsupported_source'
            : settings.CRYPTO_DATA_MODE !== 'coinpaprika'
              ? 'real_crypto_disabled'
              : 'eligible',
    });
  return {
    async list(userId: string, query: Parameters<typeof repo.list>[1]) {
      const result = await repo.list(userId, query);
      return { ...result, alerts: result.alerts.map(view) };
    },
    async get(userId: string, id: string) {
      return view(await repo.get(userId, id));
    },
    async events(
      userId: string,
      id: string,
      query: { page: number; limit: number },
    ) {
      const result = await repo.events(userId, id, query);
      return { ...result, events: result.events.map(publicEvent) };
    },
    async create(userId: string, input: unknown) {
      return view(await repo.create(userId, alertCreateSchema.parse(input)));
    },
    async edit(userId: string, id: string, input: unknown) {
      return view(await repo.edit(userId, id, alertTargetSchema.parse(input)));
    },
    async pause(userId: string, id: string) {
      return view(await repo.pause(userId, id));
    },
    async rearm(userId: string, id: string) {
      return view(await repo.rearm(userId, id));
    },
    delete: repo.delete,
  };
}
export type AlertService = ReturnType<typeof createAlertService>;
