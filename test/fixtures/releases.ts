// Signed fixture releases for the CLI suite, built from the git-listed files (tracked, or untracked and not ignored) of
// samples/templates/appy the way
// scripts/gen-test-vectors.mjs builds the RELEASE_FORMAT 18 vectors (JCS manifest, Ed25519 signature, deterministic
// fflate ZIP), with knobs to tamper with every layer (TEST_PLAN 13 C5–C9).
//
// TEST ONLY: the key is derived from a public label, so it proves nothing. It is never registered and never embedded
// in src/keyring.json; tests inject it through `Io.keyring`.
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Zippable, zipSync } from 'fflate';

export const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const SAMPLE = 'samples/templates/appy';
const LABEL = 'Aymu packages/cli test fixtures - TEST ONLY, never register this key';
const OTHER_LABEL = 'Aymu packages/cli test fixtures - an UNKNOWN key';
export const TEST_KEY_ID = 'sgk_01m81kk5xp7e57000000000003';
export const OTHER_KEY_ID = 'sgk_01m81kk5xp7e57000000000004';
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer) => Buffer.from(b).toString('hex');
export const sha256Hex = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
const byteCompare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function jcs(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`)
    .join(',')}}`;
}

async function keyFrom(label: string) {
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(label)));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    new Uint8Array([...PKCS8, ...seed]),
    { name: 'Ed25519' },
    true,
    ['sign'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  return { privateKey, publicKey: Buffer.from(jwk.x ?? '', 'base64url').toString('base64') };
}

export async function testKeyring() {
  const k = await keyFrom(LABEL);
  return [{ keyId: TEST_KEY_ID as `sgk_${string}`, publicKey: k.publicKey, status: 'active' as const }];
}

function sampleFiles(): string[] {
  // Tracked plus untracked-but-not-ignored files, so node_modules/ and dist/ stay out and an uncommitted sample works.
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', SAMPLE], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter(Boolean)
    .map((p) => p.slice(SAMPLE.length + 1))
    .filter((p) => !/(^|\/)(template|section)\.json$/.test(p) && !/^\.aymu\//.test(p))
    .sort(byteCompare);
}
const readSample = (rel: string) => new Uint8Array(readFileSync(join(REPO, SAMPLE, rel)));

const MEDIA: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
const ext = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? '').toLowerCase();
function roleOf(p: string): string {
  if (['LICENSES.md', 'LICENSE', 'LICENSE.md', 'NOTICE'].includes(p)) return 'license';
  if (p === 'README.md') return 'doc';
  if (p.startsWith('src/pages/')) return 'page';
  if (p.startsWith('src/layouts/')) return 'layout';
  if (/^(astro\.config\.(mjs|ts)|src\/content\.config\.ts|src\/env\.d\.ts)$/.test(p)) return 'config';
  if (!p.includes('/') && (p.startsWith('.') || /\.(json|ya?ml)$/.test(p))) return 'config';
  const e = ext(p);
  if (e === '.astro') return 'component';
  if (e === '.css') return 'style';
  if (['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].includes(e)) return 'script';
  if (e === '.woff2' || e === '.woff') return 'font';
  if (MEDIA[e]) return 'image';
  if (['.md', '.mdx', '.txt', '.xml', '.webmanifest'].includes(e)) return 'asset';
  throw new Error(`no role for ${p}`);
}

export interface Tamper {
  /** Extra ZIP entries not in the manifest, with optional Unix attributes. */
  extraEntries?: Record<string, { bytes: Uint8Array; attrs?: number }>;
  /** A manifest-listed file left out of the ZIP. */
  dropEntry?: string;
  /** Replace a file's bytes in the ZIP only (hash mismatch). */
  zipBytes?: Record<string, Uint8Array>;
  /** Unix mode bits (<< 16 applied here) for a listed entry, e.g. 0o120777 for a symlink. */
  entryMode?: Record<string, number>;
  /** Files added to both the manifest and the ZIP (lifecycle scripts, bombs). */
  addFiles?: Record<string, Uint8Array>;
  signer?: 'test' | 'unknown';
  /** Flip one byte of the signature. */
  breakSignature?: boolean;
  /** Override requirements (incompatible project tests). */
  requirements?: { astro: string | null; tailwindcss: string | null; node: string | null };
  /** Override the manifest's release identity fields. */
  release?: Record<string, unknown>;
}

export interface BuiltRelease {
  readonly releaseId: string;
  readonly productId: string;
  readonly productKind: 'section' | 'template';
  readonly variantKind: 'astro_section' | 'astro_project';
  readonly slug: string;
  readonly version: string;
  readonly manifestBytes: Uint8Array;
  readonly objectBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly objectSha256: string;
  readonly installRoot: string;
  readonly files: Record<string, Uint8Array>;
}

const SECTION_ROOT = 'src/components/aymu/appy-hero-phones';

export async function buildSection(t: Tamper = {}): Promise<BuiltRelease> {
  const prefix = 'src/sections/hero-phones/';
  const contents: Record<string, Uint8Array> = {};
  for (const rel of sampleFiles().filter((p) => p.startsWith(prefix))) {
    contents[`${SECTION_ROOT}/${rel.slice(prefix.length)}`] = readSample(rel);
  }
  for (const [p, b] of Object.entries(t.addFiles ?? {})) contents[p] = b;
  const entry = `${SECTION_ROOT}/HeroPhones.astro`;
  const release = {
    id: 'rel_01m81kk5xpkhkz9zmdms1wjhzj',
    productId: 'sec_01m81kk5xp6dr9y8v02bw8dha2',
    productKind: 'section',
    variantId: 'var_01m81kk5xp3e2vey545e5cb9tb',
    variantKind: 'astro_section',
    slug: 'appy-hero-phones',
    title: 'Hero with phone mockups',
    version: '1.0.0',
    seq: 1,
    createdAt: '2026-11-22T12:30:00.000Z',
    ...t.release,
  };
  return finish(t, contents, {
    release,
    requirements: t.requirements ?? { astro: '>=7.4.13 <8', tailwindcss: '>=4.3.5 <5', node: null },
    dependencies: [],
    install: {
      mode: 'into_project',
      namespace: 'aymu',
      root: SECTION_ROOT,
      manifestPath: `${SECTION_ROOT}/release-manifest.json`,
    },
    entrypoints: [
      {
        kind: 'component',
        path: entry,
        exportName: 'default',
        localName: 'HeroPhones',
        importPath: entry,
        usage: '<HeroPhones headingLevel="h1" />',
      },
    ],
    assetsFor: (files: { path: string; role: string }[]) =>
      files
        .filter((f) => ['image', 'font', 'asset'].includes(f.role))
        .map((f) => ({
          path: f.path,
          role: f.role,
          mediaType: MEDIA[ext(f.path)] ?? 'image/svg+xml',
          referencedBy: [entry],
        })),
    section: {
      hasClientJs: true,
      rootSelector: '[data-section="appy-hero-phones"]',
      theming: { tokens: ['--color-accent'], tokensOptional: true },
      props: [{ name: 'headingLevel', type: "'h1' | 'h2'", required: false, description: 'Heading element.' }],
    },
    template: null,
    license: { ref: 'standard-v1', url: 'https://[DOMAIN]/license#standard-v1', file: null, thirdParty: [] },
    parentTemplate: { productId: 'tpl_01m81kk5xpxf85jb52xqj6a7cs', slug: 'appy', relationship: 'extracted_from' },
  });
}

export async function buildTemplate(t: Tamper = {}): Promise<BuiltRelease> {
  const contents: Record<string, Uint8Array> = {};
  for (const rel of sampleFiles()) contents[rel] = readSample(rel);
  for (const [p, b] of Object.entries(t.addFiles ?? {})) contents[p] = b;
  const pkg = JSON.parse(new TextDecoder().decode(contents['package.json'])) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    packageManager: string;
    engines: { node: string };
  };
  const dependencies = [
    ...Object.entries(pkg.dependencies).map(([name, range]) => ({ name, range, type: 'dependencies' })),
    ...Object.entries(pkg.devDependencies).map(([name, range]) => ({ name, range, type: 'dev_dependencies' })),
  ].sort((a, b) => byteCompare(a.type, b.type) || byteCompare(a.name, b.name));
  return finish(t, contents, {
    release: {
      id: 'rel_01m81kk5xpny10qvf3re3sx9yv',
      productId: 'tpl_01m81kk5xpxf85jb52xqj6a7cs',
      productKind: 'template',
      variantId: 'var_01m81kk5xpv9s36zkjb76d1tqd',
      variantKind: 'astro_project',
      slug: 'appy',
      title: 'Appy',
      version: '1.0.0',
      seq: 1,
      createdAt: '2026-11-22T12:30:00.000Z',
      ...t.release,
    },
    requirements: t.requirements ?? {
      astro: pkg.dependencies.astro,
      tailwindcss: pkg.devDependencies.tailwindcss,
      node: pkg.engines.node,
    },
    dependencies,
    install: { mode: 'new_project', namespace: null, root: '.', manifestPath: 'release-manifest.json' },
    entrypoints: [
      { kind: 'config', path: 'astro.config.mjs' },
      { kind: 'layout', path: 'src/layouts/BaseLayout.astro' },
      { kind: 'style', path: 'src/styles/global.css' },
    ],
    assetsFor: (files: { path: string; role: string }[]) =>
      files
        .filter((f) => f.role === 'image' || f.role === 'font')
        .map((f) => ({
          path: f.path,
          role: f.role,
          mediaType: MEDIA[ext(f.path)] ?? 'image/svg+xml',
          referencedBy: [],
        })),
    section: null,
    template: {
      output: 'static',
      packageManager: pkg.packageManager,
      commands: { install: 'pnpm install', dev: 'pnpm dev', build: 'pnpm build' },
      allowedDependencyBuilds: ['esbuild'],
      env: [],
      pages: [{ route: '/', file: 'src/pages/index.astro', pageType: 'home', title: 'Home' }],
      sections: [],
    },
    license: { ref: 'standard-v1', url: 'https://[DOMAIN]/license#standard-v1', file: 'LICENSES.md', thirdParty: [] },
    parentTemplate: null,
  });
}

interface Meta {
  release: Record<string, unknown>;
  requirements: unknown;
  dependencies: unknown[];
  install: { mode: string; namespace: string | null; root: string; manifestPath: string };
  entrypoints: unknown[];
  assetsFor: (files: { path: string; role: string }[]) => unknown[];
  section: unknown;
  template: unknown;
  license: unknown;
  parentTemplate: unknown;
}

async function finish(t: Tamper, contents: Record<string, Uint8Array>, meta: Meta): Promise<BuiltRelease> {
  const files = [];
  for (const path of Object.keys(contents).sort(byteCompare)) {
    const bytes = contents[path] as Uint8Array;
    files.push({ path, sha256: await sha256Hex(bytes), size: bytes.length, role: roleOf(path), installPath: path });
  }
  const lines = files.map((f) => `${f.sha256} ${f.size} ${f.path}\n`).join('');
  const releaseId = String(meta.release.id);
  const manifest = {
    manifestVersion: 1,
    release: meta.release,
    requirements: meta.requirements,
    dependencies: meta.dependencies,
    files,
    sourceHash: await sha256Hex(utf8(`release-source-hash/v1\n${lines}`)),
    install: meta.install,
    entrypoints: meta.entrypoints,
    assets: meta.assetsFor(files),
    section: meta.section,
    template: meta.template,
    license: meta.license,
    preview: { url: `https://${releaseId.slice(4)}.[PREVIEW_DOMAIN]/` },
    parentTemplate: meta.parentTemplate,
    changelogMd: 'First release.',
    migration: { previousVersion: null, breaking: false, notesMd: null },
    provenance: {
      sourceRef:
        'samples/templates/appy (owner-licensed sample, see LICENSES.md and template.json provenance); CLI test fixture',
      packager: { name: '@aymu/release-packager', version: '0.1.0' },
      archive: { format: 'zip', compressor: 'fflate', compressorVersion: '0.8.3', level: 6 },
    },
  };
  const key = await keyFrom(t.signer === 'unknown' ? OTHER_LABEL : LABEL);
  const signingInput = new Uint8Array([...utf8('release-manifest/v1\n'), ...utf8(jcs(manifest))]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, signingInput));
  if (t.breakSignature) sig[0] = (sig[0] as number) ^ 0xff;
  const keyId = t.signer === 'unknown' ? OTHER_KEY_ID : TEST_KEY_ID;
  const manifestBytes = utf8(
    jcs({ ...manifest, signature: { algorithm: 'Ed25519', keyId, value: Buffer.from(sig).toString('base64') } }),
  );

  const base = { level: 6 as const, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 3 };
  const zippable: Zippable = {};
  const entries: Record<string, Uint8Array> = {
    ...contents,
    [meta.install.manifestPath]: manifestBytes,
    ...t.zipBytes,
  };
  if (t.dropEntry) delete entries[t.dropEntry];
  for (const name of Object.keys(entries).sort(byteCompare)) {
    const mode = t.entryMode?.[name] ?? 0o100644;
    zippable[name] = [entries[name] as Uint8Array, { ...base, attrs: mode << 16 }];
  }
  for (const [name, e] of Object.entries(t.extraEntries ?? {})) {
    zippable[name] = [e.bytes, { ...base, attrs: (e.attrs ?? 0o100644) << 16 }];
  }
  const objectBytes = zipSync(zippable);
  return {
    releaseId,
    productId: String(meta.release.productId),
    productKind: meta.release.productKind as 'section' | 'template',
    variantKind: meta.release.variantKind as 'astro_section' | 'astro_project',
    slug: String(meta.release.slug),
    version: String(meta.release.version),
    manifestBytes,
    objectBytes,
    manifestSha256: await sha256Hex(manifestBytes),
    objectSha256: await sha256Hex(objectBytes),
    installRoot: meta.install.root,
    files: contents,
  };
}
