// RELEASE_FORMAT 15.3 A1–A3 and F1 (SECURITY_MODEL 11 P1–P4): find the Astro project, read the installed Astro and
// Tailwind CSS versions (node_modules first, then the lockfile), the Node version and the package manager, and refuse
// any symlinked path segment. Read-only.
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CliError, EXIT, verificationError } from './errors';
import { satisfies } from './semver';

export interface ProjectInfo {
  readonly root: string;
  readonly astro: string | null;
  readonly tailwindcss: string | null;
  readonly node: string;
  readonly packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  readonly dependencies: Readonly<Record<string, string>>;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deps(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const block = pkg[key];
    if (block && typeof block === 'object') {
      for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
        if (typeof range === 'string') out[name] = range;
      }
    }
  }
  return out;
}

/** A1 (sections): the nearest ancestor of `start` whose package.json lists `astro`. */
export async function findAstroProject(start: string): Promise<string | null> {
  let dir = resolve(start);
  for (;;) {
    const pkg = await readJson(join(dir, 'package.json'));
    if (pkg && 'astro' in deps(pkg)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function installedVersion(root: string, name: string, lockText: string | null): Promise<string | null> {
  const pkg = await readJson(join(root, 'node_modules', name, 'package.json'));
  if (pkg && typeof pkg.version === 'string') return pkg.version;
  if (lockText) {
    // pnpm-lock.yaml v9 package keys: `/astro@7.4.13` or `astro@7.4.13:`; package-lock: "node_modules/astro": { "version" }.
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const pnpm = new RegExp(`(?:^|\\s|/)${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)[:(]`, 'm').exec(lockText);
    if (pnpm?.[1]) return pnpm[1];
    const npm = new RegExp(`"node_modules/${escaped}"\\s*:\\s*\\{[^}]*?"version"\\s*:\\s*"([^"]+)"`).exec(lockText);
    if (npm?.[1]) return npm[1];
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** A2: versions and the package manager of a project root. */
export async function inspectProject(root: string, nodeVersion: string): Promise<ProjectInfo> {
  const pkg = (await readJson(join(root, 'package.json'))) ?? {};
  const locks: [string, ProjectInfo['packageManager']][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
  ];
  let manager: ProjectInfo['packageManager'] = 'npm';
  let lockText: string | null = null;
  for (const [file, pm] of locks) {
    if (await exists(join(root, file))) {
      manager = pm;
      lockText = await readFile(join(root, file), 'utf8').catch(() => null);
      break;
    }
  }
  const declared =
    typeof pkg.packageManager === 'string' ? /^(pnpm|npm|yarn|bun)@/.exec(pkg.packageManager)?.[1] : null;
  if (declared) manager = declared as ProjectInfo['packageManager'];
  return {
    root,
    astro: await installedVersion(root, 'astro', lockText),
    tailwindcss: await installedVersion(root, 'tailwindcss', lockText),
    node: nodeVersion,
    packageManager: manager,
    dependencies: deps(pkg),
  };
}

/** A3 / P4: no segment from `root` down to `target` (inclusive, where it exists) is a symlink. */
export async function assertNoSymlinks(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '..' || resolve(root, rel) !== resolve(target)) {
    throw verificationError('unsafe_path', `Target ${target} is outside the project.`);
  }
  const segments = [root, ...rel.split(sep).filter(Boolean)];
  let current = '';
  for (const [i, segment] of segments.entries()) {
    current = i === 0 ? segment : join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return; // the rest does not exist yet: nothing below can be a link
    }
    if (stat.isSymbolicLink()) {
      throw new CliError(EXIT.refused, 'unsafe_path', `Refusing a symlinked path: ${current}`);
    }
  }
}

export interface RequirementCheck {
  readonly name: 'astro' | 'tailwindcss' | 'node';
  readonly required: string;
  readonly installed: string | null;
  readonly ok: boolean;
}

/** F1: installed versions against `requirements` (null requirement = no check). */
export function checkRequirements(
  project: ProjectInfo,
  requirements: { astro: string | null; tailwindcss: string | null; node: string | null },
): RequirementCheck[] {
  const out: RequirementCheck[] = [];
  for (const name of ['astro', 'tailwindcss', 'node'] as const) {
    const required = requirements[name];
    if (required === null) continue;
    const installed = project[name];
    out.push({ name, required, installed, ok: installed !== null && satisfies(installed, required) });
  }
  return out;
}

/** F3: case-insensitive siblings of `name` in `dir` (a different spelling of an existing entry is a collision). */
export async function caseCollision(dir: string, name: string): Promise<string | null> {
  let list: string[];
  try {
    list = await readdir(dir);
  } catch {
    return null;
  }
  const lower = name.toLowerCase();
  return list.find((n) => n.toLowerCase() === lower && n !== name) ?? null;
}
