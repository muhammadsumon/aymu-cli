// Install grants and download grants (GLOSSARY 2.1, 9; MCP_PROTOCOL 10; ROUTES 6.5). Grant codes, verifiers and
// fetch keys are secrets: only their SHA-256 is stored, and they never appear in logs or analytics.
// The claims schemas below are the facts a grant row binds; they are D1 rows read by the exchange, not
// self-contained bearer tokens (ARCHITECTURE ADR-13: single-use capabilities held in D1).
import { z } from 'zod';
import { CliVerificationCode, DownloadKind, ProductKind, RevisionStrategy, VariantKind } from './enums';
import { HttpsUrl, SemVer, Sha256Hex, Slug } from './formats';
import { DownloadId, EntitlementId, InstallId, ProductId, ReleaseId, SelectionId, UserId, VariantId } from './ids';
import { Instant } from './time';

/** `ig_` + 43 base64url characters (32 random bytes). */
export const INSTALL_GRANT_CODE_RE = /^ig_[A-Za-z0-9_-]{43}$/;
export const InstallGrantCode = z.string().regex(INSTALL_GRANT_CODE_RE, 'expected an install grant code');
/** 43 base64url characters (32 random bytes); stays on the customer's machine. */
export const InstallVerifier = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'expected a 43-character verifier');
/** `BASE64URL(SHA-256(ASCII(verifier)))`, RFC 7636 S256 (https://www.rfc-editor.org/rfc/rfc7636#section-4.2). */
export const InstallChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'expected a 43-character S256 challenge');
/** `igf_` + 43 base64url characters; returned once by POST /grants/redeem. */
export const FETCH_KEY_RE = /^igf_[A-Za-z0-9_-]{43}$/;
export const FetchKey = z.string().regex(FETCH_KEY_RE, 'expected a fetch key');

/** Redacts every `ig_…`/`igf_…` string (RELEASE_FORMAT 15.3 H2; also used by the logger). */
export function redactGrantSecrets(text: string): string {
  return text
    .replace(/\big_[A-Za-z0-9_-]{43}\b/g, 'ig_[redacted]')
    .replace(/\bigf_[A-Za-z0-9_-]{43}\b/g, 'igf_[redacted]');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256: the challenge the server stores and the redeem step recomputes. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** 32 random bytes, base64url: the shared generator for codes, verifiers and fetch keys. */
export function randomToken(prefix: '' | 'ig_' | 'igf_' = ''): string {
  return prefix + base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** What one install grant binds (DATA_MODEL `install_grants`, `installs`, `install_items`; MCP_PROTOCOL 10.2). */
export const InstallGrantClaims = z.strictObject({
  installId: InstallId,
  userId: UserId,
  channel: z.enum(['mcp', 'cli']),
  /** `https://mcp.[DOMAIN]/grants/redeem`. */
  audience: HttpsUrl,
  challenge: InstallChallenge,
  challengeMethod: z.literal('S256'),
  expiresAt: z.date(),
  revisionStrategy: RevisionStrategy,
  /** Opaque KV references (no FK); null for none. */
  oauthClientId: z.string().max(512).nullable(),
  oauthGrantId: z.string().max(512).nullable(),
  selectionId: SelectionId.nullable(),
  /** The exact releases and manifest hashes; redemption never switches releases. */
  items: z
    .array(
      z.strictObject({
        position: z.int().min(0),
        productId: ProductId,
        variantId: VariantId,
        releaseId: ReleaseId,
        manifestSha256: Sha256Hex,
        entitlementId: EntitlementId.nullable(),
      }),
    )
    .min(1)
    .max(20),
});
export type InstallGrantClaims = z.infer<typeof InstallGrantClaims>;

/** What one download grant binds: a `downloads` row bound to the session user until `expires_at` (TM-DL-1). */
export const DownloadGrantClaims = z
  .strictObject({
    downloadId: DownloadId,
    userId: UserId,
    kind: DownloadKind,
    channel: z.enum(['web', 'mcp']),
    expiresAt: z.date(),
    combine: z.boolean(),
    items: z
      .array(
        z.strictObject({
          position: z.int().min(0),
          productId: ProductId,
          variantId: VariantId,
          releaseId: ReleaseId,
          entitlementId: EntitlementId.nullable(),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((c) => !c.combine || c.items.length >= 2, { message: 'a combined download has at least two items' });
export type DownloadGrantClaims = z.infer<typeof DownloadGrantClaims>;

/** True while a grant may still be exchanged (`expires_at > now`, strict). */
export function grantIsLive(claims: { expiresAt: Date }, at: Date): boolean {
  return claims.expiresAt.getTime() > at.getTime();
}

// ---- POST /api/downloads (ROUTES 6.5) ----------------------------------------------------------------
export const DownloadRequest = z
  .strictObject({
    items: z
      .array(z.strictObject({ assetId: z.string().min(1).max(64) }))
      .min(1)
      .max(20),
    combine: z.boolean().optional(),
  })
  .refine((b) => new Set(b.items.map((i) => i.assetId)).size === b.items.length, 'duplicate assetId');
export type DownloadRequest = z.infer<typeof DownloadRequest>;

// ---- POST /grants/redeem (MCP_PROTOCOL 10.4) ---------------------------------------------------------
export const RedeemRequest = z.strictObject({
  grantCode: InstallGrantCode,
  verifier: InstallVerifier,
  client: z.strictObject({ name: z.string().min(1).max(100), version: SemVer }),
});
export type RedeemRequest = z.infer<typeof RedeemRequest>;

export const RedeemResponseItem = z.strictObject({
  position: z.int().min(0),
  releaseId: ReleaseId,
  productId: ProductId,
  productKind: ProductKind,
  variantKind: VariantKind,
  slug: Slug,
  version: SemVer,
  manifestSha256: Sha256Hex,
  objectSha256: Sha256Hex,
  objectSizeBytes: z.int().min(0),
  manifestUrl: HttpsUrl,
  objectUrl: HttpsUrl,
});

export const RedeemResponse = z.strictObject({
  installId: InstallId,
  status: z.literal('redeemed'),
  channel: z.enum(['mcp', 'cli']),
  selectionId: SelectionId.nullable(),
  fetchKey: FetchKey,
  fetchExpiresAt: Instant,
  creditsConsumed: z.int().min(0),
  items: z.array(RedeemResponseItem).min(1),
});
export type RedeemResponse = z.infer<typeof RedeemResponse>;

// ---- POST /grants/{installId}/report (MCP_PROTOCOL 10.6) ---------------------------------------------
export const InstallReport = z
  .strictObject({
    outcome: z.enum(['confirmed', 'failed']),
    failureCode: CliVerificationCode.nullable(),
    items: z.array(
      z.strictObject({
        position: z.int().min(0),
        result: z.enum(['installed', 'skipped', 'failed']),
        filesWritten: z.int().min(0),
      }),
    ),
  })
  .refine(
    (r) => (r.outcome === 'failed') === (r.failureCode !== null),
    'failureCode is set exactly when outcome is failed',
  );
export type InstallReport = z.infer<typeof InstallReport>;

/** Shared error body for /install/prepare and /grants/* (MCP_PROTOCOL 10.3–10.5, ROUTES 1.8). */
export const GrantErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string().max(500), retryable: z.boolean().optional() }),
});
