// RELEASE_FORMAT 15.3 steps C1–C5: manifest verification shared by the upload API (Worker) and aymu.
// It lives in @aymu/domain/manifest because the CLI must not import @aymu/delivery (ARCHITECTURE 2.1–2.2).
// The archive steps (D, E) need a ZIP reader and run in the delivery and CLI packages on top of this.
import type { CliVerificationCode } from '../enums';
import { computeSourceHash, importEd25519PublicKey, sha256Hex, verifyManifestSignature } from './hashing';
import { parseCanonicalJson } from './jcs';
import { MAX_MANIFEST_BYTES } from './limits';
import { type KeyringEntry, ReleaseManifestV1, verificationCodeOf } from './manifest';

export interface ExpectedReleaseItem {
  releaseId: string;
  productId: string;
  productKind: string;
  variantKind: string;
  slug: string;
  version: string;
  /** When given, sha256(bytes) must equal it (B2, `manifest_hash_mismatch`). */
  manifestSha256?: string;
}

export interface VerifyManifestOptions {
  /** Trusted keys: the CLI's embedded keyring, or `signing_keys` rows for the upload API. */
  keyring: readonly KeyringEntry[];
  /** Key ids marked compromised by the key-status list; it can only make verification stricter. */
  compromisedKeyIds?: ReadonlySet<string>;
  /** The redemption item (C2). */
  expected?: ExpectedReleaseItem;
}

export type VerifyManifestResult =
  | { ok: true; manifest: ReleaseManifestV1; manifestSha256: string }
  | { ok: false; code: CliVerificationCode; message: string };

export async function verifyManifestBytes(
  bytes: Uint8Array,
  options: VerifyManifestOptions,
): Promise<VerifyManifestResult> {
  const fail = (code: CliVerificationCode, message: string): VerifyManifestResult => ({ ok: false, code, message });
  if (bytes.length > MAX_MANIFEST_BYTES) return fail('limit_exceeded', 'manifest larger than 2 MiB');
  const manifestSha256 = await sha256Hex(bytes);
  if (options.expected?.manifestSha256 !== undefined && options.expected.manifestSha256 !== manifestSha256) {
    return fail('manifest_hash_mismatch', 'manifest bytes do not match manifestSha256');
  }

  // C1: canonical bytes, then schema.
  const parsed = parseCanonicalJson(bytes);
  if (parsed === null) return fail('non_canonical_manifest', 'bytes are not JCS(parse(bytes))');
  const result = ReleaseManifestV1.safeParse(parsed);
  if (!result.success) {
    return fail(verificationCodeOf(result.error), result.error.issues[0]?.message ?? 'invalid manifest');
  }
  const manifest = result.data;

  // C2: identity agrees with the redemption item.
  const e = options.expected;
  if (
    e &&
    (manifest.release.id !== e.releaseId ||
      manifest.release.productId !== e.productId ||
      manifest.release.productKind !== e.productKind ||
      manifest.release.variantKind !== e.variantKind ||
      manifest.release.slug !== e.slug ||
      manifest.release.version !== e.version)
  ) {
    return fail('manifest_mismatch', 'manifest identity differs from the redemption item');
  }

  // C3: pinned key, not compromised, valid signature.
  const key = options.keyring.find((k) => k.keyId === manifest.signature.keyId);
  if (!key) return fail('unknown_signing_key', 'signing key is not in the keyring; update the CLI');
  if (key.status === 'compromised' || options.compromisedKeyIds?.has(key.keyId)) {
    return fail('signing_key_compromised', 'signing key is compromised');
  }
  const publicKey = await importEd25519PublicKey(key.publicKey);
  if (!(await verifyManifestSignature(manifest, publicKey)))
    return fail('signature_invalid', 'Ed25519 signature does not verify');

  // C4 ran inside the schema (paths, roles, limits, install root). C5: recompute the source hash.
  if ((await computeSourceHash(manifest.files)) !== manifest.sourceHash) {
    return fail('source_hash_mismatch', 'sourceHash does not match files[]');
  }
  return { ok: true, manifest, manifestSha256 };
}
