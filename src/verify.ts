// RELEASE_FORMAT 15.3 steps C (manifest), D (archive, without trusting it) and E2 (staged hashes), in memory. The
// manifest checks C1–C5 are the shared `verifyManifestBytes` from @aymu/domain/manifest (the upload API runs the same
// code). Any failure is a `CliError` with the verification code; nothing here touches the project.
import type { KeyringEntry, ReleaseManifestV1 } from '@aymu/domain/manifest';
import {
  EMBEDDED_MANIFEST_NAME,
  RELEASE_LIMITS,
  type ExpectedReleaseItem,
  lifecycleScriptsIn,
  pathRulesForKind,
  sha256Hex,
  validatePathSet,
  validateReleasePath,
  verifyManifestBytes,
} from '@aymu/domain/manifest';
import { verificationError } from './errors';
import { inflateEntry, ratioOk, readCentralDirectory, unixFileType, ZipFormatError } from './zip';

/** SECURITY_MODEL 11 V7: lifecycle scripts a delivered package.json may never carry. */

export interface VerifiedRelease {
  readonly manifest: ReleaseManifestV1;
  readonly manifestBytes: Uint8Array;
  /** Every file by path (including the embedded manifest at `install.manifestPath`). */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface VerifyInput {
  readonly manifestBytes: Uint8Array;
  readonly objectBytes: Uint8Array;
  readonly expected: ExpectedReleaseItem & { objectSha256: string; objectSizeBytes: number };
  readonly keyring: readonly KeyringEntry[];
  readonly compromisedKeyIds?: ReadonlySet<string>;
}

export async function verifyRelease(input: VerifyInput): Promise<VerifiedRelease> {
  const { expected } = input;
  // B3: the object hash and size the server bound at prepare time.
  if (
    input.objectBytes.length !== expected.objectSizeBytes ||
    (await sha256Hex(input.objectBytes)) !== expected.objectSha256
  ) {
    throw verificationError('object_hash_mismatch', 'The downloaded archive does not match its recorded SHA-256.');
  }
  // C1–C5 (B2 manifest hash included through `expected.manifestSha256`).
  const verified = await verifyManifestBytes(input.manifestBytes, {
    keyring: input.keyring,
    ...(input.compromisedKeyIds ? { compromisedKeyIds: input.compromisedKeyIds } : {}),
    expected,
  });
  if (!verified.ok) throw verificationError(verified.code, verified.message);
  const manifest = verified.manifest;
  const kind = manifest.release.variantKind;
  if (kind !== 'astro_section' && kind !== 'astro_project') {
    throw verificationError('manifest_mismatch', 'Only Astro sections and templates install with the CLI.');
  }
  const limits = RELEASE_LIMITS[kind];
  if (input.objectBytes.length > limits.maxObjectBytes)
    throw verificationError('limit_exceeded', 'The archive is too large.');

  // D1–D3.
  let entries;
  try {
    entries = readCentralDirectory(input.objectBytes);
  } catch (error) {
    throw verificationError('archive_invalid', error instanceof Error ? error.message : 'invalid archive');
  }
  const manifestPath = manifest.install?.manifestPath ?? EMBEDDED_MANIFEST_NAME;
  const expectedNames = new Map(manifest.files.map((f) => [f.path, f]));
  const rules = pathRulesForKind(kind);
  const names = entries.map((e) => e.name);
  if (entries.length > limits.maxFiles + 1) throw verificationError('limit_exceeded', 'Too many archive entries.');
  for (const issue of validatePathSet(names)) {
    throw verificationError(
      'archive_invalid',
      `Archive entries collide (${issue.code}): ${issue.path} and ${issue.other}`,
    );
  }
  let total = 0;
  for (const entry of entries) {
    const type = unixFileType(entry);
    if (type === 'directory' || entry.name.endsWith('/')) {
      throw verificationError('archive_invalid', `Directory entries are not accepted: ${entry.name}`);
    }
    if (type !== 'regular') {
      throw verificationError('unsafe_path', `Symlink, device or special entries are refused: ${entry.name}`);
    }
    const pathIssue = validateReleasePath(entry.name, rules);
    if (pathIssue)
      throw verificationError('unsafe_path', `Unsafe entry path ${JSON.stringify(entry.name)}: ${pathIssue.message}`);
    if (entry.name !== manifestPath && !expectedNames.has(entry.name)) {
      throw verificationError('unexpected_entry', `The archive holds a file the manifest does not list: ${entry.name}`);
    }
    const declared = entry.name === manifestPath ? input.manifestBytes.length : expectedNames.get(entry.name)?.size;
    if (declared !== entry.uncompressedSize) {
      throw verificationError('archive_invalid', `Declared size differs from the manifest for ${entry.name}`);
    }
    if (entry.uncompressedSize > limits.maxFileBytes)
      throw verificationError('limit_exceeded', `File too large: ${entry.name}`);
    if (!ratioOk(entry)) throw verificationError('limit_exceeded', `Compression ratio over the limit: ${entry.name}`);
    total += entry.uncompressedSize;
  }
  if (total > limits.maxTotalUncompressedBytes) {
    throw verificationError('limit_exceeded', 'The archive expands beyond the size limit.');
  }
  for (const path of [...expectedNames.keys(), manifestPath]) {
    if (!names.includes(path)) throw verificationError('missing_entry', `The archive is missing ${path}`);
  }

  // E1–E2 in memory: inflate under the declared size, then hash against the manifest.
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    let bytes: Uint8Array;
    try {
      bytes = inflateEntry(input.objectBytes, entry);
    } catch (error) {
      if (error instanceof ZipFormatError) throw verificationError('archive_invalid', error.message);
      throw error;
    }
    if (entry.name === manifestPath) {
      if (!equalBytes(bytes, input.manifestBytes)) {
        throw verificationError('manifest_hash_mismatch', 'The embedded manifest differs from the downloaded one.');
      }
    } else if ((await sha256Hex(bytes)) !== expectedNames.get(entry.name)?.sha256) {
      throw verificationError('file_hash_mismatch', `File hash mismatch: ${entry.name}`);
    }
    files.set(entry.name, bytes);
  }

  // V7: no lifecycle scripts in any delivered package.json (the packager refuses them too; the CLI never trusts that).
  for (const [path, bytes] of files) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
    let pkg: unknown;
    try {
      pkg = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw verificationError('archive_invalid', `${path} is not valid JSON.`);
    }
    const scripts = (pkg as { scripts?: Record<string, unknown> } | null)?.scripts ?? {};
    const found = lifecycleScriptsIn(scripts);
    if (found.length > 0) {
      throw verificationError('archive_invalid', `${path} carries lifecycle scripts (${found.join(', ')}); refused.`);
    }
  }
  return { manifest, manifestBytes: input.manifestBytes, files };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
