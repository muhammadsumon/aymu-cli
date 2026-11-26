// RELEASE_FORMAT 15.3 F2–F3 (plan) and G1–G4 (commit with rollback); SECURITY_MODEL 11 A1–A5.
// Nothing is written until the whole plan is known and every check has passed. The commit is a directory rename:
// the verified files are written into a sibling staging directory on the same file system (0700 directories during
// staging, files 0644 with O_CREAT|O_EXCL, links never created), then `rename()` onto `install.root`, which must not
// exist. An upgrade renames the old root to a backup first and renames it back on any error. Staging and backups are
// always removed, including on SIGINT. Nothing is ever written outside an item's own root.
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { sha256Hex } from '@aymu/domain/manifest';
import type { ReleaseManifestV1 } from '@aymu/domain/manifest';
import { CliError, EXIT, verificationError } from './errors';
import { assertNoSymlinks, caseCollision } from './project';

export type ConflictMode = 'refuse' | 'skip-identical' | 'upgrade';

export interface PlannedFile {
  readonly path: string;
  readonly action: 'create' | 'skip' | 'replace';
}

export interface ItemPlan {
  /** Absolute target root (the section root, or the template's new directory). */
  readonly targetRoot: string;
  /** How the root is committed. */
  readonly strategy: 'rename-new' | 'upgrade' | 'files-into-existing' | 'nothing';
  readonly files: readonly PlannedFile[];
  /** Release-relative path → bytes, already verified. */
  readonly contents: ReadonlyMap<string, Uint8Array>;
  /** The prefix stripped from release paths to get root-relative paths (`install.root`, or '' for templates). */
  readonly prefix: string;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw new CliError(EXIT.refused, 'unsafe_path', `Refusing a symlink inside the target: ${full}`);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function rel(prefix: string, path: string): string {
  return prefix === '' || prefix === '.' ? path : path.slice(prefix.length + 1);
}

/**
 * F2–F3 for one item. `projectRoot` is the directory install paths are relative to (the project root for sections, the
 * new directory for templates). Throws `target_exists` / `path_collision` / `local_changes` refusals (exit 2).
 */
export async function planItem(
  projectRoot: string,
  manifest: ReleaseManifestV1,
  contents: ReadonlyMap<string, Uint8Array>,
  mode: ConflictMode,
  platform: NodeJS.Platform,
): Promise<ItemPlan> {
  const isTemplate = manifest.release.variantKind === 'astro_project';
  const rootRel = isTemplate ? '' : (manifest.install?.root ?? '');
  const targetRoot = isTemplate ? resolve(projectRoot) : resolve(projectRoot, rootRel);
  // F2: the resolved target stays under the project root.
  const back = relative(resolve(projectRoot), targetRoot);
  if (back.startsWith('..') || resolve(projectRoot, back) !== targetRoot) {
    throw verificationError('unsafe_path', 'The install root resolves outside the project.');
  }
  await assertNoSymlinks(dirname(resolve(projectRoot)), targetRoot);
  const conflicts: string[] = [];
  for (const path of contents.keys()) {
    for (const segment of path.split('/')) {
      if (platform === 'win32' && WINDOWS_RESERVED.test(segment)) conflicts.push(`${path} (reserved name on Windows)`);
    }
  }
  if (conflicts.length) throw verificationError('path_collision', 'Some paths cannot exist on this system.', conflicts);

  // A case-insensitive sibling of the root (Hero vs hero) is a collision too.
  const rootName = targetRoot.split(sep).pop() ?? '';
  const sibling = await caseCollision(dirname(targetRoot), rootName);
  if (sibling) throw verificationError('path_collision', `A differently cased ${sibling} already exists.`, [sibling]);

  const releasePaths = [...contents.keys()].sort();
  if (!(await exists(targetRoot))) {
    return {
      targetRoot,
      strategy: 'rename-new',
      files: releasePaths.map((path) => ({ path, action: 'create' })),
      contents,
      prefix: rootRel,
    };
  }
  const stat = await lstat(targetRoot);
  if (!stat.isDirectory())
    throw verificationError('target_exists', `${targetRoot} exists and is not a directory.`, [targetRoot]);
  const existing = await listFiles(targetRoot);
  if (isTemplate) {
    // P3: a template goes into a NEW directory; an existing empty one is allowed, anything else refuses.
    if (existing.length === 0) {
      return {
        targetRoot,
        strategy: 'rename-new',
        files: releasePaths.map((path) => ({ path, action: 'create' })),
        contents,
        prefix: '',
      };
    }
    throw verificationError('target_exists', `${targetRoot} is not empty; templates install into a new directory.`, [
      targetRoot,
    ]);
  }

  if (mode === 'upgrade') {
    // --upgrade: same product, and every installed file still matches the installed manifest (no local edits).
    const installedPath = join(targetRoot, 'release-manifest.json');
    type InstalledManifest = { release?: { productId?: string }; files?: { path: string; sha256: string }[] };
    let installed: InstalledManifest | null;
    try {
      installed = JSON.parse(await readFile(installedPath, 'utf8')) as InstalledManifest;
    } catch {
      installed = null;
    }
    if (!installed || installed.release?.productId !== manifest.release.productId || !Array.isArray(installed.files)) {
      throw verificationError('target_exists', `${targetRoot} is not an installed copy of this section.`, [targetRoot]);
    }
    const expectedFiles = new Map(installed.files.map((f) => [rel(rootRel, f.path), f.sha256]));
    const edits: string[] = [];
    for (const file of existing) {
      if (file === 'release-manifest.json') continue;
      const want = expectedFiles.get(file);
      const have = await sha256Hex(new Uint8Array(await readFile(join(targetRoot, file))));
      if (want === undefined) edits.push(`${file} (added locally)`);
      else if (want !== have) edits.push(`${file} (edited locally)`);
    }
    for (const file of expectedFiles.keys()) if (!existing.includes(file)) edits.push(`${file} (deleted locally)`);
    if (edits.length)
      throw verificationError('local_changes', 'The installed section has local changes; nothing was replaced.', edits);
    return {
      targetRoot,
      strategy: 'upgrade',
      files: releasePaths.map((path) => ({ path, action: 'replace' })),
      contents,
      prefix: rootRel,
    };
  }

  if (mode === 'refuse') {
    throw verificationError(
      'target_exists',
      `${targetRoot} already exists; nothing was written (use --on-conflict skip-identical or --upgrade).`,
      existing.map((f) => join(targetRoot, f)),
    );
  }

  // skip-identical: equal files stay, missing files are added, any other difference refuses.
  const files: PlannedFile[] = [];
  const differing: string[] = [];
  const lowerExisting = new Map(existing.map((f) => [f.toLowerCase(), f]));
  for (const path of releasePaths) {
    const r = rel(rootRel, path);
    const same = lowerExisting.get(r.toLowerCase());
    if (same === undefined) {
      files.push({ path, action: 'create' });
      continue;
    }
    if (same !== r) {
      differing.push(`${r} (case differs from ${same})`);
      continue;
    }
    const have = await sha256Hex(new Uint8Array(await readFile(join(targetRoot, r))));
    if (have === (await sha256Hex(contents.get(path) as Uint8Array))) files.push({ path, action: 'skip' });
    else differing.push(`${r} (different content)`);
  }
  if (differing.length)
    throw verificationError('target_exists', 'Existing files differ; nothing was written.', differing);
  const strategy = files.every((f) => f.action === 'skip') ? 'nothing' : 'files-into-existing';
  return { targetRoot, strategy, files, contents, prefix: rootRel };
}

// ---- commit ----------------------------------------------------------------------------------------------------------

export interface Transaction {
  /** Undo everything this run created, newest first. Safe to call twice. */
  rollback(): Promise<void>;
  /** Remove staging and backups after success. */
  finish(): Promise<void>;
}

const token = () => randomBytes(6).toString('hex');

async function writeTree(dir: string, files: Iterable<[string, Uint8Array]>): Promise<void> {
  await mkdir(dir, { mode: 0o700 });
  const dirs = new Set<string>();
  for (const [path, bytes] of files) {
    const full = join(dir, ...path.split('/'));
    const parent = dirname(full);
    if (!dirs.has(parent)) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      dirs.add(parent);
    }
    const handle = await open(full, 'wx', 0o644);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }
  // Staging directories were private; the installed tree gets ordinary directory permissions before the rename.
  for (const d of [...dirs, dir]) await chmod(d, 0o755);
}

/** Creates the missing ancestors of `dir`, returning the ones created (outermost first) for rollback. */
async function ensureParents(dir: string): Promise<string[]> {
  const missing: string[] = [];
  let p = dirname(dir);
  while (!(await exists(p))) {
    missing.unshift(p);
    p = dirname(p);
  }
  for (const m of missing) await mkdir(m, { mode: 0o755 });
  return missing;
}

export interface CommitHooks {
  /** Test seam: called before each filesystem write step; throw to inject a failure (TEST_PLAN 13 C10). */
  readonly beforeStep?: (step: string) => void | Promise<void>;
}

/** G1–G4 for a list of items (a bundle commits item by item and undoes earlier items if a later one fails). */
export async function commit(plans: readonly ItemPlan[], hooks: CommitHooks = {}): Promise<Transaction> {
  const undo: (() => Promise<void>)[] = [];
  /** Staging paths: removed first on rollback (they sit inside directories the undo steps remove). */
  const cleanup: string[] = [];
  /** Backups of upgraded roots: restored by undo on rollback, deleted only by finish(). */
  const backups: string[] = [];
  const step = async (name: string) => hooks.beforeStep?.(name);
  const tx: Transaction = {
    async rollback() {
      for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }).catch(() => undefined);
      while (undo.length) {
        const fn = undo.pop();
        try {
          await fn?.();
        } catch {
          // keep undoing
        }
      }
    },
    async finish() {
      for (const path of [...cleanup.splice(0), ...backups.splice(0)]) {
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }
      undo.length = 0;
    },
  };
  try {
    for (const plan of plans) {
      if (plan.strategy === 'nothing') continue;
      const relFiles = (onlyCreate: boolean): [string, Uint8Array][] =>
        plan.files
          .filter((f) => !onlyCreate || f.action === 'create')
          .map((f) => [rel(plan.prefix, f.path), plan.contents.get(f.path) as Uint8Array]);

      if (plan.strategy === 'files-into-existing') {
        for (const [path, bytes] of relFiles(true)) {
          const target = join(plan.targetRoot, ...path.split('/'));
          await step(`file:${path}`);
          const created = await ensureParents(target);
          undo.push(async () => {
            for (const d of [...created].reverse()) await rmdir(d).catch(() => undefined);
          });
          const staging = `${target}.staging-${token()}`;
          const handle = await open(staging, 'wx', 0o644);
          cleanup.push(staging);
          try {
            await handle.writeFile(bytes);
          } finally {
            await handle.close();
          }
          if (await exists(target)) throw verificationError('target_exists', `${target} appeared during the install.`);
          await rename(staging, target);
          undo.push(() => rm(target, { force: true }));
        }
        continue;
      }

      const parent = dirname(plan.targetRoot);
      const name = plan.targetRoot.split(sep).pop() ?? 'item';
      await step(`parents:${name}`);
      const created = await ensureParents(plan.targetRoot);
      undo.push(async () => {
        for (const d of [...created].reverse()) await rmdir(d).catch(() => undefined);
      });
      const staging = join(parent, `.${name}.staging-${token()}`);
      cleanup.push(staging);
      await step(`stage:${name}`);
      await writeTree(staging, relFiles(false));

      if (plan.strategy === 'upgrade') {
        const backup = join(parent, `.${name}.backup-${token()}`);
        await step(`backup:${name}`);
        await rename(plan.targetRoot, backup);
        undo.push(async () => {
          await rm(plan.targetRoot, { recursive: true, force: true });
          await rename(backup, plan.targetRoot);
        });
        await step(`commit:${name}`);
        await rename(staging, plan.targetRoot);
        backups.push(backup);
        continue;
      }

      await step(`commit:${name}`);
      // The root must not exist at the moment of the rename (another process may have created it meanwhile). A
      // template's pre-existing EMPTY directory is replaced, and restored empty on rollback.
      let restoreEmpty = false;
      if (await exists(plan.targetRoot)) {
        const empty = (await readdir(plan.targetRoot)).length === 0;
        if (!empty) throw verificationError('target_exists', `${plan.targetRoot} appeared during the install.`);
        await rmdir(plan.targetRoot);
        restoreEmpty = true;
      }
      await rename(staging, plan.targetRoot);
      undo.push(async () => {
        await rm(plan.targetRoot, { recursive: true, force: true });
        if (restoreEmpty) await mkdir(plan.targetRoot);
      });
    }
  } catch (error) {
    await tx.rollback();
    throw error;
  }
  return tx;
}
