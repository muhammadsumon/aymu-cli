// GLOSSARY 2.1: every local primary key is a type prefix, an underscore and a 26-character lowercase
// Crockford base32 ULID (https://github.com/ulid/spec). Ids are names, never capabilities.
import { z } from 'zod';

/** Lowercase Crockford base32 alphabet (no i, l, o, u). */
export const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ULID_PATTERN = '[0-9a-hjkmnp-tv-z]{26}';
export const ULID_RE = new RegExp(`^${ULID_PATTERN}$`);
/** GLOSSARY 2.1 generic id regex. */
export const ANY_ID_RE = new RegExp(`^[a-z]{2,4}_${ULID_PATTERN}$`);

/** Prefix per entity (GLOSSARY 2.1 table). Paddle's own prefixes (`sub_`, `txn_`, …) are never reused. */
export const ID_PREFIXES = {
  user: 'usr',
  session: 'ses',
  account: 'acc',
  verification: 'vrf',
  rateLimit: 'rlm',
  category: 'cat',
  tag: 'tag',
  template: 'tpl',
  section: 'sec',
  templatePage: 'tpg',
  variant: 'var',
  asset: 'ast',
  release: 'rel',
  signingKey: 'sgk',
  plan: 'pln',
  planInclusion: 'pli',
  paddleProduct: 'ppd',
  paddlePrice: 'ppr',
  billingCustomer: 'bcu',
  checkoutIntent: 'chk',
  order: 'ord',
  orderItem: 'oit',
  billingAdjustment: 'badj',
  subscription: 'sbn',
  entitlement: 'ent',
  entitlementInclusion: 'eni',
  entitlementGrant: 'egr',
  creditPeriod: 'cpd',
  usageLedger: 'ulg',
  accountHold: 'ahd',
  download: 'dwn',
  install: 'ins',
  installGrant: 'igr',
  rebuildGrant: 'rbg',
  selectionBoard: 'sbd',
  webhookEvent: 'whe',
  auditLog: 'aud',
  analyticsOutbox: 'aob',
  emailConsentEvent: 'ece',
  lifecycleSend: 'lcs',
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdEntity];
export type Id<P extends string> = `${P}_${string}`;

function idSchema<P extends IdPrefix>(prefix: P) {
  const re = new RegExp(`^${prefix}_${ULID_PATTERN}$`);
  return z.string().regex(re, `expected a ${prefix}_ id`) as unknown as z.ZodType<Id<P>, string>;
}

export const UserId = idSchema('usr');
export type UserId = z.infer<typeof UserId>;
export const CategoryId = idSchema('cat');
export type CategoryId = z.infer<typeof CategoryId>;
export const TagId = idSchema('tag');
export type TagId = z.infer<typeof TagId>;
export const TemplateId = idSchema('tpl');
export type TemplateId = z.infer<typeof TemplateId>;
export const SectionId = idSchema('sec');
export type SectionId = z.infer<typeof SectionId>;
export const TemplatePageId = idSchema('tpg');
export type TemplatePageId = z.infer<typeof TemplatePageId>;
export const VariantId = idSchema('var');
export type VariantId = z.infer<typeof VariantId>;
export const AssetId = idSchema('ast');
export type AssetId = z.infer<typeof AssetId>;
export const ReleaseId = idSchema('rel');
export type ReleaseId = z.infer<typeof ReleaseId>;
export const SigningKeyId = idSchema('sgk');
export type SigningKeyId = z.infer<typeof SigningKeyId>;
export const PlanId = idSchema('pln');
export type PlanId = z.infer<typeof PlanId>;
export const OrderId = idSchema('ord');
export type OrderId = z.infer<typeof OrderId>;
export const SubscriptionId = idSchema('sbn');
export type SubscriptionId = z.infer<typeof SubscriptionId>;
export const EntitlementId = idSchema('ent');
export type EntitlementId = z.infer<typeof EntitlementId>;
export const CreditPeriodId = idSchema('cpd');
export type CreditPeriodId = z.infer<typeof CreditPeriodId>;
export const DownloadId = idSchema('dwn');
export type DownloadId = z.infer<typeof DownloadId>;
export const InstallId = idSchema('ins');
export type InstallId = z.infer<typeof InstallId>;
/** The MCP `operationId` is the `ins_` id (GLOSSARY 2.1). */
export const OperationId = InstallId;
export type OperationId = InstallId;
export const InstallGrantRowId = idSchema('igr');
export type InstallGrantRowId = z.infer<typeof InstallGrantRowId>;
/** The MCP `selectionId` is the `sbd_` id (GLOSSARY 2.1). */
export const SelectionId = idSchema('sbd');
export type SelectionId = z.infer<typeof SelectionId>;
export const WebhookEventRowId = idSchema('whe');
export type WebhookEventRowId = z.infer<typeof WebhookEventRowId>;

/** A product id: a template or a section (the prefix encodes the kind). */
export const ProductId = z
  .string()
  .regex(new RegExp(`^(tpl|sec)_${ULID_PATTERN}$`), 'expected a tpl_ or sec_ id') as unknown as z.ZodType<
  TemplateId | SectionId,
  string
>;
export type ProductId = TemplateId | SectionId;

/**
 * GLOSSARY 8.2: the `assetId` argument of canAccess and each element of MCP `prepare_install({ assetIds })`.
 * A product, variant or release id. Never an `ast_` id.
 */
export const AssetRef = z
  .string()
  .regex(
    new RegExp(`^(tpl|sec|var|rel)_${ULID_PATTERN}$`),
    'expected a tpl_, sec_, var_ or rel_ id',
  ) as unknown as z.ZodType<TemplateId | SectionId | VariantId | ReleaseId, string>;
export type AssetRef = TemplateId | SectionId | VariantId | ReleaseId;

export type AssetRefKind = 'template' | 'section' | 'variant' | 'release';

/** Classifies a raw string as an AssetRef, or returns null (unknown prefix, `ast_`, malformed). */
export function classifyAssetRef(value: string): { kind: AssetRefKind; id: AssetRef } | null {
  if (!AssetRef.safeParse(value).success) return null;
  const prefix = value.slice(0, 3);
  const kind: AssetRefKind =
    prefix === 'tpl' ? 'template' : prefix === 'sec' ? 'section' : prefix === 'var' ? 'variant' : 'release';
  return { kind, id: value as AssetRef };
}

/** `rel_01m8…` → `01m8…`: the label of the public per-release preview host (ARCHITECTURE ADR-28). */
export function releaseHostLabel(releaseId: ReleaseId): string {
  return releaseId.slice('rel_'.length);
}

/**
 * Encodes a ULID in lowercase Crockford base32: 48-bit millisecond time, then 80 random bits
 * (https://github.com/ulid/spec). Uses only Web Crypto (`crypto.getRandomValues`), so it runs in Workers and Node.
 */
export function ulid(nowMs: number, random: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 2 ** 48 - 1) {
    throw new RangeError('ulid: time must be an integer between 0 and 2^48 - 1');
  }
  if (random.length !== 10) throw new RangeError('ulid: random must be 10 bytes');
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD_ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  // 80 random bits → 16 base32 characters, most significant first.
  let bits = 0;
  let acc = 0;
  let rand = '';
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD_ALPHABET.charAt((acc >> bits) & 31);
      acc &= (1 << bits) - 1;
    }
  }
  return time + rand;
}

/** A new id for an entity, e.g. `newId('release', Date.now())` → `rel_…`. */
export function newId<E extends IdEntity>(entity: E, nowMs: number, random?: Uint8Array): Id<(typeof ID_PREFIXES)[E]> {
  return `${ID_PREFIXES[entity]}_${ulid(nowMs, random)}` as Id<(typeof ID_PREFIXES)[E]>;
}
