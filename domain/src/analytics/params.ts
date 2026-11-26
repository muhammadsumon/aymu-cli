// ANALYTICS_PLAN 3.2: DataFast goal param value schemas. Stricter than DataFast's own limits
// (names `^[a-z0-9_-]{1,64}$`, values ≤ 255 characters, ≤ 10 params: https://datafa.st/docs/custom-goals).
import { z } from 'zod';
import { PlanKind, VariantKind, Viewport } from '../enums';
import { SLUG_RE } from '../formats';
import { ULID_PATTERN } from '../ids';
import { CatalogSort } from '../catalog/filters';

const decimalString = (min: number, max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((v) => Number(v) >= min && Number(v) <= max, `expected ${min}–${max}`);

export const GoalParam = {
  product_id: z.string().regex(new RegExp(`^(tpl|sec)_${ULID_PATTERN}$`)),
  product_kind: z.enum(['template', 'section']),
  variant_kind: VariantKind,
  viewport: Viewport,
  plan_key: z.string().max(80).regex(SLUG_RE),
  plan_kind: PlanKind,
  order_kind: z.enum(['one_time', 'subscription_initial']),
  billing_env: z.enum(['sandbox', 'production']),
  access_reason: z.enum(['entitled', 'entitled_grace', 'free_product']),
  revision_strategy: z.enum(['latest', 'pinned']),
  item_count: decimalString(1, 20),
  page: decimalString(1, 999),
  sort: CatalogSort,
  filtered: z.enum(['true', 'false']),
  state: z.enum(['anonymous', 'needs_purchase', 'ready']),
  method: z.enum(['password', 'google', 'email_verification']),
  registration: z.enum(['cimd', 'dcr', 'preregistered']),
  client_family: z.enum(['claude', 'claude_code', 'cursor', 'codex', 'vscode', 'other']),
} as const;
export type GoalParamName = keyof typeof GoalParam;

/** Identifier and secret prefixes that must never reach DataFast, matched at the start of any word. */
const FORBIDDEN_PREFIX_RE = /(?:^|[^A-Za-z0-9])(?:usr_|ord_|ses_|ig_|igf_|pdl_|df_|dft_)/;

/** The second guard that runs even if a schema is widened by mistake: no emails, whitespace, URLs or secret-ish ids. */
export function isSafeGoalParamValue(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  if (value.includes('@') || /\s/.test(value) || value.includes('://')) return false;
  return !FORBIDDEN_PREFIX_RE.test(value);
}
