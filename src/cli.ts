// The `aymu` dispatcher: parses argv, runs one command against an injected `Io`, and maps every failure to its exit
// code (RELEASE_FORMAT 15.2). It never throws; errors are printed redacted, as one JSON object with `--json`.
import { RECOMMENDED_CLI_VERSION } from '@aymu/domain';
import { parseArgs, USAGE } from './args';
import { CliError, EXIT } from './errors';
import { type AddDeps, runAdd } from './install';
import { runDoctor, runList } from './inspect';
import { type Io, redacted } from './io';
import { login } from './login';
import { resolveOrigin } from './config';

export const CLI_VERSION = RECOMMENDED_CLI_VERSION;

export async function runCli(argv: readonly string[], io: Io, deps: AddDeps = {}): Promise<number> {
  const safeIo: Io = { ...io, out: (l) => io.out(redacted(l)), err: (l) => io.err(redacted(l)) };
  const json = argv.includes('--json');
  try {
    const args = parseArgs(argv);
    switch (args.command) {
      case 'help':
        for (const line of USAGE) safeIo.out(line);
        return EXIT.ok;
      case 'version':
        safeIo.out(CLI_VERSION);
        return EXIT.ok;
      case 'add':
        await runAdd(safeIo, args, deps);
        return EXIT.ok;
      case 'list':
        return await runList(safeIo, args.json);
      case 'doctor':
        return await runDoctor(safeIo, args);
      case 'login': {
        if (args.logout) {
          safeIo.out('No stored session to remove: this build keeps tokens in memory for a single run only.');
          return EXIT.ok;
        }
        await login(safeIo, resolveOrigin(args.server, io.env), deps.listen);
        safeIo.out('Sign-in works. Run aymu add section <id> to sign in and install in one step.');
        return EXIT.ok;
      }
    }
  } catch (error) {
    const e =
      error instanceof CliError
        ? error
        : new CliError(EXIT.other, 'internal_error', error instanceof Error ? error.message : 'Unexpected failure.');
    if (json) {
      safeIo.out(
        JSON.stringify({ status: 'error', code: e.code, message: e.message, details: e.details, exitCode: e.exitCode }),
      );
    } else {
      safeIo.err(`error (${e.code}): ${e.message}`);
      for (const d of e.details.slice(0, 50)) safeIo.err(`  - ${d}`);
    }
    return e.exitCode;
  }
}
