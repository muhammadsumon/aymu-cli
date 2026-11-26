// Paddle webhook envelope (https://developer.paddle.com/webhooks/about/how-webhooks-work; BILLING_ANALYTICS 2.1).
// Parsed only AFTER the raw-body signature check (ROUTES 1.3, invariant 6). `data` stays unknown here; each
// handler validates the entity snapshot it needs (Prompt 5 owns which event types are handled; the rest are
// stored as `ignored`). Order events by `occurred_at`, never by arrival (DATA_MODEL P5).
// Paddle id patterns (`^evt_[a-z\d]{26}$`, `^ntf_[a-z\d]{26}`) are copied from the Paddle API reference:
// https://developer.paddle.com/api-reference/events/list-events , https://developer.paddle.com/api-reference/notifications/list-notifications
import { z } from 'zod';
import type { WebhookEntityType } from './enums';
import { rfc3339ToEpochMicros } from './time';

export const PaddleEventId = z.string().regex(/^evt_[a-z0-9]{26}$/, 'expected a Paddle evt_ id');
export const PaddleNotificationId = z.string().regex(/^ntf_[a-z0-9]{26}$/, 'expected a Paddle ntf_ id');

/** `entity.action`, for example `transaction.completed`. */
export const PaddleEventType = z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'expected entity.action');

export const PaddleWebhookEnvelope = z.looseObject({
  event_id: PaddleEventId,
  event_type: PaddleEventType,
  /** RFC 3339 with sub-millisecond digits; parsed to epoch µs for ordering. */
  occurred_at: z.string().refine((s) => rfc3339ToEpochMicros(s) !== null, 'expected an RFC 3339 timestamp'),
  notification_id: PaddleNotificationId,
  data: z.record(z.string(), z.unknown()),
});
export type PaddleWebhookEnvelope = z.infer<typeof PaddleWebhookEnvelope>;

/** `webhook_events.entity_type` from the `event_type` prefix. */
export function webhookEntityType(eventType: string): WebhookEntityType {
  const entity = eventType.split('.')[0];
  return entity === 'transaction' || entity === 'subscription' || entity === 'adjustment' || entity === 'customer'
    ? entity
    : 'other';
}

/** The ordering key: `occurred_us` (UTC epoch microseconds, GLOSSARY 2.2). */
export function occurredMicros(envelope: Pick<PaddleWebhookEnvelope, 'occurred_at'>): number {
  const us = rfc3339ToEpochMicros(envelope.occurred_at);
  if (us === null) throw new Error('occurred_at is not RFC 3339');
  return us;
}
