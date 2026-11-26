// The embedded signing-key keyring (RELEASE_FORMAT 7.2, ADR-17). `keyring.json` ships inside the published package and
// lists every key the CLI trusts. It is EMPTY until the owner registers the first production key (`signing_keys`,
// Prompt 4 packager `keygen`), so a real install refuses every release with `unknown_signing_key` until then: that is
// the intended fail-closed state, not a bug. Test keys are never added here; tests inject a keyring through the
// programmatic `Io.keyring` only (no flag or env var can add trust).
// The status list `https://[DOMAIN]/release-keys.json` can only make an embedded key stricter (compromised).
import { KeyringEntry, ReleaseKeysDocument } from '@aymu/domain/manifest';
import { z } from 'zod';
import raw from './keyring.json' with { type: 'json' };

const KeyringFile = z.strictObject({ keyringVersion: z.literal(1), keys: z.array(KeyringEntry) });

export const EMBEDDED_KEYRING: readonly KeyringEntry[] = KeyringFile.parse(raw).keys;

/** Key ids the server's status list marks compromised, restricted to keys this CLI embeds. */
export async function compromisedKeyIds(
  fetcher: typeof fetch,
  webOrigin: string,
  keyring: readonly KeyringEntry[],
): Promise<{ ids: Set<string>; reachable: boolean }> {
  try {
    const res = await fetcher(`${webOrigin}/release-keys.json`, { redirect: 'error' });
    if (!res.ok) return { ids: new Set(), reachable: false };
    const doc = ReleaseKeysDocument.safeParse(await res.json());
    if (!doc.success) return { ids: new Set(), reachable: false };
    const embedded = new Set(keyring.map((k) => k.keyId));
    return {
      ids: new Set(
        doc.data.keys.filter((k) => k.status === 'compromised' && embedded.has(k.keyId)).map((k) => k.keyId),
      ),
      reachable: true,
    };
  } catch {
    return { ids: new Set(), reachable: false };
  }
}
