// GLOSSARY 2.3: cross-cutting value formats.
import { z } from 'zod';

/** `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 80 characters. Unique per product kind. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const Slug = z.string().max(80).regex(SLUG_RE, 'expected a lowercase slug');
export type Slug = z.infer<typeof Slug>;

/** Lowercase hex SHA-256, 64 characters. */
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const Sha256Hex = z.string().regex(SHA256_RE, 'expected lowercase hex sha256');
export type Sha256Hex = z.infer<typeof Sha256Hex>;

/**
 * SemVer 2.0.0 `MAJOR.MINOR.PATCH[-prerelease]` with build metadata forbidden (GLOSSARY 2.3).
 * Regex adapted from https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
 */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
export const SemVer = z
  .string()
  .max(64)
  .regex(SEMVER_RE, 'expected SemVer MAJOR.MINOR.PATCH[-prerelease], no build metadata');
export type SemVer = z.infer<typeof SemVer>;

export function isPrerelease(version: string): boolean {
  return SEMVER_RE.test(version) && version.includes('-');
}

/** One comparator of an npm SemVer range: optional operator, then a full or partial version (x-ranges allowed). */
const COMPARATOR_RE = /^(?:[<>]=?|=|\^|~)?v?(?:0|[1-9]\d*|[xX*])(?:\.(?:0|[1-9]\d*|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Accepts npm registry SemVer ranges (https://github.com/npm/node-semver#ranges): `||` unions of
 * whitespace-separated comparators, hyphen ranges (`1.2.3 - 2.3.4`) and `*`. Rejects specs that are not
 * registry ranges (`file:`, `git…`, URLs, `workspace:`, `npm:` aliases), which RELEASE_FORMAT 12 forbids.
 */
export function isSemVerRange(range: string): boolean {
  if (range.length === 0 || range.length > 200 || range.trim() !== range) return false;
  return range.split('||').every((part) => {
    const set = part.trim();
    if (set === '' || set === '*') return set === '*';
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) return COMPARATOR_RE.test(hyphen[1] ?? '') && COMPARATOR_RE.test(hyphen[2] ?? '');
    return set.split(/\s+/).every((c) => COMPARATOR_RE.test(c));
  });
}
export const SemVerRange = z.string().refine(isSemVerRange, 'expected an npm registry SemVer range');
export type SemVerRange = z.infer<typeof SemVerRange>;

/** npm package name (https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name): lowercase, ≤ 214, optional scope. */
export const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
export const NpmPackageName = z.string().max(214).regex(NPM_PACKAGE_NAME_RE, 'expected an npm package name');

/** `*_amount_minor`: ASCII digits in the currency's minor unit, as Paddle sends it. Display only. */
export const AmountMinor = z.string().regex(/^(0|[1-9]\d*)$/, 'expected minor-unit digits');
/** ISO 4217, uppercase, 3 letters. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'expected ISO 4217 code');

/** Brand namespace: `slugify(BRAND_NAME)`, ≤ 32 characters (RELEASE_FORMAT 11.1). */
export const Namespace = z.string().max(32).regex(SLUG_RE, 'expected a namespace slug');

/** Standard base64 with padding (signatures and raw public keys). */
export const Base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'expected base64');
/** base64url without padding. */
export const Base64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'expected base64url');

/**
 * An absolute https URL. Host labels are DNS labels, or a deployment placeholder written `[UPPER_SNAKE]` as the
 * docs and the signed RELEASE_FORMAT 18 test vectors do (`https://[DOMAIN]/license#…`,
 * `https://{rid}.[PREVIEW_DOMAIN]/`). Brackets never occur in a configured host, and every place that needs the
 * exact value also compares it with configuration (RELEASE_FORMAT 14 "Catalog agreement").
 */
const HOST_LABEL = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[[A-Z_]+\])`;
export const HTTPS_URL_RE = new RegExp(
  String.raw`^https://${HOST_LABEL}(?:\.${HOST_LABEL})*(?::\d{1,5})?(?:[/?#][^\s]*)?$`,
);
export const HttpsUrl = z.string().max(2048).regex(HTTPS_URL_RE, 'expected an https URL');

// ---- Array and object constraints that must also appear in the emitted JSON Schema ----------------------
function uniq<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

/**
 * An array whose items must be unique: enforced by a refinement, and advertised as JSON Schema `uniqueItems: true`
 * through metadata. The MCP SDK converts schemas with Zod's `~standard.jsonSchema`, which carries `.meta()` keys
 * (https://unpkg.com/@modelcontextprotocol/server@2.4.0/dist/src-DdvbAHrR.mjs `standardSchemaToJsonSchema`).
 */
export function uniqueArray<T extends z.ZodArray<z.ZodType>>(schema: T, message = 'items must be unique'): T {
  return schema.refine((items) => uniq(items), { message }).meta({ uniqueItems: true });
}

/** MCP_PROTOCOL 8.1 / 9.1: "at least one of these keys", as a refinement plus the normative root `anyOf`. */
export function requireOneOf<T extends z.ZodObject>(schema: T, keys: readonly (keyof z.infer<T> & string)[]): T {
  return schema
    .refine(
      (v) => keys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
      `${keys.join(' or ')} is required`,
    )
    .meta({ anyOf: keys.map((k) => ({ required: [k] })) });
}
