// Everything the CLI touches outside its own logic, injectable so tests drive it without a real terminal or network:
// output streams, stdin, environment, working directory, clock, HTTP and the browser opener. The real wiring is in
// `index.ts`. Every line written goes through `redactGrantSecrets` (RELEASE_FORMAT 15.3 H2, SECURITY_MODEL 11 C3).
import { redactGrantSecrets } from '@aymu/domain';
import type { KeyringEntry } from '@aymu/domain/manifest';

export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  /** Reads all of stdin (the grant code on `--grant-stdin`). */
  readStdin(): Promise<string>;
  out(line: string): void;
  err(line: string): void;
  /** Asks a yes/no question on a TTY; resolves false on anything but "y"/"yes". */
  confirm(question: string): Promise<boolean>;
  fetch: typeof fetch;
  now(): Date;
  /** Opens the system browser (interactive login); returns false when it could not. */
  openBrowser(url: string): Promise<boolean>;
  /** The trusted signing keys: the embedded keyring in production; tests inject their own (API only). */
  readonly keyring: readonly KeyringEntry[];
  /** The user cache directory root (`$XDG_CACHE_HOME`, `~/Library/Caches`, `%LOCALAPPDATA%`). */
  readonly cacheDir: string;
  /** The OS temp directory for staging. */
  readonly tmpDir: string;
  /** Process signal hook for SIGINT cleanup; returns an unsubscribe function. */
  onInterrupt(handler: () => void): () => void;
}

export function redacted(text: string): string {
  return redactGrantSecrets(text);
}

export function writer(io: Io) {
  return {
    out: (line: string) => io.out(redacted(line)),
    err: (line: string) => io.err(redacted(line)),
  };
}
