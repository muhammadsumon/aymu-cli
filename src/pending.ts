// The local install challenge (MCP_PROTOCOL 10.1; SECURITY_MODEL 11 C2). `--begin` makes a 32-byte verifier and its
// S256 challenge, stores `{ verifier, challenge, command, expiresAt }` as a 0600 file under the user cache directory
// (`<cache>/aymu/pending/`, a 0700 directory outside any project), and prints only the challenge. The file name is the
// first 16 hex characters of SHA-256(challenge). Expired files are deleted on every run; a file is deleted at once
// after redemption.
import { randomToken, s256Challenge } from '@aymu/domain';
import { sha256Hex } from '@aymu/domain/manifest';
import { chmod, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const PENDING_TTL_MS = 15 * 60 * 1000;

const PendingFile = z.strictObject({
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  command: z.string().max(200),
  expiresAt: z.string(),
});
export type Pending = z.infer<typeof PendingFile>;

export function pendingDir(cacheDir: string): string {
  return join(cacheDir, 'aymu', 'pending');
}

async function fileFor(cacheDir: string, challenge: string): Promise<string> {
  return join(pendingDir(cacheDir), `${(await sha256Hex(challenge)).slice(0, 16)}.json`);
}

async function ensureDir(cacheDir: string): Promise<string> {
  const dir = pendingDir(cacheDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

/** Deletes expired pending files (every run). Unknown or unreadable files are left alone. */
export async function sweepPending(cacheDir: string, now: Date): Promise<void> {
  let names: string[];
  try {
    names = await readdir(pendingDir(cacheDir));
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^[0-9a-f]{16}\.json$/.test(name)) continue;
    const path = join(pendingDir(cacheDir), name);
    try {
      const parsed = PendingFile.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success || Date.parse(parsed.data.expiresAt) <= now.getTime()) await rm(path, { force: true });
    } catch {
      await rm(path, { force: true });
    }
  }
}

export async function beginPending(cacheDir: string, command: string, now: Date): Promise<Pending> {
  const verifier = randomToken();
  const challenge = await s256Challenge(verifier);
  const pending: Pending = {
    verifier,
    challenge,
    command,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
  };
  await ensureDir(cacheDir);
  const handle = await open(await fileFor(cacheDir, challenge), 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(pending));
  } finally {
    await handle.close();
  }
  return pending;
}

/** The pending verifier for `challenge`, or null when missing, expired or not created by `command`. */
export async function readPending(
  cacheDir: string,
  challenge: string,
  command: string,
  now: Date,
): Promise<Pending | null> {
  const path = await fileFor(cacheDir, challenge);
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) return null; // someone widened the permissions: do not trust it
    const parsed = PendingFile.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (!parsed.success) return null;
    if (parsed.data.challenge !== challenge || parsed.data.command !== command) return null;
    if (Date.parse(parsed.data.expiresAt) <= now.getTime()) return null;
    if ((await s256Challenge(parsed.data.verifier)) !== challenge) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function deletePending(cacheDir: string, challenge: string): Promise<void> {
  await rm(await fileFor(cacheDir, challenge), { force: true });
}
