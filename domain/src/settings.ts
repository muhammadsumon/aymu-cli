// GLOSSARY 15: owner configuration in `app_settings`. One Zod schema per key; `value_json` is validated with it.
// "Required" keys have no default: when unset, delivery fails closed with `config_missing` (ENTITLEMENTS 6.5 step 15).
import { z } from 'zod';
import { LaunchEndsAt, LifetimeLadder } from './lifetime-ladder';

const int = (min: number, max?: number) => (max === undefined ? z.int().min(min) : z.int().min(min).max(max));

export const APP_SETTINGS = {
  'billing.past_due_grace_days': { schema: int(0, 60), default: 14 },
  'billing.grant_on': { schema: z.literal('transaction_completed'), default: 'transaction_completed' },
  'billing.partial_refund_policy': {
    schema: z.enum(['refunded_items_only', 'whole_order']),
    default: 'refunded_items_only',
  },
  'offers.lifetime_enabled': { schema: z.boolean(), default: false },
  /** Seat-limited launch prices for the lifetime plan (lifetime-ladder.ts); empty = the plan's default price. */
  'offers.lifetime_ladder': { schema: LifetimeLadder, default: [] as LifetimeLadder },
  /** When the ladder's launch prices end (ISO date-time, '' = no deadline); after it the last step's price applies. */
  'offers.lifetime_launch_ends_at': { schema: LaunchEndsAt, default: '' as string },
  /**
   * What the owner commits to ship, per plan key, shown on /pricing as a separate "Committed roadmap" list (never as
   * something available today). Owner-written; empty = no roadmap shown.
   */
  'offers.plan_roadmap': {
    schema: z
      .record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), z.array(z.string().trim().min(3).max(140)).max(8))
      .refine((r) => Object.keys(r).length <= 20, 'at most 20 plans'),
    default: {} as Record<string, string[]>,
  },
  'fair_use.daily_deliveries': { schema: int(1), default: null },
  'fair_use.daily_install_grants': { schema: int(1), default: null },
  'delivery.download_grant_ttl_seconds': { schema: int(60, 3600), default: 900 },
  'delivery.install_grant_ttl_seconds': { schema: int(60, 900), default: 300 },
  /** How long the asset and ZIP links of a rebuild prompt work (docs/REBUILD_PROMPT.md 3, ADR-174). */
  'delivery.rebuild_asset_ttl_seconds': { schema: int(600, 86_400), default: 3600 },
  'delivery.max_items_per_request': { schema: int(1, 20), default: 20 },
  'selection.board_ttl_seconds': { schema: int(600, 604_800), default: 86_400 },
  'selection.max_items': { schema: int(1, 50), default: 50 },
  'mcp.search_access': { schema: z.enum(['any_verified_user', 'entitled_users_only']), default: 'any_verified_user' },
  'publishing.require_second_reviewer': { schema: z.boolean(), default: false },
  'retention.webhook_raw_body_days': { schema: int(7), default: 90 },
  'retention.audit_log_days': { schema: int(365), default: 730 },
} as const;

export type AppSettingKey = keyof typeof APP_SETTINGS;
export const APP_SETTING_KEYS = Object.keys(APP_SETTINGS) as AppSettingKey[];
export type AppSettingValue<K extends AppSettingKey> = z.infer<(typeof APP_SETTINGS)[K]['schema']>;

/** Keys the owner must set before production (no default). */
export const REQUIRED_APP_SETTING_KEYS = APP_SETTING_KEYS.filter((k) => APP_SETTINGS[k].default === null);

/** Validates one stored value for its key. */
export function parseAppSetting<K extends AppSettingKey>(key: K, value: unknown): AppSettingValue<K> {
  return APP_SETTINGS[key].schema.parse(value) as AppSettingValue<K>;
}

/** The subset of settings the access policy reads. `null` means the required key is unset. */
export const PolicySettings = z.strictObject({
  pastDueGraceDays: APP_SETTINGS['billing.past_due_grace_days'].schema,
  fairUseDailyDeliveries: APP_SETTINGS['fair_use.daily_deliveries'].schema.nullable(),
  fairUseDailyInstallGrants: APP_SETTINGS['fair_use.daily_install_grants'].schema.nullable(),
});
export type PolicySettings = z.infer<typeof PolicySettings>;
