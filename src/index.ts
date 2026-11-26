#!/usr/bin/env node
// `aymu`, the customer installer (ARCHITECTURE 2.1, SECURITY_MODEL 11, RELEASE_FORMAT 15). The only writer to a
// customer project. This file wires the real process (streams, env, browser, signals) into the pure dispatcher.
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runCli } from './cli';
import type { Io } from './io';
import { EMBEDDED_KEYRING } from './keyring';

function cacheDir(): string {
  if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return join(homedir(), '.cache');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += b.length;
    if (size > 4096) break; // a grant is 46 characters; never buffer more
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    execFile(cmd, args, (error) => resolve(!error));
  });
}

const io: Io = {
  cwd: process.cwd(),
  env: process.env,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  readStdin,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  async confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
  fetch: globalThis.fetch.bind(globalThis),
  now: () => new Date(),
  openBrowser,
  keyring: EMBEDDED_KEYRING,
  cacheDir: cacheDir(),
  tmpDir: tmpdir(),
  onInterrupt(handler) {
    process.on('SIGINT', handler);
    return () => process.off('SIGINT', handler);
  },
};

process.exitCode = await runCli(process.argv.slice(2), io);
