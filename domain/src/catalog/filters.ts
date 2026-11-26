// PRD 5.1 / ROUTES 8.2: catalog listing parameters with a fixed grammar, URL-roundtrippable.
// parse → normal form → serialize is idempotent: invalid values and unknown parameters are dropped, slugs are
// lowercased, multi-values deduplicated and sorted, defaults removed, keys sorted. `utm_*`, `ref` and `via`
// are carried through unchanged (DataFast attribution) but excluded from the canonical URL.
import { z } from 'zod';
import { PAGE_TYPES, type PageType, type ProductKind, type VariantKind } from '../enums';
import { SLUG_RE } from '../formats';

export const CATALOG_SORTS = ['relevance', 'popular', 'newest', 'updated', 'title'] as const;
export const CatalogSort = z.enum(CATALOG_SORTS);
export type CatalogSort = z.infer<typeof CatalogSort>;

export const FORMAT_ALIASES = ['astro', 'assets'] as const;
export const FormatAlias = z.enum(FORMAT_ALIASES);
export type FormatAlias = z.infer<typeof FormatAlias>;

/** PRD 5.1: each alias maps to an exact set of variant kinds ("any kind within one alias"). */
export const FORMAT_ALIAS_KINDS: Readonly<Record<FormatAlias, readonly VariantKind[]>> = {
  astro: ['astro_project', 'astro_section'],
  assets: ['asset_pack'],
};

/** Same limit as MCP `query` (PRD 5.2). */
export const MAX_QUERY_LENGTH = 200;
export const MAX_QUERY_TOKENS = 10;
/** PRD 5.1 page sizes. */
export const PAGE_SIZE: Readonly<Record<ProductKind, number>> = { template: 24, section: 36 };

const CURSOR_RE = /^[A-Za-z0-9_-]{1,512}$/;
const CARRY_KEY_RE = /^(utm_[a-z0-9_]{1,32}|ref|via)$/;
const MAX_MULTI_VALUES = 10;

export interface CatalogFilters {
  kind: ProductKind;
  /** Free text, trimmed, ≤ 200 characters. */
  q: string | null;
  category: string | null;
  style: string[];
  useCase: string[];
  /** Templates only: the template has a page of **each** listed type. */
  pageType: PageType[];
  /** Product has **each** listed alias. */
  format: FormatAlias[];
  /** Sections only: a template slug. */
  template: string | null;
  /** `free`: free with an account; `paid`: needs a purchase or plan. */
  access: 'free' | 'paid' | null;
  /** The effective sort (never null; the default is resolved). */
  sort: CatalogSort;
  cursor: string | null;
}

export interface ParsedCatalogQuery {
  filters: CatalogFilters;
  /** Attribution params kept in input order and excluded from the canonical query. */
  carry: Array<[string, string]>;
}

/** PRD 5.1: `relevance` is the default with `q`, `popular` otherwise. */
export function defaultSort(q: string | null): CatalogSort {
  return q === null ? 'popular' : 'relevance';
}

function normSlug(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return v.length <= 80 && SLUG_RE.test(v) ? v : null;
}

function collectMulti(values: string[], accept: (v: string) => string | null): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    for (const part of raw.split(',')) {
      const v = accept(part);
      if (v !== null) out.add(v);
    }
  }
  return [...out].sort().slice(0, MAX_MULTI_VALUES);
}

function firstValid(values: string[], accept: (v: string) => string | null): string | null {
  for (const raw of values) {
    const v = accept(raw);
    if (v !== null) return v;
  }
  return null;
}

/** Parses a listing query string for `/templates` (kind `template`) or `/sections` (kind `section`). Never throws. */
export function parseCatalogQuery(kind: ProductKind, search: string | URLSearchParams): ParsedCatalogQuery {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const byKey = new Map<string, string[]>();
  const carry: Array<[string, string]> = [];
  for (const [key, value] of params) {
    if (CARRY_KEY_RE.test(key)) {
      carry.push([key, value]);
      continue;
    }
    const list = byKey.get(key);
    if (list) list.push(value);
    else byKey.set(key, [value]);
  }
  const get = (key: string) => byKey.get(key) ?? [];

  const q = firstValid(get('q'), (raw) => {
    const v = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    return v.length > 0 && v.length <= MAX_QUERY_LENGTH ? v : null;
  });
  const sortParam = firstValid(get('sort'), (raw) => {
    const r = CatalogSort.safeParse(raw.trim().toLowerCase());
    return r.success ? r.data : null;
  }) as CatalogSort | null;
  // `sort=relevance` without `q` has nothing to rank by, so it is dropped and the default (`popular`) applies.
  const sort: CatalogSort =
    sortParam === null || (sortParam === 'relevance' && q === null) ? defaultSort(q) : sortParam;

  const filters: CatalogFilters = {
    kind,
    q,
    category: firstValid(get('category'), normSlug),
    style: collectMulti(get('style'), normSlug),
    useCase: collectMulti(get('use_case'), normSlug),
    pageType:
      kind === 'template'
        ? (collectMulti(get('page_type'), (raw) => {
            const v = raw.trim().toLowerCase();
            return (PAGE_TYPES as readonly string[]).includes(v) ? v : null;
          }) as PageType[])
        : [],
    format: collectMulti(get('format'), (raw) => {
      const r = FormatAlias.safeParse(raw.trim().toLowerCase());
      return r.success ? r.data : null;
    }) as FormatAlias[],
    template: kind === 'section' ? firstValid(get('template'), normSlug) : null,
    access: firstValid(get('access'), (raw) => {
      const v = raw.trim().toLowerCase();
      return v === 'free' || v === 'paid' ? v : null;
    }) as 'free' | 'paid' | null,
    sort,
    cursor: firstValid(get('cursor'), (raw) => (CURSOR_RE.test(raw) ? raw : null)),
  };
  return { filters, carry };
}

/** Canonical key order: sorted by name. Values are slugs/enums (no encoding needed) except `q` and `cursor`. */
export function serializeCatalogFilters(filters: CatalogFilters): string {
  const pairs: Array<[string, string]> = [];
  if (filters.access) pairs.push(['access', filters.access]);
  if (filters.category) pairs.push(['category', filters.category]);
  if (filters.cursor) pairs.push(['cursor', filters.cursor]);
  if (filters.format.length) pairs.push(['format', [...new Set(filters.format)].sort().join(',')]);
  if (filters.kind === 'template' && filters.pageType.length)
    pairs.push(['page_type', [...new Set(filters.pageType)].sort().join(',')]);
  if (filters.q) pairs.push(['q', encodeURIComponent(filters.q)]);
  if (filters.sort !== defaultSort(filters.q)) pairs.push(['sort', filters.sort]);
  if (filters.style.length) pairs.push(['style', [...new Set(filters.style)].sort().join(',')]);
  if (filters.kind === 'section' && filters.template) pairs.push(['template', filters.template]);
  if (filters.useCase.length) pairs.push(['use_case', [...new Set(filters.useCase)].sort().join(',')]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export interface NormalizedCatalogQuery extends ParsedCatalogQuery {
  /** The canonical query (no leading `?`), used for `<link rel=canonical>` and cache keys. */
  canonical: string;
  /** Canonical query plus the carried attribution params: the 301 target's query. */
  redirectQuery: string;
  /** True when the incoming query already equals `redirectQuery` (no 301 needed). */
  isNormal: boolean;
}

/** ROUTES 8.2 normalization. Callers answer `301` to `?${redirectQuery}` when `isNormal` is false. */
export function normalizeCatalogQuery(kind: ProductKind, rawQuery: string): NormalizedCatalogQuery {
  const query = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  const parsed = parseCatalogQuery(kind, query);
  const canonical = serializeCatalogFilters(parsed.filters);
  const carry = parsed.carry.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const redirectQuery = [canonical, carry].filter((s) => s.length > 0).join('&');
  return { ...parsed, canonical, redirectQuery, isNormal: query === redirectQuery };
}

/** ROUTES 8.2: indexable only with no parameters or exactly one `category`. The "category has ≥ 1 published product" part is a DB check. */
export function catalogListingIndexable(filters: CatalogFilters): boolean {
  const canonical = serializeCatalogFilters(filters);
  return canonical === '' || /^category=[a-z0-9-]+$/.test(canonical);
}

/** The variant-kind sets the one search function receives for the `format` filter (one set per alias, ANDed). */
export function formatFilterKindSets(filters: CatalogFilters): VariantKind[][] {
  return filters.format.map((alias) => [...FORMAT_ALIAS_KINDS[alias]]);
}

export function emptyCatalogFilters(kind: ProductKind): CatalogFilters {
  return parseCatalogQuery(kind, '').filters;
}
