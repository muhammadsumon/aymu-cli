// MCP_PROTOCOL 5.2 shared definitions, as Zod 4 schemas (the SDK converts them to JSON Schema 2020-12).
import { z } from 'zod';
import { AccessReason, FairUseMetric } from '../enums';
import { AssetRef, OperationId } from '../ids';
import { FairUseSnapshotWire, QuotaSnapshotWire } from '../access';

export const Cursor = z.string().min(1).max(512);
export const Limit = z.int().min(1).max(50).default(10);

/** MCP_PROTOCOL 5.3: `structuredContent` of an `isError` tool result. */
export const ToolError = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string().max(500),
    retryable: z.boolean(),
    retryAfterSeconds: z.int().min(1).optional(),
    operationId: OperationId.optional(),
    metric: FairUseMetric.optional(),
  }),
  decisions: z
    .array(
      z.strictObject({
        assetId: AssetRef,
        decision: z.enum(['allow', 'deny']),
        reason: AccessReason,
        quota: QuotaSnapshotWire.nullable().optional(),
        fairUse: FairUseSnapshotWire.nullable().optional(),
      }),
    )
    .optional(),
});
export type ToolError = z.infer<typeof ToolError>;

/** Every tool result carries this in `_meta`, never in `structuredContent` (ARCHITECTURE ADR-35). */
export const TOOL_RESULT_META = { contentTrust: 'catalog_text_untrusted' } as const;

/** 2026-07-28 `CacheableResult` fields on every `tools/list` result (MCP_PROTOCOL 4.2). */
export const TOOLS_LIST_CACHE = { cacheScope: 'private', ttlMs: 60_000 } as const;

/** MCP_PROTOCOL 5.3: deny reasons that are retryable (with `retryAfterSeconds` until the reset). */
export function isRetryableDenyReason(reason: string): boolean {
  return reason === 'quota_exhausted' || reason === 'fair_use_exceeded';
}
