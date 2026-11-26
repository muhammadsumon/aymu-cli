// RELEASE_FORMAT 4: path rules for every files[].path, installPath, install.root, install.manifestPath and
// entrypoints[].path. Checked by the packager, the upload API and the CLI against every ZIP entry name.
// Three layers: one path (any kind), one path for a variant kind, and the whole set (collisions).
import type { ReleaseBackedVariantKind } from '../enums';
import { MAX_PATH_BYTES, MAX_PATH_SEGMENTS, MAX_SEGMENT_BYTES } from './limits';

export type PathIssueCode =
  | 'empty'
  | 'nul'
  | 'control_char'
  | 'backslash'
  | 'colon'
  | 'non_ascii'
  | 'absolute'
  | 'trailing_slash'
  | 'path_too_long'
  | 'too_many_segments'
  | 'empty_segment'
  | 'dot_segment'
  | 'traversal'
  | 'segment_too_long'
  | 'trailing_dot_or_space'
  | 'windows_reserved'
  | 'forbidden_directory'
  | 'forbidden_name'
  | 'dotfile_not_allowed'
  | 'segment_grammar'
  | 'extension_not_allowed';

export interface PathIssue {
  code: PathIssueCode;
  path: string;
  message: string;
}

export interface PathRuleOptions {
  /** Rule 6: the dot-file allowlist applies to templates only. */
  allowTemplateDotfiles: boolean;
}

export function pathRulesForKind(kind: ReleaseBackedVariantKind): PathRuleOptions {
  return { allowTemplateDotfiles: kind === 'astro_project' };
}

/** Rule 2 segment grammar. `[...slug].astro` is valid; `...` inside a segment is not a `..` segment. */
const SEGMENT_RE = /^[A-Za-z0-9_\-[\]][A-Za-z0-9._\-[\]]*$/;
const DOT_SEGMENT_TAIL_RE = /^[A-Za-z0-9._\-[\]]+$/;

/** Rule 6: the only names that may begin with `.` (templates only). */
export const TEMPLATE_DOTFILE_NAMES = [
  '.gitignore',
  '.env.example',
  '.editorconfig',
  '.nvmrc',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierignore',
] as const;
/** Rule 6: the one allowed dot-directory path. */
export const TEMPLATE_DOT_PATHS = ['.vscode/extensions.json'] as const;

/** Rule 7: directories rejected at any depth. */
export const FORBIDDEN_DIRECTORIES = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  '.astro',
  '.wrangler',
  '.vercel',
  '.netlify',
  '.husky',
  '.githooks',
  '.github',
] as const;

/** Rule 7: file names rejected at any depth (secrets and config, OS junk, authoring markers). */
function isForbiddenFileName(name: string): boolean {
  if (name === '.env') return true;
  if (name.startsWith('.env.') && name !== '.env.example') return true;
  if (name.startsWith('.dev.vars') && name !== '.dev.vars.example') return true;
  if (
    ['.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '.DS_Store', 'Thumbs.db', 'template.json', 'section.json'].includes(
      name,
    )
  )
    return true;
  if (name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.p12')) return true;
  if (name.startsWith('id_rsa') || name.startsWith('id_ed25519')) return true;
  return false;
}

/** Rule 8: extension allowlist (case-sensitive) and exact names. */
export const ALLOWED_EXTENSIONS = [
  '.astro',
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.md',
  '.mdx',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.txt',
  '.xml',
  '.webmanifest',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.ico',
  '.woff2',
  '.woff',
] as const;
export const ALLOWED_EXACT_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSES.md', 'NOTICE', 'README.md'] as const;

/** Rule 4: base name, case-insensitively and ignoring the extension (everything after the first dot). */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function issue(code: PathIssueCode, path: string, message: string): PathIssue {
  return { code, path, message };
}

/**
 * Checks one path against RELEASE_FORMAT 4 rules 1–4 and 6–8 and returns the first problem, or null.
 * Rule 5 (collisions) needs the whole set: see {@link validatePathSet}.
 */
export function validateReleasePath(path: string, options: PathRuleOptions): PathIssue | null {
  if (path.length === 0) return issue('empty', path, 'empty path');
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 0) return issue('nul', path, 'NUL character');
    if (c < 0x20 || c === 0x7f) return issue('control_char', path, 'control character');
    if (c > 0x7e) return issue('non_ascii', path, 'non-ASCII character');
  }
  if (path.includes('\\')) return issue('backslash', path, 'backslash; paths are POSIX');
  if (path.includes(':')) return issue('colon', path, 'colon');
  if (path.startsWith('/')) return issue('absolute', path, 'absolute path');
  if (path.endsWith('/')) return issue('trailing_slash', path, 'trailing slash');
  if (path.length > MAX_PATH_BYTES) return issue('path_too_long', path, `longer than ${MAX_PATH_BYTES} bytes`);

  const segments = path.split('/');
  if (segments.length > MAX_PATH_SEGMENTS)
    return issue('too_many_segments', path, `more than ${MAX_PATH_SEGMENTS} segments`);

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (segment === '') return issue('empty_segment', path, 'empty segment');
    if (segment === '..') return issue('traversal', path, '".." segment');
    if (segment === '.') return issue('dot_segment', path, '"." segment');
    if (segment.length > MAX_SEGMENT_BYTES)
      return issue('segment_too_long', path, `segment longer than ${MAX_SEGMENT_BYTES} bytes`);
    if (segment.endsWith('.') || segment.endsWith(' '))
      return issue('trailing_dot_or_space', path, 'segment ends in "." or space');
    const base = segment.split('.')[0] ?? '';
    if (WINDOWS_RESERVED_RE.test(base)) return issue('windows_reserved', path, `Windows reserved name "${segment}"`);
    if (!isLast && (FORBIDDEN_DIRECTORIES as readonly string[]).includes(segment)) {
      return issue('forbidden_directory', path, `forbidden directory "${segment}"`);
    }
    if (isLast && isForbiddenFileName(segment)) return issue('forbidden_name', path, `forbidden file "${segment}"`);
    if (segment.startsWith('.')) {
      const allowed =
        options.allowTemplateDotfiles &&
        ((isLast && (TEMPLATE_DOTFILE_NAMES as readonly string[]).includes(segment)) ||
          (TEMPLATE_DOT_PATHS as readonly string[]).includes(path));
      if (!allowed) return issue('dotfile_not_allowed', path, `"${segment}" may not begin with "."`);
      if (!DOT_SEGMENT_TAIL_RE.test(segment.slice(1)))
        return issue('segment_grammar', path, `invalid segment "${segment}"`);
      continue;
    }
    if (!SEGMENT_RE.test(segment)) return issue('segment_grammar', path, `invalid segment "${segment}"`);
  }

  const name = segments[segments.length - 1] ?? '';
  if (name.startsWith('.')) return null; // an allowlisted dot-file (checked above)
  if ((ALLOWED_EXACT_NAMES as readonly string[]).includes(name)) return null;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return issue('extension_not_allowed', path, `extension "${ext || '(none)'}" is not allowed`);
  }
  return null;
}

/**
 * The narrow "safe relative POSIX path" test (no traversal, absolute paths, backslashes, NUL, control
 * characters, empty or dot segments), without the release allowlists. Useful for any user-supplied relative path.
 */
export function isSafeRelativePosixPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_BYTES) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c /* \ */ || c === 0x3a /* : */) return false;
  }
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

export type PathSetIssueCode = 'duplicate_path' | 'case_collision' | 'file_directory_conflict';
export interface PathSetIssue {
  code: PathSetIssueCode;
  path: string;
  other: string;
}

/**
 * RELEASE_FORMAT 4 rule 5: no two paths equal after ASCII case-folding (macOS and Windows file systems are
 * case-insensitive by default), and no file may also be a directory prefix of another path.
 */
export function validatePathSet(paths: readonly string[]): PathSetIssue[] {
  const issues: PathSetIssue[] = [];
  const seenExact = new Set<string>();
  const folded = new Map<string, string>();
  for (const p of paths) {
    if (seenExact.has(p)) {
      issues.push({ code: 'duplicate_path', path: p, other: p });
      continue;
    }
    seenExact.add(p);
    const f = p.toLowerCase();
    const prev = folded.get(f);
    if (prev !== undefined) issues.push({ code: 'case_collision', path: p, other: prev });
    else folded.set(f, p);
  }
  const dirs = new Map<string, string>();
  for (const p of paths) {
    const segs = p.toLowerCase().split('/');
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join('/');
      if (!dirs.has(dir)) dirs.set(dir, p);
    }
  }
  for (const p of paths) {
    const other = dirs.get(p.toLowerCase());
    if (other !== undefined) issues.push({ code: 'file_directory_conflict', path: p, other });
  }
  return issues;
}

/** True when `path` lies strictly inside directory `root` (`root` itself excluded). `.` contains every path. */
export function isPathUnder(path: string, root: string): boolean {
  if (root === '.') return true;
  return path.startsWith(`${root}/`);
}

/** Compares strings by their UTF-8 bytes ("byte-wise ascending", RELEASE_FORMAT 3.1 and 6.2). */
export function compareBytewise(a: string, b: string): number {
  if (a === b) return 0;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
