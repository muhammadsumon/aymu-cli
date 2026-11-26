// ANALYTICS_PLAN 3.1 and 4: the typed DataFast goal table. `metrics_event_mapping` is seeded from it.
import { z } from 'zod';
import type { DedupeRule, EventSource, PrivacyClass } from '../enums';
import { GoalParam, isSafeGoalParamValue } from './params';

/** GLOSSARY 14: DataFast reserved names, never sent (https://datafa.st/docs/custom-goals). */
export const RESERVED_DATAFAST_NAMES = [
  'identify',
  'payment',
  'free_trial',
  'trial_started',
  'trial_converted',
  'subscription_started',
  'subscription_upgraded',
  'subscription_downgraded',
  'subscription_renewed',
  'subscription_cancel_scheduled',
  'subscription_reactivated',
  'subscription_ended',
] as const;
export type ReservedDatafastName = (typeof RESERVED_DATAFAST_NAMES)[number];

/** DataFast goal-name rule (GLOSSARY 1). */
export const GOAL_NAME_RE = /^[a-z0-9_:-]{1,64}$/;

interface GoalDef<P extends z.ZodType, S extends EventSource = EventSource> {
  eventKey: string;
  source: S;
  dedupeRule: DedupeRule;
  privacyClass: PrivacyClass;
  params: P;
  description: string;
}

/** Keeps `source` literal, so `ClientGoalName` and `ServerGoalName` below are real unions (never `never`). */
function goal<P extends z.ZodType, const S extends EventSource>(def: GoalDef<P, S>): GoalDef<P, S> {
  return def;
}

const p = GoalParam;

export const GOALS = {
  templates_list_viewed: goal({
    eventKey: 'catalog.templates_list_viewed',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ page: p.page, filtered: p.filtered, sort: p.sort }).partial(),
    description: 'Document load of /templates (any page, any filters).',
  }),
  template_detail_viewed: goal({
    eventKey: 'catalog.template_detail_viewed',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id }),
    description: 'Document load of a published /templates/[slug].',
  }),
  section_detail_viewed: goal({
    eventKey: 'catalog.section_detail_viewed',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id }),
    description: 'Document load of a published /sections/[slug].',
  }),
  format_selected: goal({
    eventKey: 'catalog.format_selected',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id, variant_kind: p.variant_kind }),
    description: 'The user switches the variant shown on a product page.',
  }),
  preview_opened: goal({
    eventKey: 'catalog.preview_opened',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id, viewport: p.viewport }),
    description: 'The user opens the live preview or switches its viewport.',
  }),
  favorite_added: goal({
    eventKey: 'catalog.favorite_added',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id, product_kind: p.product_kind }),
    description: 'PUT /api/favorites/{productId} returned 2xx with created: true.',
  }),
  download_intent: goal({
    eventKey: 'delivery.download_intent',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ product_id: p.product_id, variant_kind: p.variant_kind, state: p.state }),
    description: 'Click on a download control, before any auth or entitlement step.',
  }),
  auth_completed: goal({
    eventKey: 'auth.completed',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({ method: p.method }),
    description: "The user's first Better Auth session ({userId}:auth).",
  }),
  checkout_started: goal({
    eventKey: 'billing.checkout_started',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ plan_key: p.plan_key, plan_kind: p.plan_kind }),
    description: 'POST /api/checkout returned 2xx with a transactionId.',
  }),
  purchase_confirmed: goal({
    eventKey: 'billing.purchase_confirmed',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({
      plan_key: p.plan_key,
      plan_kind: p.plan_kind,
      order_kind: p.order_kind,
      billing_env: p.billing_env,
    }),
    description: 'A verified transaction.completed committed a one_time or subscription_initial order ({orderId}).',
  }),
  first_download_success: goal({
    eventKey: 'delivery.first_download_success',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({
      product_kind: p.product_kind,
      variant_kind: p.variant_kind,
      access_reason: p.access_reason,
    }),
    description: "The user's first committed T7 exchange of a file_download ({userId}:first_download).",
  }),
  mcp_connect_started: goal({
    eventKey: 'mcp.connect_started',
    source: 'client',
    dedupeRule: 'none',
    privacyClass: 'public',
    params: z.strictObject({ client_family: p.client_family }),
    description: "A click on a client's copy-config button or install link on /mcp.",
  }),
  mcp_connected: goal({
    eventKey: 'mcp.connected',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({ registration: p.registration, client_family: p.client_family }),
    description: "The MCP Worker's /oauth/callback succeeded ({userId}: first connection ever).",
  }),
  mcp_install_grant_created: goal({
    eventKey: 'mcp.install_grant_created',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({ item_count: p.item_count, revision_strategy: p.revision_strategy }),
    description: 'T8 committed with installs.status = prepared and channel = mcp ({installId}).',
  }),
  mcp_install_confirmed: goal({
    eventKey: 'mcp.install_confirmed',
    source: 'server',
    dedupeRule: 'once_per_subject',
    privacyClass: 'pseudonymous',
    params: z.strictObject({ item_count: p.item_count }),
    description: 'The CLI report moved an mcp install from redeemed to confirmed (CLI-reported) ({installId}).',
  }),
} as const;

export type GoalName = keyof typeof GOALS;
export const GOAL_NAMES = Object.keys(GOALS) as GoalName[];
export const AnalyticsGoalName = z.enum(GOAL_NAMES as [GoalName, ...GoalName[]]);
export type GoalParams<G extends GoalName> = z.infer<(typeof GOALS)[G]['params']>;
export type ClientGoalName = { [G in GoalName]: (typeof GOALS)[G]['source'] extends 'client' ? G : never }[GoalName];
export type ServerGoalName = { [G in GoalName]: (typeof GOALS)[G]['source'] extends 'server' ? G : never }[GoalName];

// Compile-time check: no goal name is a reserved DataFast name.
type ReservedOverlap = Extract<GoalName, ReservedDatafastName>;
const _noReservedGoal: [ReservedOverlap] extends [never] ? true : never = true;
void _noReservedGoal;

/** Runtime assertion on module load (ANALYTICS_PLAN 3.1). */
for (const name of GOAL_NAMES) {
  if ((RESERVED_DATAFAST_NAMES as readonly string[]).includes(name) || !GOAL_NAME_RE.test(name)) {
    throw new Error(`invalid DataFast goal name: ${name}`);
  }
}

/** At most 5 params per goal (ANALYTICS_PLAN 3.2). */
export const MAX_GOAL_PARAMS = 5;

/** Validates params for a goal: strict schema, then the value guard. Throws on violation. */
export function validateGoalParams<G extends GoalName>(goalName: G, params: unknown): GoalParams<G> {
  const parsed = GOALS[goalName].params.parse(params) as Record<string, string>;
  const entries = Object.entries(parsed);
  if (entries.length > MAX_GOAL_PARAMS) throw new Error(`goal ${goalName}: more than ${MAX_GOAL_PARAMS} params`);
  for (const [k, v] of entries) {
    if (!isSafeGoalParamValue(v)) throw new Error(`goal ${goalName}: unsafe value for ${k}`);
  }
  return parsed as GoalParams<G>;
}
