// Command-line parsing (RELEASE_FORMAT 15.2; GLOSSARY 11 CLI flags). Strict: unknown flags are usage errors, and a
// grant code anywhere in argv is refused before anything else (SECURITY_MODEL 11 C1), with guidance.
import { CliError, EXIT, usageError } from './errors';

export interface AddArgs {
  readonly command: 'add';
  readonly kind: 'section' | 'template' | 'bundle';
  readonly id: string;
  readonly begin: boolean;
  readonly challenge: string | undefined;
  readonly grantStdin: boolean;
  readonly json: boolean;
  readonly onConflict: 'refuse' | 'skip-identical';
  readonly upgrade: boolean;
  readonly dir: string | undefined;
  readonly yes: boolean;
  readonly server: string | undefined;
}

export type ParsedArgs =
  | AddArgs
  | { command: 'doctor'; zip: string | undefined; json: boolean; server: string | undefined }
  | { command: 'list'; json: boolean }
  | { command: 'login'; logout: boolean; server: string | undefined }
  | { command: 'help' }
  | { command: 'version' };

const ID_RE = /^(tpl|sec|var|rel|sbd)_[0-9a-hjkmnp-tv-z]{26}$/;

export const USAGE = [
  'Usage: aymu <command> [options]',
  '',
  'Commands:',
  '  add section <id>        Install a section into the Astro project in this directory',
  '  add template <id>       Create a new project from a template (in a new directory, see --dir)',
  '  add bundle <selection>  Install the sections chosen on a selection board',
  '  doctor [--zip <file>]   Check this project, or verify a downloaded release ZIP offline',
  '  list                    List installed sections and whether their files are unchanged',
  '  login [--logout]        Sign in through the browser for direct installs',
  '',
  'Install options:',
  '  --begin                 Print a one-time challenge for an agent (the verifier stays on this machine)',
  '  --challenge <c>         Use the verifier created by --begin for this challenge',
  '  --grant-stdin           Read the install grant from stdin (or set BRAND_INSTALL_GRANT); never pass it as an argument',
  '  --on-conflict <mode>    refuse (default) or skip-identical',
  '  --upgrade               Replace an installed section that has no local changes',
  '  --dir <path>            New directory for a template (must not exist, or be empty)',
  '  --yes                   Skip the confirmation prompt',
  '  --json                  Machine-readable output',
  '',
  'Exit codes: 0 installed, 2 refused (nothing written), 3 verification failure (nothing written),',
  '            4 access or grant error, 1 other.',
];

export function parseArgs(argv: readonly string[]): ParsedArgs {
  // C1: refuse a grant code (or fetch key) passed as an argument, whatever the command.
  if (argv.some((a) => /\big_[A-Za-z0-9_-]{20,}/.test(a) || /\bigf_[A-Za-z0-9_-]{20,}/.test(a))) {
    throw new CliError(
      EXIT.access,
      'grant_in_argv',
      'Never pass an install grant as a command-line argument (it would land in shell history and process lists). ' +
        'Pipe it on stdin with --grant-stdin, or set BRAND_INSTALL_GRANT.',
    );
  }
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') return { command: 'help' };
  if (first === '--version' || first === '-v') return { command: 'version' };

  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const WITH_VALUE = new Set(['--challenge', '--on-conflict', '--dir', '--zip', '--server']);
  const BOOLEAN = new Set(['--begin', '--grant-stdin', '--json', '--upgrade', '--yes', '--logout']);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i] as string;
    if (a.startsWith('--')) {
      const [name, inline] = a.split('=', 2) as [string, string | undefined];
      if (WITH_VALUE.has(name)) {
        const value = inline ?? rest[i + 1];
        if (value === undefined || (inline === undefined && value.startsWith('--')))
          throw usageError(`${name} needs a value`);
        if (inline === undefined) i += 1;
        flags.set(name, value);
      } else if (BOOLEAN.has(name) && inline === undefined) {
        flags.set(name, true);
      } else {
        throw usageError(`Unknown option ${name}`);
      }
    } else {
      positional.push(a);
    }
  }
  const str = (name: string) => {
    const v = flags.get(name);
    return typeof v === 'string' ? v : undefined;
  };
  const bool = (name: string) => flags.get(name) === true;
  const allow = (names: string[]) => {
    for (const name of flags.keys())
      if (!names.includes(name)) throw usageError(`${name} does not apply to "${first}"`);
  };

  switch (first) {
    case 'add': {
      allow([
        '--begin',
        '--challenge',
        '--grant-stdin',
        '--json',
        '--on-conflict',
        '--upgrade',
        '--dir',
        '--yes',
        '--server',
      ]);
      const [kind, id, extra] = positional;
      if (kind !== 'section' && kind !== 'template' && kind !== 'bundle')
        throw usageError('Usage: aymu add section|template|bundle <id>');
      if (!id || !ID_RE.test(id) || extra !== undefined) throw usageError(`"${id ?? ''}" is not a valid id`);
      if (kind === 'bundle' && !id.startsWith('sbd_')) throw usageError('add bundle takes a selection id (sbd_…)');
      if (kind === 'section' && !/^(sec|var|rel)_/.test(id))
        throw usageError('add section takes a section, variant or release id');
      if (kind === 'template' && !/^(tpl|var|rel)_/.test(id))
        throw usageError('add template takes a template, variant or release id');
      const onConflict = str('--on-conflict') ?? 'refuse';
      if (onConflict !== 'refuse' && onConflict !== 'skip-identical')
        throw usageError('--on-conflict is refuse or skip-identical');
      if (bool('--upgrade') && kind !== 'section') throw usageError('--upgrade applies to sections only');
      if (bool('--upgrade') && onConflict !== 'refuse')
        throw usageError('--upgrade and --on-conflict cannot be combined');
      if (str('--dir') !== undefined && kind !== 'template') throw usageError('--dir applies to templates only');
      if (bool('--begin') && (bool('--grant-stdin') || str('--challenge'))) throw usageError('--begin runs on its own');
      if (bool('--grant-stdin') && !str('--challenge'))
        throw usageError('--grant-stdin needs --challenge <c> from --begin');
      return {
        command: 'add',
        kind,
        id,
        begin: bool('--begin'),
        challenge: str('--challenge'),
        grantStdin: bool('--grant-stdin'),
        json: bool('--json'),
        onConflict,
        upgrade: bool('--upgrade'),
        dir: str('--dir'),
        yes: bool('--yes'),
        server: str('--server'),
      };
    }
    case 'doctor':
      allow(['--zip', '--json', '--server']);
      if (positional.length) throw usageError('doctor takes no arguments');
      return { command: 'doctor', zip: str('--zip'), json: bool('--json'), server: str('--server') };
    case 'list':
      allow(['--json']);
      if (positional.length) throw usageError('list takes no arguments');
      return { command: 'list', json: bool('--json') };
    case 'login':
      allow(['--logout', '--server']);
      if (positional.length) throw usageError('login takes no arguments');
      return { command: 'login', logout: bool('--logout'), server: str('--server') };
    default:
      throw usageError(`Unknown command: ${first}`);
  }
}
