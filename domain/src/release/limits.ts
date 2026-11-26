// RELEASE_FORMAT 9 (and 3.1, 4, 11.2): technical ceilings, not business settings.
import type { ReleaseBackedVariantKind } from '../enums';

const MiB = 1024 * 1024;

export interface ReleaseKindLimits {
  maxFiles: number;
  /** Release object (the compressed ZIP) in bytes. */
  maxObjectBytes: number;
  /** Sum of `files[].size`. */
  maxTotalUncompressedBytes: number;
  maxFileBytes: number;
}

export const RELEASE_LIMITS: Readonly<Record<ReleaseBackedVariantKind, ReleaseKindLimits>> = {
  astro_section: {
    maxFiles: 200,
    maxObjectBytes: 10 * MiB,
    maxTotalUncompressedBytes: 25 * MiB,
    maxFileBytes: 5 * MiB,
  },
  astro_project: {
    maxFiles: 3000,
    maxObjectBytes: 100 * MiB,
    maxTotalUncompressedBytes: 250 * MiB,
    maxFileBytes: 25 * MiB,
  },
  asset_pack: {
    maxFiles: 1000,
    maxObjectBytes: 200 * MiB,
    maxTotalUncompressedBytes: 300 * MiB,
    maxFileBytes: 50 * MiB,
  },
};

/** Stored manifest bytes (JCS) at most 2 MiB. */
export const MAX_MANIFEST_BYTES = 2 * MiB;
/** Per-entry uncompressed ÷ compressed, a bomb heuristic. */
export const MAX_COMPRESSION_RATIO = 100;

/** RELEASE_FORMAT 4 rule 3 (GLOSSARY 2.3). */
export const MAX_PATH_BYTES = 240;
export const MAX_SEGMENT_BYTES = 100;
export const MAX_PATH_SEGMENTS = 16;

export const MAX_TITLE_CHARS = 120;
export const MAX_MARKDOWN_CHARS = 20_000;
export const MAX_SOURCE_REF_CHARS = 1000;
export const MAX_ENTRY_USAGE_CHARS = 500;
/** RELEASE_FORMAT 11.2 rule 2: `data:` URLs above this are rejected in section sources. */
export const MAX_INLINE_DATA_URL_BYTES = 8 * 1024;

// ---- Admin uploads (SECURITY_MODEL 5.3 allowlist, TM-UP-1, TM-UP-2; Prompt 8) ------------------------------------
// Technical ceilings, not business settings. The MIME type is decided by magic bytes; the declared type must equal
// it. SVG, HTML, XML and every type not listed here are refused for every purpose.

const IMAGE_TYPES = ['image/avif', 'image/webp', 'image/png', 'image/jpeg'] as const;

export const UPLOAD_RULES = {
  screenshot: { bucket: 'public_media', types: IMAGE_TYPES, maxBytes: 10 * MiB },
  thumbnail: { bucket: 'public_media', types: IMAGE_TYPES, maxBytes: 10 * MiB },
  og_image: { bucket: 'public_media', types: IMAGE_TYPES, maxBytes: 10 * MiB },
  image: { bucket: 'public_media', types: IMAGE_TYPES, maxBytes: 10 * MiB },
  preview_video: { bucket: 'public_media', types: ['video/mp4', 'video/webm'], maxBytes: 50 * MiB },
  font: { bucket: 'private_releases', types: ['font/woff2', 'font/woff'], maxBytes: 5 * MiB },
  // RELEASE_FORMAT 9: the largest ZIP release object (astro_project).
  source_upload: { bucket: 'private_releases', types: ['application/zip'], maxBytes: 100 * MiB },
} as const satisfies Record<
  string,
  { bucket: 'public_media' | 'private_releases'; types: readonly string[]; maxBytes: number }
>;

/**
 * Above this an upload must use R2 multipart. Workers request bodies are capped near 100 MB, and the Worker holds the
 * whole body in memory (128 MB isolate) while it hashes and sniffs it, so the single request stays at half of that.
 * Every `public_media` purpose fits under it, so public media always takes the single request and its full structural
 * sniff (multipart is for `source_upload` only; Prompt 8 review).
 */
export const UPLOAD_SINGLE_REQUEST_MAX_BYTES = 50 * MiB;
/** R2 multipart: every part but the last is at least 5 MiB; the admin client sends 10 MiB parts. */
export const UPLOAD_PART_BYTES = 10 * MiB;
export const UPLOAD_MAX_PARTS = 100;
/** Per staff member per UTC day, summed over every declared upload (TM-UP-2). */
export const UPLOAD_DAILY_QUOTA_BYTES = 2048 * MiB;
/** `pending` assets older than this are deleted by the daily job (TM-UP-2). */
export const UPLOAD_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
