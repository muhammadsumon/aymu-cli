// JSON Canonicalization Scheme, RFC 8785 (https://www.rfc-editor.org/rfc/rfc8785).
// Object members sorted by UTF-16 code units, no insignificant whitespace, ES number and string serialization
// (JSON.stringify gives the RFC 8785 forms for finite numbers and for strings).

export class JcsError extends Error {}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new JcsError('JCS: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>);
      // Default sort compares UTF-16 code units, which is what RFC 8785 3.2.3 requires.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries
        .map(([k, v]) => {
          if (v === undefined) throw new JcsError(`JCS: undefined value at "${k}"`);
          return `${JSON.stringify(k)}:${canonicalize(v)}`;
        })
        .join(',')}}`;
    }
    default:
      throw new JcsError(`JCS: unsupported type ${typeof value}`);
  }
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

/**
 * RELEASE_FORMAT 3.1 / 15.3 C1: bytes are acceptable only if they are exactly `JCS(parse(bytes))`, which closes
 * duplicate keys, alternative encodings and parser differentials. Returns the parsed value, or null.
 */
export function parseCanonicalJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    return canonicalize(parsed) === text ? parsed : null;
  } catch {
    return null;
  }
}
