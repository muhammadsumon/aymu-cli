// `aymu add section|template|bundle` (RELEASE_FORMAT 15.3 A–H; SECURITY_MODEL 11). The order matters:
//   A  local preflight (project, versions, symlinks, template target) before anything is redeemed;
//   B  redeem (the verifier file is deleted at once), then download each manifest and object under hard size caps;
//   C–E verify the signed manifest, the archive and every file hash, in memory, before any write;
//   F  compatibility, conflicts and the dependency command; print the plan; confirm on a TTY unless --yes;
//   G  commit by directory rename with rollback (also on SIGINT);
//   H  report the outcome with the fetch key (best effort).
// Any refusal exits non-zero and leaves the project exactly as it was. The grant code, verifier and fetch key never
// reach the output, the project or a log (`Io` output is redacted as well).
import { INSTALL_GRANT_ENV, InstallGrantCode, type CliVerificationCode, CLI_VERIFICATION_CODES } from '@aymu/domain';
import { RELEASE_LIMITS, MAX_MANIFEST_BYTES, integrationSteps } from '@aymu/domain/manifest';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { type ConflictMode, type ItemPlan, commit, planItem } from './apply';
import type { AddArgs } from './args';
import { resolveOrigin, webOriginOf } from './config';
import { CliError, EXIT, accessError, usageError, verificationError } from './errors';
import type { Io } from './io';
import { compromisedKeyIds } from './keyring';
import { type ListenLoopback, login } from './login';
import { beginPending, deletePending, readPending, sweepPending } from './pending';
import { assertNoSymlinks, checkRequirements, findAstroProject, inspectProject, type ProjectInfo } from './project';
import { type ServerClient, fetchBytes, prepareInteractive, redeem, report } from './server';
import { type VerifiedRelease, verifyRelease } from './verify';

export interface AddDeps {
  readonly listen?: ListenLoopback;
  readonly commitHooks?: Parameters<typeof commit>[1];
  readonly platform?: NodeJS.Platform;
}

export interface AddResult {
  readonly installId: string;
  readonly items: { productId: string; version: string; root: string; files: number; skipped: number }[];
  readonly dependencyCommand: string | null;
}

function commandKey(args: AddArgs): string {
  return `add ${args.kind} ${args.id}`;
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory()) return false;
    return (await readdir(dir)).length === 0;
  } catch {
    return true;
  }
}

function installCommandFor(pm: ProjectInfo['packageManager'], missing: string[]): string | null {
  if (missing.length === 0) return null;
  const verb = pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn add' : pm === 'bun' ? 'bun add' : 'pnpm add';
  return `${verb} ${missing.join(' ')}`;
}

function isVerificationCode(code: string): code is CliVerificationCode {
  return (CLI_VERIFICATION_CODES as readonly string[]).includes(code);
}

export async function runAdd(io: Io, args: AddArgs, deps: AddDeps = {}): Promise<AddResult | null> {
  const now = io.now();
  await sweepPending(io.cacheDir, now);

  // --begin: the challenge only (MCP_PROTOCOL 10.1). The verifier stays in a 0600 file in the user cache directory.
  if (args.begin) {
    const pending = await beginPending(io.cacheDir, commandKey(args), now);
    const out = { challenge: pending.challenge, expiresAt: pending.expiresAt };
    io.out(
      args.json
        ? JSON.stringify(out)
        : `Challenge: ${out.challenge}\nGive it to your agent for prepare_install (cliChallenge). Expires ${out.expiresAt}.`,
    );
    return null;
  }

  const origin = resolveOrigin(args.server, io.env);
  const server: ServerClient = { origin, fetch: io.fetch };

  // ---- A: local preflight (cheap project-level checks before redeeming) ----------------------------------------------
  let projectRoot: string;
  let project: ProjectInfo | null = null;
  if (args.kind === 'template') {
    if (args.dir !== undefined) {
      const dir = resolve(io.cwd, args.dir);
      if (!(await isEmptyOrMissing(dir))) {
        throw verificationError(
          'target_exists',
          `${dir} already exists and is not empty; templates install into a new directory.`,
          [dir],
        );
      }
      await assertNoSymlinks(dirname(dir), dir);
    }
    projectRoot = io.cwd;
  } else {
    const found = await findAstroProject(io.cwd);
    if (!found) {
      throw new CliError(
        EXIT.refused,
        'incompatible_project',
        'No Astro project here: run this inside a project whose package.json lists astro.',
      );
    }
    projectRoot = found;
    await assertNoSymlinks(dirname(projectRoot), projectRoot);
    project = await inspectProject(projectRoot, process.versions.node);
  }

  // ---- B1: obtain and redeem the grant ------------------------------------------------------------------------------
  let grantCode: string;
  let verifier: string;
  let challenge: string | undefined;
  if (args.grantStdin || io.env[INSTALL_GRANT_ENV]) {
    if (!args.challenge) throw usageError('Pass --challenge <c> (printed by --begin) with the grant.');
    const raw = args.grantStdin ? (await io.readStdin()).trim() : (io.env[INSTALL_GRANT_ENV] ?? '').trim();
    const parsed = InstallGrantCode.safeParse(raw);
    if (!parsed.success) throw accessError('invalid_grant', 'The install grant is not in the expected format.');
    const pending = await readPending(io.cacheDir, args.challenge, commandKey(args), now);
    if (!pending) {
      throw accessError(
        'invalid_grant',
        'No pending challenge matches: run the same command with --begin first (it expires after 15 minutes).',
      );
    }
    grantCode = parsed.data;
    verifier = pending.verifier;
    challenge = args.challenge;
  } else {
    // Interactive: sign in, then prepare through /install/prepare with a fresh local challenge (MCP_PROTOCOL 11).
    if (!io.stdinIsTTY && !args.yes) {
      throw usageError('No grant given. An agent runs --begin, then pipes the grant with --grant-stdin.');
    }
    const session = await login(io, origin, deps.listen);
    const pending = await beginPending(io.cacheDir, commandKey(args), now);
    const prepared = await prepareInteractive(server, session.accessToken, {
      ...(args.kind === 'bundle' ? { selectionId: args.id } : { assetIds: [args.id] }),
      targetFramework: 'astro',
      cliChallenge: pending.challenge,
    } as never);
    grantCode = prepared.grant.code;
    verifier = pending.verifier;
    challenge = pending.challenge;
  }

  let redemption;
  try {
    redemption = await redeem(server, grantCode, verifier);
  } finally {
    // B1: the verifier is deleted at once after the redemption attempt that used it, whatever the outcome.
    if (challenge) await deletePending(io.cacheDir, challenge);
  }
  const reportFailure = async (code: string) => {
    if (!isVerificationCode(code)) return;
    await report(server, redemption.installId, redemption.fetchKey, {
      outcome: 'failed',
      failureCode: code,
      items: redemption.items.map((i) => ({ position: i.position, result: 'failed', filesWritten: 0 })),
    });
  };

  try {
    // Cross-check the command against what the grant is for.
    const kinds = new Set(redemption.items.map((i) => i.variantKind));
    if (args.kind === 'template' && (redemption.items.length !== 1 || !kinds.has('astro_project'))) {
      throw verificationError('manifest_mismatch', 'This grant is not for one template.');
    }
    if (args.kind !== 'template' && kinds.has('astro_project')) {
      throw verificationError('manifest_mismatch', 'This grant is for a template: use aymu add template.');
    }
    if (args.kind === 'bundle' && redemption.selectionId !== args.id) {
      throw verificationError('manifest_mismatch', 'This grant was not prepared from that selection board.');
    }
    if (args.kind !== 'bundle') {
      const item = redemption.items[0];
      const matches =
        redemption.items.length === 1 &&
        item !== undefined &&
        (item.productId === args.id || item.releaseId === args.id || args.id.startsWith('var_'));
      if (!matches) throw verificationError('manifest_mismatch', 'This grant is for a different item.');
      // A `var_` id is not in the redemption response; it is checked against the signed manifest after C (below).
    }

    // ---- B2–E: download and verify every item, in memory -----------------------------------------------------------
    const compromised = await compromisedKeyIds(io.fetch, webOriginOf(origin), io.keyring);
    if (!compromised.reachable)
      io.err('Warning: the signing-key status list could not be read; continuing with the embedded keyring.');
    const verified: VerifiedRelease[] = [];
    for (const item of redemption.items) {
      const kindLimit =
        RELEASE_LIMITS[item.variantKind === 'astro_project' ? 'astro_project' : 'astro_section'].maxObjectBytes;
      const manifestBytes = await fetchBytes(server, item.manifestUrl, redemption.fetchKey, MAX_MANIFEST_BYTES);
      const objectBytes = await fetchBytes(
        server,
        item.objectUrl,
        redemption.fetchKey,
        Math.min(item.objectSizeBytes, kindLimit),
      );
      verified.push(
        await verifyRelease({
          manifestBytes,
          objectBytes,
          keyring: io.keyring,
          compromisedKeyIds: compromised.ids,
          expected: {
            releaseId: item.releaseId,
            productId: item.productId,
            productKind: item.productKind,
            variantKind: item.variantKind,
            slug: item.slug,
            version: item.version,
            manifestSha256: item.manifestSha256,
            objectSha256: item.objectSha256,
            objectSizeBytes: item.objectSizeBytes,
          },
        }),
      );
    }

    // The variant a `var_` command names must be the one the signed manifest was released for.
    if (args.kind !== 'bundle' && args.id.startsWith('var_') && verified[0]?.manifest.release.variantId !== args.id) {
      throw verificationError('manifest_mismatch', 'This grant is for a different variant.');
    }

    // ---- F: plan against the project (nothing written yet) ---------------------------------------------------------
    const plans: ItemPlan[] = [];
    const missingDeps: string[] = [];
    const notes: string[] = [];
    for (const v of verified) {
      const m = v.manifest;
      if (m.release.variantKind === 'astro_project') {
        const dir = resolve(io.cwd, args.dir ?? `./${m.release.slug}`);
        if (!(await isEmptyOrMissing(dir)))
          throw verificationError('target_exists', `${dir} already exists and is not empty.`, [dir]);
        const nodeCheck = checkRequirements(
          { ...emptyProject(dir), node: process.versions.node },
          { astro: null, tailwindcss: null, node: m.requirements.node },
        );
        const bad = nodeCheck.filter((c) => !c.ok);
        if (bad.length) {
          throw verificationError(
            'incompatible_project',
            `Node ${process.versions.node} does not satisfy ${bad[0]?.required}.`,
            bad.map((b) => `${b.name}: needs ${b.required}`),
          );
        }
        plans.push(await planItem(dir, m, v.files, 'refuse', deps.platform ?? process.platform));
        notes.push(
          `Then: cd ${basename(dir)} && ${m.template?.commands.install ?? 'pnpm install'} && ${m.template?.commands.build ?? 'pnpm build'}`,
        );
        if (m.template?.allowedDependencyBuilds.length)
          notes.push(`Dependencies allowed to run build scripts: ${m.template.allowedDependencyBuilds.join(', ')}`);
        for (const e of m.template?.env ?? [])
          notes.push(`Env ${e.name}${e.required ? ' (required)' : ''}: ${e.description}`);
        continue;
      }
      const checks = checkRequirements(project as ProjectInfo, m.requirements);
      const bad = checks.filter((c) => !c.ok);
      if (bad.length) {
        throw verificationError(
          'incompatible_project',
          'This project does not meet the section requirements; nothing was written.',
          bad.map(
            (b) =>
              `${b.name}: installed ${b.installed ?? 'none'}, needs ${b.required} (upgrade with your package manager)`,
          ),
        );
      }
      const mode: ConflictMode = args.upgrade ? 'upgrade' : args.onConflict;
      plans.push(await planItem(projectRoot, m, v.files, mode, deps.platform ?? process.platform));
      for (const d of m.dependencies) {
        if (!(d.name in (project as ProjectInfo).dependencies)) missingDeps.push(`${d.name}@${d.range}`);
      }
      // ADR-181: a section with React islands also needs the integration registered in the buyer's astro.config.
      for (const step of integrationSteps(m.dependencies)) if (!notes.includes(step)) notes.push(step);
      const entry = m.entrypoints.find((e) => e.kind === 'component');
      if (entry?.importPath) {
        notes.push(
          `Import: import ${entry.localName ?? 'Section'} from '${entry.importPath.replace(/^src\//, '../')}';  (path relative to src/pages)`,
        );
      }
      if (entry?.usage) notes.push(`Usage: ${entry.usage}`);
      notes.push(
        `Tailwind v4: if your CSS uses source(none) or explicit @source lists, add @source "../components/${m.install?.namespace ?? 'aymu'}";`,
      );
    }
    const dependencyCommand = installCommandFor(project?.packageManager ?? 'pnpm', [...new Set(missingDeps)]);

    // F5: the plan.
    const lines: string[] = ['Planned changes (nothing is written before you confirm):'];
    for (const p of plans) {
      lines.push(`  ${p.targetRoot}`);
      for (const f of p.files) lines.push(`    ${f.action.padEnd(7)} ${f.path}`);
    }
    if (dependencyCommand) lines.push(`Dependencies to add yourself (never run by the CLI): ${dependencyCommand}`);
    for (const n of notes) lines.push(n);
    // F5: the plan is always printed, on stderr, so `--json` keeps stdout to one machine-readable result line.
    for (const l of lines) io.err(l);
    if (io.stdinIsTTY && !args.yes && !args.grantStdin) {
      if (!(await io.confirm('Apply these changes?'))) {
        throw new CliError(EXIT.refused, 'declined', 'Nothing was written.');
      }
    }

    // ---- G: commit atomically, with rollback (also on SIGINT) -------------------------------------------------------
    let interrupted = false;
    let tx: Awaited<ReturnType<typeof commit>> | null = null;
    const stop = io.onInterrupt(() => {
      interrupted = true;
    });
    try {
      tx = await commit(plans, {
        beforeStep: async (step) => {
          if (interrupted)
            throw new CliError(EXIT.other, 'interrupted', 'Interrupted; the project was left unchanged.');
          await deps.commitHooks?.beforeStep?.(step);
        },
      });
      if (interrupted) {
        await tx.rollback();
        throw new CliError(EXIT.other, 'interrupted', 'Interrupted; the project was left unchanged.');
      }
      await tx.finish();
    } finally {
      stop();
    }

    // ---- H: report ---------------------------------------------------------------------------------------------------
    const items = plans.map((p, i) => ({
      productId: redemption.items[i]?.productId ?? '',
      version: redemption.items[i]?.version ?? '',
      root: p.targetRoot,
      files: p.files.filter((f) => f.action !== 'skip').length,
      skipped: p.files.filter((f) => f.action === 'skip').length,
    }));
    const reported = await report(server, redemption.installId, redemption.fetchKey, {
      outcome: 'confirmed',
      failureCode: null,
      items: items.map((it, position) => ({
        position,
        result: it.files > 0 ? 'installed' : 'skipped',
        filesWritten: it.files,
      })),
    });
    if (!reported) io.err('Warning: the install report could not be sent; the files are installed.');
    const result: AddResult = { installId: redemption.installId, items, dependencyCommand };
    if (args.json) {
      io.out(JSON.stringify({ status: 'installed', ...result, notes }));
    } else {
      io.out(`Installed ${items.length} item(s).`);
      for (const it of items) io.out(`  ${it.root} (${it.files} files written, ${it.skipped} unchanged)`);
      if (dependencyCommand) io.out(`Run: ${dependencyCommand}`);
    }
    return result;
  } catch (error) {
    if (error instanceof CliError) await reportFailure(error.code);
    throw error;
  }
}

function emptyProject(root: string): ProjectInfo {
  return {
    root,
    astro: null,
    tailwindcss: null,
    node: process.versions.node,
    packageManager: 'pnpm',
    dependencies: {},
  };
}
