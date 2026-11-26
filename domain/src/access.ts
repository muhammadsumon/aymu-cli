// ENTITLEMENTS 6.1–6.3: the canAccess output contract, in domain form (Date) and wire form (ISO strings).
import { z } from 'zod';
import { AccessAction, AccessDecisionValue, AccessReason, type DenyReason, FairUseMetric } from './enums';
import { CreditPeriodId, EntitlementId, ProductId, ReleaseId, VariantId } from './ids';
import { Instant } from './time';

// ---- Domain form (what the pure policy returns) --------------------------------------------------
export interface QuotaSnapshot {
  limit: number;
  used: number;
  /** `max(0, limit − used)` */
  remaining: number;
  periodEnd: Date;
  /** Null until the first spend of the period creates the row (ENTITLEMENTS 7.2). */
  creditPeriodId: CreditPeriodId | null;
}

export interface FairUseSnapshot {
  metric: FairUseMetric;
  limit: number;
  used: number;
  remaining: number;
  /** The last millisecond of the UTC day (GLOSSARY 2.2). */
  windowEnd: Date;
}

export interface AccessTarget {
  productId: ProductId;
  variantId: VariantId | null;
  releaseId: ReleaseId | null;
}

export interface AccessDecision {
  decision: AccessDecisionValue;
  reason: AccessReason;
  /** Null when the action is unmetered for this decision. */
  quota: QuotaSnapshot | null;
  /** The entitlement relied on (allow), or the best candidate (quota_exhausted). */
  sourceEntitlementId: EntitlementId | null;
  /** ENTITLEMENTS 6.8: an upper bound on how long this allow holds; null for deny and non-entitlement allows. */
  expiresAt: Date | null;
  /** Null when the target is not visible to this principal (not_found). */
  target: AccessTarget | null;
  /** True when a successful exchange will spend one credit (first unlock). */
  creditRequired: boolean;
  /** Delivery actions for non-staff; null otherwise. Always metric `deliveries` here. */
  fairUse: FairUseSnapshot | null;
  /** Equals `atTime`. */
  evaluatedAt: Date;
}

// ---- Wire form (HTTP JSON, MCP output): Dates become ISO 8601 strings ----------------------------
export const QuotaSnapshotWire = z.strictObject({
  limit: z.int().min(0),
  used: z.int().min(0),
  remaining: z.int().min(0),
  periodEnd: Instant,
  creditPeriodId: CreditPeriodId.nullable(),
});
export type QuotaSnapshotWire = z.infer<typeof QuotaSnapshotWire>;

export const FairUseSnapshotWire = z.strictObject({
  metric: FairUseMetric,
  limit: z.int().min(1),
  used: z.int().min(0),
  remaining: z.int().min(0),
  windowEnd: Instant,
});
export type FairUseSnapshotWire = z.infer<typeof FairUseSnapshotWire>;

export const AccessTargetWire = z.strictObject({
  productId: ProductId,
  variantId: VariantId.nullable(),
  releaseId: ReleaseId.nullable(),
});

export const AccessDecisionWire = z.strictObject({
  decision: AccessDecisionValue,
  reason: AccessReason,
  quota: QuotaSnapshotWire.nullable(),
  sourceEntitlementId: EntitlementId.nullable(),
  expiresAt: Instant.nullable(),
  target: AccessTargetWire.nullable(),
  creditRequired: z.boolean(),
  fairUse: FairUseSnapshotWire.nullable(),
  evaluatedAt: Instant,
});
export type AccessDecisionWire = z.infer<typeof AccessDecisionWire>;

/** MCP_PROTOCOL 5.2 `AccessView`: one per delivery action a variant supports. */
export const AccessView = z.strictObject({
  action: AccessAction,
  decision: AccessDecisionValue,
  reason: AccessReason,
  creditRequired: z.boolean(),
  quota: QuotaSnapshotWire.nullable(),
  fairUse: FairUseSnapshotWire.nullable(),
  expiresAt: Instant.nullable(),
});
export type AccessView = z.infer<typeof AccessView>;

export function quotaToWire(q: QuotaSnapshot): QuotaSnapshotWire {
  return { ...q, periodEnd: q.periodEnd.toISOString() };
}

export function fairUseToWire(f: FairUseSnapshot): FairUseSnapshotWire {
  return { ...f, windowEnd: f.windowEnd.toISOString() };
}

export function accessDecisionToWire(d: AccessDecision): AccessDecisionWire {
  return {
    decision: d.decision,
    reason: d.reason,
    quota: d.quota ? quotaToWire(d.quota) : null,
    sourceEntitlementId: d.sourceEntitlementId,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    target: d.target,
    creditRequired: d.creditRequired,
    fairUse: d.fairUse ? fairUseToWire(d.fairUse) : null,
    evaluatedAt: d.evaluatedAt.toISOString(),
  };
}

export function accessViewFor(action: AccessAction, d: AccessDecision): AccessView {
  return {
    action,
    decision: d.decision,
    reason: d.reason,
    creditRequired: d.creditRequired,
    quota: d.quota ? quotaToWire(d.quota) : null,
    fairUse: d.fairUse ? fairUseToWire(d.fairUse) : null,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
  };
}

/** ROUTES 1.8: HTTP status per access_reason (deny reasons only; allows are 2xx). Binds the MCP Worker's HTTP routes too. */
export const DENY_REASON_HTTP_STATUS = {
  auth_required: 401,
  email_unverified: 403,
  account_banned: 403,
  account_closed: 403,
  account_restricted: 403,
  rights_unverified: 403,
  no_entitlement: 403,
  not_in_plan: 403,
  entitlement_not_started: 403,
  entitlement_expired: 403,
  entitlement_revoked: 403,
  subscription_paused: 403,
  billing_past_due: 403,
  quota_exhausted: 403,
  fair_use_exceeded: 403,
  not_found: 404,
  variant_unavailable: 404,
  release_unavailable: 404,
  release_revoked: 410,
  variant_required: 422,
  action_not_supported: 422,
  config_missing: 503,
} as const satisfies Record<DenyReason, number>;
