// RELEASE_FORMAT 6.2 and 7.1: the source hash, SHA-256 helpers and Ed25519 manifest signatures, using only
// Web Crypto (Workers: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ ;
// Node 22: https://nodejs.org/docs/latest-v22.x/api/webcrypto.html). No `NODE-ED25519`, no Node imports.
import { canonicalize } from './jcs';
import { compareBytewise } from './paths';

/** Context strings (GLOSSARY 5.2). Brand-free, so a rename never invalidates old releases. */
export const SOURCE_HASH_CONTEXT = 'release-source-hash/v1\n';
export const MANIFEST_SIGNING_CONTEXT = 'release-manifest/v1\n';

export interface SourceHashFile {
  path: string;
  sha256: string;
  size: number;
}

/** The Web Crypto key type, named without relying on the DOM lib or Node's `webcrypto` namespace. */
export type WebCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * The exact text hashed into `sourceHash`: the context line, then one line per file sorted by path (byte-wise):
 * `sha256 SP decimal(size) SP path LF`. Independent of archive settings, manifest metadata and signature.
 */
export function sourceHashInput(files: readonly SourceHashFile[]): string {
  const sorted = [...files].sort((a, b) => compareBytewise(a.path, b.path));
  let out = SOURCE_HASH_CONTEXT;
  for (const f of sorted) out += `${f.sha256} ${String(f.size)} ${f.path}\n`;
  return out;
}

export async function computeSourceHash(files: readonly SourceHashFile[]): Promise<string> {
  return sha256Hex(sourceHashInput(files));
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `UTF-8("release-manifest/v1\n") || JCS(manifest without "signature")`. */
export function manifestSigningInput(manifest: Readonly<Record<string, unknown>>): Uint8Array {
  const { signature: _signature, ...payload } = manifest;
  return new TextEncoder().encode(MANIFEST_SIGNING_CONTEXT + canonicalize(payload));
}

/** Imports a raw 32-byte Ed25519 public key given as base64 (`signing_keys.public_key`). */
export async function importEd25519PublicKey(publicKeyBase64: string): Promise<WebCryptoKey> {
  const raw = base64ToBytes(publicKeyBase64);
  if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
}

/** Verifies `signature.value` (base64, 64 bytes) over the manifest signing input. Never throws on a bad signature. */
export async function verifyManifestSignature(
  manifest: Readonly<Record<string, unknown>> & { signature: { algorithm: string; value: string } },
  publicKey: WebCryptoKey,
): Promise<boolean> {
  if (manifest.signature.algorithm !== 'Ed25519') return false;
  let sig: Uint8Array;
  try {
    sig = base64ToBytes(manifest.signature.value);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, sig, manifestSigningInput(manifest));
}
