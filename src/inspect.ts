// `aymu list` and `aymu doctor` (RELEASE_FORMAT 15.4, 16). Both are read-only.
// - list: every `release-manifest.json` under `src/components/*/*/` and at the project root, with the product,
//   version, release id, and whether each file still matches its hash (`modified`).
// - doctor: Node, Astro and Tailwind versions, the package manager, symlinked project segments, the keyring, server
//   reachability, and whether a session exists (never printed). With `--zip <file>` it runs C1–E2 on a downloaded
//   release ZIP against the embedded keyring and writes nothing.
import { RELEASE_LIMITS, sha256Hex } from '@aymu/domain/manifest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveOrigin } from './config';
import { CliError, EXIT } from './errors';
import type { Io } from './io';
import { assertNoSymlinks, findAstroProject, inspectProject } from './project';
import { readCentralDirectory, inflateEntry } from './zip';
import { verifyRelease } from './verify';

interface Installed {
  manifestPath: string;
  productId: string;
  version: string;
  releaseId: string;
  modified: string[];
}

async function readInstalled(root: string, manifestRel: string, base: string): Promise<Installed | null> {
  try {
    const m = JSON.parse(await readFile(join(root, manifestRel), 'utf8')) as {
      release?: { productId?: string; version?: string; id?: string };
      files?: { path: string; sha256: string }[];
    };
    if (!m.release?.productId || !Array.isArray(m.files)) return null;
    const modified: string[] = [];
    for (const f of m.files) {
      try {
        const bytes = new Uint8Array(await readFile(join(base, f.path)));
        if ((await sha256Hex(bytes)) !== f.sha256) modified.push(f.path);
      } catch {
        modified.push(`${f.path} (missing)`);
      }
    }
    return {
      manifestPath: manifestRel,
      productId: m.release.productId,
      version: m.release.version ?? '',
      releaseId: m.release.id ?? '',
      modified,
    };
  } catch {
    return null;
  }
}

export async function runList(io: Io, json: boolean): Promise<number> {
  const root = (await findAstroProject(io.cwd)) ?? io.cwd;
  const found: Installed[] = [];
  const atRoot = await readInstalled(root, 'release-manifest.json', root);
  if (atRoot) found.push(atRoot);
  const components = join(root, 'src', 'components');
  for (const ns of await readdir(components).catch(() => [] as string[])) {
    for (const slug of await readdir(join(components, ns)).catch(() => [] as string[])) {
      const rel = join('src', 'components', ns, slug, 'release-manifest.json');
      const item = await readInstalled(root, rel, root);
      if (item) found.push(item);
    }
  }
  if (json) {
    io.out(JSON.stringify({ projectRoot: root, items: found }));
  } else if (found.length === 0) {
    io.out('No installed items found.');
  } else {
    for (const f of found) {
      io.out(
        `${f.productId}@${f.version} (${f.releaseId}) ${f.modified.length ? `modified: ${f.modified.join(', ')}` : 'unchanged'}`,
      );
    }
  }
  return EXIT.ok;
}

export async function runDoctor(
  io: Io,
  options: { zip: string | undefined; json: boolean; server: string | undefined },
): Promise<number> {
  if (options.zip !== undefined) return doctorZip(io, options.zip, options.json);
  const report: Record<string, unknown> = { node: process.versions.node, keyringKeys: io.keyring.length };
  const root = await findAstroProject(io.cwd);
  const problems: string[] = [];
  if (!root) {
    problems.push('No Astro project found from this directory (a package.json listing astro).');
  } else {
    const project = await inspectProject(root, process.versions.node);
    Object.assign(report, {
      projectRoot: root,
      astro: project.astro,
      tailwindcss: project.tailwindcss,
      packageManager: project.packageManager,
    });
    if (!project.astro) problems.push('Astro is not installed (run your package manager install).');
    if (!project.tailwindcss)
      problems.push('Tailwind CSS v4 is not installed; Aymu sections are styled with Tailwind v4.');
    else if (!project.tailwindcss.startsWith('4.')) problems.push(`Tailwind ${project.tailwindcss} is not v4.`);
    try {
      await assertNoSymlinks(join(root, '..'), root);
      report.symlinkedRoot = false;
    } catch {
      report.symlinkedRoot = true;
      problems.push('The project root is reached through a symlink; installs will refuse.');
    }
  }
  if (io.keyring.length === 0)
    problems.push('The embedded keyring is empty: this build cannot verify any release yet.');
  try {
    const origin = resolveOrigin(options.server, io.env);
    const res = await io.fetch(`${origin}/health`, { redirect: 'error' });
    report.server = { origin, reachable: res.ok };
    if (!res.ok) problems.push(`${origin} answered ${res.status}.`);
  } catch (error) {
    report.server = { reachable: false };
    problems.push(error instanceof CliError ? error.message : 'The server is not reachable.');
  }
  report.storedSession = false; // tokens are never persisted by this build (SECURITY_MODEL 11 C4)
  report.problems = problems;
  if (options.json) io.out(JSON.stringify(report));
  else {
    for (const [k, v] of Object.entries(report)) if (k !== 'problems') io.out(`${k}: ${JSON.stringify(v)}`);
    for (const p of problems) io.out(`problem: ${p}`);
  }
  return problems.length ? EXIT.refused : EXIT.ok;
}

/**
 * The largest ZIP release object of any kind (RELEASE_FORMAT 9; `.fig` files are not ZIPs). `doctor --zip` refuses a
 * bigger file from its size alone, before reading anything into memory (Prompt 10).
 */
export const MAX_DOCTOR_ZIP_BYTES = Math.max(
  RELEASE_LIMITS.astro_section.maxObjectBytes,
  RELEASE_LIMITS.astro_project.maxObjectBytes,
  RELEASE_LIMITS.asset_pack.maxObjectBytes,
);

/** RELEASE_FORMAT 16: offline verification of a downloaded ZIP (C1–E2), no writes. */
async function doctorZip(io: Io, path: string, json: boolean): Promise<number> {
  const info = await stat(path);
  if (!info.isFile()) throw new CliError(EXIT.verification, 'archive_invalid', `${path} is not a regular file.`);
  if (info.size > MAX_DOCTOR_ZIP_BYTES) {
    throw new CliError(
      EXIT.verification,
      'object_too_large',
      `The file is larger than any release ZIP (${MAX_DOCTOR_ZIP_BYTES} bytes); it was not read.`,
    );
  }
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.byteLength > MAX_DOCTOR_ZIP_BYTES) {
    throw new CliError(EXIT.verification, 'object_too_large', 'The file grew past the release ZIP size while reading.');
  }
  let manifestBytes: Uint8Array | null = null;
  try {
    for (const entry of readCentralDirectory(bytes)) {
      if (entry.name === 'release-manifest.json' || entry.name.endsWith('/release-manifest.json')) {
        manifestBytes = inflateEntry(bytes, entry);
        break;
      }
    }
  } catch (error) {
    throw new CliError(
      EXIT.verification,
      'archive_invalid',
      error instanceof Error ? error.message : 'invalid archive',
    );
  }
  if (!manifestBytes) throw new CliError(EXIT.verification, 'missing_entry', 'The ZIP has no release-manifest.json.');
  let release: {
    id: string;
    productId: string;
    productKind: string;
    variantKind: string;
    slug: string;
    version: string;
  };
  try {
    release = (JSON.parse(new TextDecoder().decode(manifestBytes)) as { release: typeof release }).release;
  } catch {
    throw new CliError(EXIT.verification, 'non_canonical_manifest', 'The embedded manifest is not JSON.');
  }
  const objectSha256 = await sha256Hex(bytes);
  const verified = await verifyRelease({
    manifestBytes,
    objectBytes: bytes,
    keyring: io.keyring,
    expected: {
      releaseId: release.id,
      productId: release.productId,
      productKind: release.productKind,
      variantKind: release.variantKind,
      slug: release.slug,
      version: release.version,
      objectSha256,
      objectSizeBytes: bytes.length,
    },
  });
  const out = {
    status: 'verified',
    releaseId: verified.manifest.release.id,
    version: verified.manifest.release.version,
    objectSha256,
    manifestSha256: await sha256Hex(manifestBytes),
    sourceHash: verified.manifest.sourceHash,
    signingKeyId: verified.manifest.signature.keyId,
    files: verified.manifest.files.length,
  };
  io.out(
    json
      ? JSON.stringify(out)
      : Object.entries(out)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n'),
  );
  return EXIT.ok;
}
