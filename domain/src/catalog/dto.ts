// Product, section and template DTOs on the wire (MCP_PROTOCOL 5.2 is normative for their JSON shape;
// the website API reuses them). Metadata only: never manifests with file hashes, R2 keys or source.
import { z } from 'zod';
import {
  CategoryTaxonomy,
  DependencyType,
  PageType,
  ProductKind,
  TemplateSectionRelationship,
  VariantKind,
} from '../enums';
import { HttpsUrl, NpmPackageName, SemVer, Slug, uniqueArray } from '../formats';
import { CategoryId, ProductId, ReleaseId, SectionId, TemplateId, VariantId } from '../ids';
import { Instant } from '../time';
import { AccessView } from '../access';

/** One cap for catalog text excerpts everywhere (MCP_PROTOCOL 5.5, SECURITY_MODEL 12.2). */
export const DESCRIPTION_EXCERPT_MAX = 2000;

export const CategoryRef = z.strictObject({
  id: CategoryId,
  slug: Slug,
  name: z.string(),
  taxonomy: CategoryTaxonomy,
});
export type CategoryRef = z.infer<typeof CategoryRef>;

/** `keyword` tags are search-only and never shown (GLOSSARY 4.2). */
export const TagRef = z.strictObject({
  kind: z.enum(['style', 'use_case', 'feature']),
  slug: Slug,
  label: z.string(),
});
export type TagRef = z.infer<typeof TagRef>;

export const ParentTemplateRef = z.strictObject({ id: TemplateId, slug: Slug, title: z.string() });
export type ParentTemplateRef = z.infer<typeof ParentTemplateRef>;

export const ProductCard = z.strictObject({
  id: ProductId,
  kind: ProductKind,
  slug: Slug,
  title: z.string().max(120),
  summary: z.string().max(280),
  category: CategoryRef.nullable(),
  tags: z.array(TagRef).max(20),
  /** Kinds of published variants; unique. */
  formats: uniqueArray(z.array(VariantKind), 'formats must be unique'),
  url: HttpsUrl,
  thumbnailUrl: HttpsUrl.nullable(),
  previewUrl: HttpsUrl.nullable(),
  currentVersion: z.string().nullable(),
  publishedAt: Instant,
  lastReleasedAt: Instant.nullable(),
  parentTemplate: ParentTemplateRef.nullable(),
});
export type ProductCard = z.infer<typeof ProductCard>;

/** MCP_PROTOCOL 6.1: one flat object (`ProductCard.extend`, never an intersection). */
export const TemplateCard = ProductCard.extend({ pageCount: z.int().min(0), sectionCount: z.int().min(0) });
export type TemplateCard = z.infer<typeof TemplateCard>;

export const SectionCard = ProductCard.extend({ hasClientJs: z.boolean() });
export type SectionCard = z.infer<typeof SectionCard>;

export const Requirements = z.strictObject({
  astro: z.string().nullable(),
  tailwindcss: z.string().nullable(),
  node: z.string().nullable(),
});
export type Requirements = z.infer<typeof Requirements>;

export const Dependency = z.strictObject({
  name: NpmPackageName,
  range: z.string(),
  type: DependencyType,
});
export type Dependency = z.infer<typeof Dependency>;

export const ReleaseSummary = z.strictObject({
  releaseId: ReleaseId,
  version: SemVer,
  publishedAt: Instant,
  requirements: Requirements,
  fileCount: z.int().min(0),
  changelogExcerpt: z.string().max(DESCRIPTION_EXCERPT_MAX),
});
export type ReleaseSummary = z.infer<typeof ReleaseSummary>;

export const VariantView = z.strictObject({
  variantId: VariantId,
  kind: VariantKind,
  status: z.enum(['published', 'unpublished']),
  licenseRef: z.string(),
  release: ReleaseSummary.nullable(),
  dependencies: z.array(Dependency),
  access: z.array(AccessView),
});
export type VariantView = z.infer<typeof VariantView>;

export const TemplatePageView = z.strictObject({ path: z.string(), title: z.string(), pageType: PageType });
export type TemplatePageView = z.infer<typeof TemplatePageView>;

export const TemplateSectionView = z.strictObject({
  id: SectionId,
  slug: Slug,
  title: z.string(),
  relationship: TemplateSectionRelationship,
  includedWithTemplate: z.boolean(),
});
export type TemplateSectionView = z.infer<typeof TemplateSectionView>;

export const ReleaseHistoryEntry = z.object({ releaseId: ReleaseId, version: SemVer, publishedAt: Instant });
export type ReleaseHistoryEntry = z.infer<typeof ReleaseHistoryEntry>;

export const LicenseRef = z.object({ ref: z.string(), url: HttpsUrl });
export type LicenseRef = z.infer<typeof LicenseRef>;

export const LibraryState = z.object({ favorite: z.boolean(), hasAnyAccess: z.boolean() });
export type LibraryState = z.infer<typeof LibraryState>;

/** MCP `get_template` output and the website template detail payload (MCP_PROTOCOL 6.3). */
export const TemplateDetail = z.strictObject({
  template: ProductCard,
  descriptionText: z.string().max(DESCRIPTION_EXCERPT_MAX),
  pages: z.array(TemplatePageView),
  variants: z.array(VariantView),
  sections: z.array(TemplateSectionView),
  releaseHistory: z.array(ReleaseHistoryEntry).max(10),
  license: LicenseRef,
  library: LibraryState,
});
export type TemplateDetail = z.infer<typeof TemplateDetail>;

/** Where a section lands in a customer project; from `releases.install_root` / `entry_import_path` (MCP_PROTOCOL 6.4). */
export const InstallPreview = z.strictObject({ root: z.string(), importPath: z.string() });

/** MCP `get_section` output (MCP_PROTOCOL 6.4). */
export const SectionDetail = z.strictObject({
  section: ProductCard,
  descriptionText: z.string().max(DESCRIPTION_EXCERPT_MAX),
  hasClientJs: z.boolean(),
  usedIn: z.array(ParentTemplateRef),
  installPreview: InstallPreview.nullable(),
  variants: z.array(VariantView),
  releaseHistory: z.array(ReleaseHistoryEntry).max(10),
  license: LicenseRef,
  library: LibraryState,
});
export type SectionDetail = z.infer<typeof SectionDetail>;
