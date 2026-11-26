// RELEASE_FORMAT 3: `ReleaseManifestV1`, the signed manifest of one release. Wire names are camelCase and enum
// values are GLOSSARY snake_case. Structural rules live in the schema; cross-field rules (sections 3–5, 9, 11, 12,
// 17) live in the superRefine below and tag each issue with the CLI verification code it maps to.
import { z } from 'zod';
import {
  DependencyType,
  EntrypointKind,
  FileRole,
  InstallMode,
  PageType,
  ProductKind,
  ReleaseBackedVariantKind,
  VARIANT_KIND_PRODUCT_KINDS,
  type CliVerificationCode,
  type FileRole as FileRoleT,
  type ReleaseBackedVariantKind as ReleaseBackedVariantKindT,
} from '../enums';
import { Base64, HttpsUrl, Namespace, NpmPackageName, SemVer, SemVerRange, Sha256Hex, Slug } from '../formats';
import { ProductId, ReleaseId, SectionId, SigningKeyId, TemplateId, VariantId, releaseHostLabel } from '../ids';
import { Instant } from '../time';
import {
  MAX_ENTRY_USAGE_CHARS,
  MAX_MARKDOWN_CHARS,
  MAX_SOURCE_REF_CHARS,
  MAX_TITLE_CHARS,
  RELEASE_LIMITS,
} from './limits';
import { compareBytewise, isPathUnder, pathRulesForKind, validatePathSet, validateReleasePath } from './paths';

const ManifestPath = z.string().min(1).max(240);
const MediaType = z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'expected a media type');

export const ManifestFile = z.strictObject({
  path: ManifestPath,
  sha256: Sha256Hex,
  size: z.int().min(0),
  role: FileRole,
  /** Equals `path` for installable kinds in v1; null otherwise. */
  installPath: ManifestPath.nullable(),
});
export type ManifestFile = z.infer<typeof ManifestFile>;

export const ManifestDependency = z.strictObject({ name: NpmPackageName, range: SemVerRange, type: DependencyType });
export type ManifestDependency = z.infer<typeof ManifestDependency>;

export const ManifestInstall = z.strictObject({
  mode: InstallMode,
  /** The brand namespace for sections; null for templates. */
  namespace: Namespace.nullable(),
  root: z.string().min(1).max(240),
  manifestPath: ManifestPath,
});

export const ManifestEntrypoint = z.strictObject({
  kind: EntrypointKind,
  path: ManifestPath,
  exportName: z.string().min(1).max(100).optional(),
  localName: z
    .string()
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
    .optional(),
  importPath: ManifestPath.optional(),
  usage: z.string().max(MAX_ENTRY_USAGE_CHARS).optional(),
});
export type ManifestEntrypoint = z.infer<typeof ManifestEntrypoint>;

export const ManifestAsset = z.strictObject({
  path: ManifestPath,
  role: z.enum(['image', 'font', 'asset']),
  mediaType: MediaType,
  referencedBy: z.array(ManifestPath),
});

export const ManifestSection = z.strictObject({
  hasClientJs: z.boolean(),
  rootSelector: z.string().min(1).max(200),
  theming: z.strictObject({
    tokens: z.array(z.string().regex(/^--[A-Za-z0-9-]+$/, 'expected a CSS custom property name')),
    tokensOptional: z.boolean(),
  }),
  props: z.array(
    z.strictObject({
      name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
      type: z.string().min(1).max(500),
      required: z.boolean(),
      description: z.string().max(500),
    }),
  ),
});

export const ManifestTemplate = z.strictObject({
  output: z.enum(['static', 'server']),
  packageManager: z.string().regex(/^(pnpm|npm|yarn|bun)@\d+\.\d+\.\d+$/, 'expected <manager>@<exact version>'),
  commands: z.strictObject({ install: z.string().max(200), dev: z.string().max(200), build: z.string().max(200) }),
  allowedDependencyBuilds: z.array(NpmPackageName),
  env: z.array(
    z.strictObject({
      name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      required: z.boolean(),
      description: z.string().max(500),
    }),
  ),
  pages: z.array(
    z.strictObject({
      route: z.string().min(1).max(240),
      file: ManifestPath,
      pageType: PageType,
      title: z.string().max(MAX_TITLE_CHARS),
    }),
  ),
  sections: z.array(z.strictObject({ productId: SectionId, path: ManifestPath })),
});

export const ManifestSignature = z.strictObject({
  algorithm: z.literal('Ed25519'),
  keyId: SigningKeyId,
  /** base64 of the 64-byte signature: 88 characters. */
  value: Base64.length(88),
});

const ReleaseManifestShape = z.strictObject({
  manifestVersion: z.literal(1),
  release: z.strictObject({
    id: ReleaseId,
    productId: ProductId,
    productKind: ProductKind,
    variantId: VariantId,
    variantKind: ReleaseBackedVariantKind,
    slug: Slug,
    title: z.string().min(1).max(MAX_TITLE_CHARS),
    version: SemVer,
    seq: z.int().min(1),
    createdAt: Instant,
  }),
  requirements: z.strictObject({
    astro: SemVerRange.nullable(),
    tailwindcss: SemVerRange.nullable(),
    node: SemVerRange.nullable(),
  }),
  dependencies: z.array(ManifestDependency),
  files: z.array(ManifestFile).min(1),
  sourceHash: Sha256Hex,
  install: ManifestInstall.nullable(),
  entrypoints: z.array(ManifestEntrypoint),
  assets: z.array(ManifestAsset),
  section: ManifestSection.nullable(),
  template: ManifestTemplate.nullable(),
  /** Retired (ADR-173): manifests signed before 2026-11-26 carry `null` here; new builds omit the key. */
  figma: z.null().optional(),
  license: z.strictObject({
    ref: z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, 'expected a license reference such as standard-v1'),
    url: HttpsUrl,
    file: ManifestPath.nullable(),
    thirdParty: z.array(
      z.strictObject({
        name: z.string().min(1).max(214),
        license: z.string().min(1).max(100),
        source: z.string().max(200),
      }),
    ),
  }),
  preview: z.strictObject({ url: HttpsUrl.nullable() }),
  parentTemplate: z
    .strictObject({ productId: TemplateId, slug: Slug, relationship: z.literal('extracted_from') })
    .nullable(),
  changelogMd: z.string().max(MAX_MARKDOWN_CHARS),
  migration: z.strictObject({
    previousVersion: SemVer.nullable(),
    breaking: z.boolean(),
    notesMd: z.string().max(MAX_MARKDOWN_CHARS).nullable(),
  }),
  provenance: z.strictObject({
    sourceRef: z.string().min(1).max(MAX_SOURCE_REF_CHARS),
    packager: z.strictObject({ name: NpmPackageName, version: SemVer }),
    archive: z.strictObject({
      format: z.literal('zip'),
      compressor: z.string().min(1),
      compressorVersion: SemVer,
      level: z.int().min(0).max(9),
    }),
  }),
  signature: ManifestSignature,
});
type Shape = z.infer<typeof ReleaseManifestShape>;

/** RELEASE_FORMAT 5: roles each variant kind may contain. */
export const ALLOWED_ROLES: Readonly<Record<ReleaseBackedVariantKindT, readonly FileRoleT[]>> = {
  astro_section: ['component', 'script', 'style', 'image', 'font', 'asset', 'doc'],
  astro_project: [
    'page',
    'layout',
    'component',
    'style',
    'script',
    'asset',
    'font',
    'image',
    'config',
    'doc',
    'license',
  ],
  asset_pack: ['image', 'font', 'asset', 'doc', 'license'],
};

/** The file name of the embedded manifest (GLOSSARY 5.2). */
export const EMBEDDED_MANIFEST_NAME = 'release-manifest.json';

/** RELEASE_FORMAT 2.5 / ADR-28: `https://{rid}.[PREVIEW_DOMAIN]/`. */
export function expectedPreviewUrl(releaseId: ReleaseId, previewDomain: string): string {
  return `https://${releaseHostLabel(releaseId)}.${previewDomain}/`;
}

/** RELEASE_FORMAT 3.2: `https://[DOMAIN]/license#{ref}`. */
export function expectedLicenseUrl(publicDomain: string, ref: string): string {
  return `https://${publicDomain}/license#${ref}`;
}

/** RELEASE_FORMAT 11.1: `src/components/{namespace}/{section-slug}`. */
export function sectionInstallRoot(namespace: string, slug: string): string {
  return `src/components/${namespace}/${slug}`;
}

function sortedBy<T>(items: readonly T[], cmp: (a: T, b: T) => number): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev !== undefined && cur !== undefined && cmp(prev, cur) >= 0) return false;
  }
  return true;
}

function major(version: string): number {
  return Number(version.split('.')[0]);
}

type Issue = { code: CliVerificationCode; message: string; path: (string | number)[] };

/** Cross-field rules. Exported for reuse by the packager and upload API reports. */
export function manifestRuleIssues(m: Shape): Issue[] {
  const issues: Issue[] = [];
  const add = (code: CliVerificationCode, message: string, ...path: (string | number)[]) =>
    issues.push({ code, message, path });
  const kind = m.release.variantKind;
  const isSection = kind === 'astro_section';
  const isTemplate = kind === 'astro_project';
  const installable = isSection || isTemplate;

  // Identity (3.2).
  const expectedKind = m.release.productId.startsWith('tpl_') ? 'template' : 'section';
  if (m.release.productKind !== expectedKind)
    add('manifest_mismatch', 'productKind must match the productId prefix', 'release', 'productKind');
  if (!VARIANT_KIND_PRODUCT_KINDS[kind].includes(m.release.productKind)) {
    add('manifest_mismatch', `${kind} is not allowed on a ${m.release.productKind}`, 'release', 'variantKind');
  }

  // Requirements (3.2).
  if (installable && m.requirements.astro === null)
    add('non_canonical_manifest', 'requirements.astro is required for astro_* kinds', 'requirements', 'astro');
  if (isSection && m.requirements.node !== null)
    add('non_canonical_manifest', 'sections carry no node requirement', 'requirements', 'node');

  // Files: order, paths, roles, installPath, limits (3.1, 4, 5, 9).
  const rules = pathRulesForKind(kind);
  if (!sortedBy(m.files, (a, b) => compareBytewise(a.path, b.path)))
    add('non_canonical_manifest', 'files must be sorted by path, byte-wise, without duplicates', 'files');
  const limits = RELEASE_LIMITS[kind];
  if (m.files.length > limits.maxFiles) add('limit_exceeded', `more than ${limits.maxFiles} files`, 'files');
  let total = 0;
  const allowedRoles = ALLOWED_ROLES[kind];
  m.files.forEach((f, i) => {
    const pathIssue = validateReleasePath(f.path, rules);
    if (pathIssue) add('unsafe_path', `${pathIssue.code}: ${pathIssue.message}`, 'files', i, 'path');
    if (!allowedRoles.includes(f.role))
      add('unsafe_path', `role ${f.role} is not allowed in ${kind}`, 'files', i, 'role');
    if (installable ? f.installPath !== f.path : f.installPath !== null) {
      add(
        'non_canonical_manifest',
        installable ? 'installPath must equal path' : 'installPath must be null',
        'files',
        i,
        'installPath',
      );
    }
    if (f.size > limits.maxFileBytes)
      add('limit_exceeded', `file larger than ${limits.maxFileBytes} bytes`, 'files', i, 'size');
    total += f.size;
  });
  if (total > limits.maxTotalUncompressedBytes) {
    add('limit_exceeded', `total size above ${limits.maxTotalUncompressedBytes} bytes`, 'files');
  }
  const filePaths = m.files.map((f) => f.path);
  const fileSet = new Set(filePaths);
  const roleOf = new Map(m.files.map((f) => [f.path, f.role] as const));
  for (const s of validatePathSet(installable && m.install ? [...filePaths, m.install.manifestPath] : filePaths)) {
    add('unsafe_path', `${s.code}: ${s.path} vs ${s.other}`, 'files');
  }

  // Dependencies (3.1, 12).
  const depKey = (d: { type: string; name: string }) => `${d.type}\u0000${d.name}`;
  if (!sortedBy(m.dependencies, (a, b) => compareBytewise(depKey(a), depKey(b)))) {
    add('non_canonical_manifest', 'dependencies must be sorted by (type, name) without duplicates', 'dependencies');
  }

  // Entrypoints (3.2, 11.2.6).
  const epKey = (e: { path: string; kind: string }) => `${e.path}\u0000${e.kind}`;
  if (!sortedBy(m.entrypoints, (a, b) => compareBytewise(epKey(a), epKey(b))))
    add('non_canonical_manifest', 'entrypoints must be sorted by (path, kind)', 'entrypoints');
  m.entrypoints.forEach((e, i) => {
    if (!fileSet.has(e.path))
      add('non_canonical_manifest', 'entrypoint path must be a listed file', 'entrypoints', i, 'path');
    if (e.importPath !== undefined && e.importPath !== e.path)
      add(
        'non_canonical_manifest',
        'importPath must equal the project-root-relative path',
        'entrypoints',
        i,
        'importPath',
      );
  });

  // Assets (3.2).
  if (!sortedBy(m.assets, (a, b) => compareBytewise(a.path, b.path)))
    add('non_canonical_manifest', 'assets must be sorted by path', 'assets');
  m.assets.forEach((a, i) => {
    if (roleOf.get(a.path) !== a.role)
      add('non_canonical_manifest', 'asset must be a listed file with the same role', 'assets', i);
    a.referencedBy.forEach((r, j) => {
      if (!fileSet.has(r))
        add('non_canonical_manifest', 'referencedBy must list files', 'assets', i, 'referencedBy', j);
    });
  });
  const assetRoles: readonly FileRoleT[] | null = isSection
    ? ['image', 'font', 'asset']
    : isTemplate
      ? ['image', 'font']
      : null;
  if (assetRoles) {
    const expected = m.files.filter((f) => assetRoles.includes(f.role)).map((f) => f.path);
    const actual = m.assets.map((a) => a.path);
    if (expected.length !== actual.length || expected.some((p, i) => p !== actual[i])) {
      add('non_canonical_manifest', `assets must list every file with role ${assetRoles.join('/')}`, 'assets');
    }
  }
  if (isTemplate) {
    m.assets.forEach((a, i) => {
      if (a.referencedBy.length > 0)
        add('non_canonical_manifest', 'template assets carry an empty referencedBy', 'assets', i, 'referencedBy');
    });
  }

  // Per-kind shape (5, 11, 13).
  const licenseFiles = m.files.filter((f) => f.role === 'license').map((f) => f.path);
  if (isSection) {
    const ns = m.install?.namespace ?? null;
    if (!m.install || m.install.mode !== 'into_project' || ns === null) {
      add('non_canonical_manifest', 'sections install into_project with a namespace', 'install');
    } else {
      const root = sectionInstallRoot(ns, m.release.slug);
      if (m.install.root !== root) add('unsafe_path', `install.root must be ${root}`, 'install', 'root');
      if (m.install.manifestPath !== `${root}/${EMBEDDED_MANIFEST_NAME}`)
        add('unsafe_path', 'install.manifestPath must be {root}/release-manifest.json', 'install', 'manifestPath');
      m.files.forEach((f, i) => {
        if (!isPathUnder(f.path, m.install?.root ?? root))
          add('unsafe_path', 'every section file lives under install.root', 'files', i, 'path');
      });
    }
    if (m.entrypoints.filter((e) => e.kind === 'component').length !== 1)
      add('non_canonical_manifest', 'a section has exactly one component entrypoint', 'entrypoints');
    if (m.section === null) add('non_canonical_manifest', 'section is required for astro_section', 'section');
    if (m.license.file !== null) add('non_canonical_manifest', 'sections carry no license file', 'license', 'file');
  } else if (m.section !== null) {
    add('non_canonical_manifest', 'section must be null', 'section');
  }
  if (isTemplate) {
    if (
      !m.install ||
      m.install.mode !== 'new_project' ||
      m.install.namespace !== null ||
      m.install.root !== '.' ||
      m.install.manifestPath !== EMBEDDED_MANIFEST_NAME
    ) {
      add('non_canonical_manifest', 'templates install as new_project at "." with release-manifest.json', 'install');
    }
    if (m.template === null) add('non_canonical_manifest', 'template is required for astro_project', 'template');
    if (!fileSet.has('package.json')) add('non_canonical_manifest', 'package.json is required', 'files');
    if (!fileSet.has('astro.config.mjs') && !fileSet.has('astro.config.ts'))
      add('non_canonical_manifest', 'astro.config.(mjs|ts) is required', 'files');
    const astroDep = m.dependencies.find((d) => d.name === 'astro' && d.type !== 'peer_dependencies');
    if (astroDep && astroDep.range !== m.requirements.astro)
      add(
        'non_canonical_manifest',
        'requirements.astro must equal the astro dependency range',
        'requirements',
        'astro',
      );
    const twDep = m.dependencies.find((d) => d.name === 'tailwindcss' && d.type !== 'peer_dependencies');
    if (twDep && twDep.range !== m.requirements.tailwindcss)
      add(
        'non_canonical_manifest',
        'requirements.tailwindcss must equal the tailwindcss dependency range',
        'requirements',
        'tailwindcss',
      );
  } else if (m.template !== null) {
    add('non_canonical_manifest', 'template must be null', 'template');
  }
  if (m.template) {
    const t = m.template;
    t.pages.forEach((p, i) => {
      if (roleOf.get(p.file) !== 'page')
        add('non_canonical_manifest', 'template page file must be a listed page', 'template', 'pages', i, 'file');
    });
    if (!sortedBy(t.sections, (a, b) => compareBytewise(a.path, b.path)))
      add('non_canonical_manifest', 'template.sections must be sorted by path', 'template', 'sections');
    t.sections.forEach((s, i) => {
      if (!filePaths.some((p) => isPathUnder(p, s.path)))
        add('non_canonical_manifest', 'template section path must contain files', 'template', 'sections', i, 'path');
    });
  }
  if (isTemplate || kind === 'asset_pack') {
    if (licenseFiles.length !== 1 || m.license.file !== licenseFiles[0]) {
      add('non_canonical_manifest', 'exactly one license file, named in license.file', 'license', 'file');
    }
  }
  if (m.license.file !== null && roleOf.get(m.license.file) !== 'license') {
    add('non_canonical_manifest', 'license.file must be a listed file with role license', 'license', 'file');
  }
  if (kind === 'asset_pack' && m.install !== null)
    add('non_canonical_manifest', 'asset_pack is not installable', 'install');
  if (m.parentTemplate !== null && !isSection)
    add('non_canonical_manifest', 'parentTemplate is for sections only', 'parentTemplate');

  // URLs (2.5, 3.2).
  if (installable) {
    const label = releaseHostLabel(m.release.id);
    const url = m.preview.url;
    if (
      url === null ||
      !url.startsWith(`https://${label}.`) ||
      !url.endsWith('/') ||
      url.slice(`https://${label}.`.length, -1).includes('/')
    ) {
      add('non_canonical_manifest', 'preview.url must be https://{rid}.<preview domain>/', 'preview', 'url');
    }
  } else if (m.preview.url !== null) {
    add('non_canonical_manifest', 'preview.url is null for non-astro kinds', 'preview', 'url');
  }
  if (!m.license.url.endsWith(`/license#${m.license.ref}`))
    add('non_canonical_manifest', 'license.url must end with /license#{ref}', 'license', 'url');

  // Migration (17).
  if (m.migration.breaking) {
    if (!m.migration.notesMd)
      add('non_canonical_manifest', 'breaking releases need migration notes', 'migration', 'notesMd');
    if (m.migration.previousVersion !== null && major(m.release.version) <= major(m.migration.previousVersion)) {
      add('non_canonical_manifest', 'breaking releases need a major version bump', 'release', 'version');
    }
  }
  return issues;
}

export const ReleaseManifestV1 = ReleaseManifestShape.superRefine((m, ctx) => {
  for (const i of manifestRuleIssues(m)) {
    ctx.addIssue({ code: 'custom', message: i.message, path: i.path, params: { verificationCode: i.code } });
  }
});
export type ReleaseManifestV1 = z.infer<typeof ReleaseManifestV1>;

/** Most specific first: a path or limit problem is reported as such even when other rules also fail. */
const CODE_PRIORITY: readonly CliVerificationCode[] = [
  'unsafe_path',
  'limit_exceeded',
  'manifest_mismatch',
  'non_canonical_manifest',
];

/** Maps a failed parse to one CLI verification code (default `non_canonical_manifest`). */
export function verificationCodeOf(error: z.ZodError): CliVerificationCode {
  const codes = new Set<CliVerificationCode>();
  for (const issue of error.issues) {
    if (issue.code === 'custom') {
      const code = (issue.params as { verificationCode?: CliVerificationCode } | undefined)?.verificationCode;
      if (code) codes.add(code);
    }
  }
  return CODE_PRIORITY.find((c) => codes.has(c)) ?? 'non_canonical_manifest';
}

/** RELEASE_FORMAT 7.2: the public key-status document `https://[DOMAIN]/release-keys.json`. */
export const ReleaseKeysDocument = z.strictObject({
  keysVersion: z.literal(1),
  generatedAt: Instant,
  keys: z.array(
    z.strictObject({
      keyId: SigningKeyId,
      algorithm: z.literal('Ed25519'),
      publicKey: Base64.length(44),
      status: z.enum(['active', 'retired', 'compromised']),
      compromisedAt: Instant.nullable(),
    }),
  ),
});
export type ReleaseKeysDocument = z.infer<typeof ReleaseKeysDocument>;

/** One embedded CLI keyring entry (`keyring.json`, RELEASE_FORMAT 7.2). */
export const KeyringEntry = z.strictObject({
  keyId: SigningKeyId,
  publicKey: Base64.length(44),
  status: z.enum(['active', 'retired', 'compromised']),
});
export type KeyringEntry = z.infer<typeof KeyringEntry>;
