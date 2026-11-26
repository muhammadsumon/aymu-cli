// A small npm-compatible SemVer range check for RELEASE_FORMAT 15.3 F1 (installed Astro, Tailwind CSS and Node against
// the manifest's requirements). Supports what registry ranges use (`isSemVerRange` in @aymu/domain accepts exactly
// these): `||` unions, space-separated comparator sets, `<`, `<=`, `>`, `>=`, `=`, `^`, `~`, x-ranges (`4.x`, `*`),
// partial versions and hyphen ranges. Prerelease versions only satisfy comparators on the same major.minor.patch, as
// in node-semver. No dependency: the CLI keeps its install footprint to `fflate` and `zod`.

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.prerelease, b.prerelease);
}

interface Comparator {
  op: '<' | '<=' | '>' | '>=' | '=';
  v: Version;
}

interface Partial {
  major: number | null;
  minor: number | null;
  patch: number | null;
  pre: string[];
}

function parsePartial(text: string): Partial | null {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!m) return null;
  const num = (s: string | undefined) => (s === undefined || /^[xX*]$/.test(s) ? null : Number(s));
  return { major: num(m[1]), minor: num(m[2]), patch: num(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

const v = (major: number, minor: number, patch: number, prerelease: string[] = []): Version => ({
  major,
  minor,
  patch,
  prerelease,
});

/** Desugars one comparator token into plain comparators (node-semver rules for ^, ~ and x-ranges). */
function desugar(token: string): Comparator[] | null {
  const m = /^(<=|>=|<|>|=|\^|~)?(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? '';
  const p = parsePartial(m[2] ?? '');
  if (!p) return null;
  if (p.major === null) return op === '<' || op === '>' ? [{ op: '<', v: v(0, 0, 0, ['0']) }] : [];
  const M = p.major;
  const mi = p.minor;
  const pa = p.patch;
  if (op === '^') {
    const low = v(M, mi ?? 0, pa ?? 0, p.pre);
    const high =
      M > 0 || mi === null ? v(M + 1, 0, 0) : mi > 0 || pa === null ? v(0, mi + 1, 0) : v(0, 0, (pa ?? 0) + 1);
    return [
      { op: '>=', v: low },
      { op: '<', v: { ...high, prerelease: ['0'] } },
    ];
  }
  if (op === '~') {
    const low = v(M, mi ?? 0, pa ?? 0, p.pre);
    const high = mi === null ? v(M + 1, 0, 0) : v(M, mi + 1, 0);
    return [
      { op: '>=', v: low },
      { op: '<', v: { ...high, prerelease: ['0'] } },
    ];
  }
  if (mi === null || pa === null) {
    // x-range: 4 = 4.x = >=4.0.0 <5.0.0-0; with an operator, the bound moves accordingly.
    const low = v(M, mi ?? 0, 0);
    const high = mi === null ? v(M + 1, 0, 0, ['0']) : v(M, mi + 1, 0, ['0']);
    switch (op) {
      case '':
      case '=':
        return [
          { op: '>=', v: low },
          { op: '<', v: high },
        ];
      case '>':
        return [{ op: '>=', v: high }];
      case '>=':
        return [{ op: '>=', v: low }];
      case '<':
        return [{ op: '<', v: { ...low, prerelease: ['0'] } }];
      case '<=':
        return [{ op: '<', v: high }];
    }
  }
  const exact = v(M, mi ?? 0, pa ?? 0, p.pre);
  return [{ op: (op === '' ? '=' : op) as Comparator['op'], v: exact }];
}

function test(c: Comparator, x: Version): boolean {
  const d = compare(x, c.v);
  switch (c.op) {
    case '<':
      return d < 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '>=':
      return d >= 0;
    case '=':
      return d === 0;
  }
}

function parseSet(set: string): Comparator[] | null {
  const trimmed = set.trim();
  if (trimmed === '' || trimmed === '*') return [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen) {
    const low = desugar(`>=${hyphen[1] ?? ''}`);
    const hp = parsePartial(hyphen[2] ?? '');
    if (!low || !hp || hp.major === null) return null;
    const high: Comparator[] =
      hp.minor === null
        ? [{ op: '<', v: v(hp.major + 1, 0, 0, ['0']) }]
        : hp.patch === null
          ? [{ op: '<', v: v(hp.major, hp.minor + 1, 0, ['0']) }]
          : [{ op: '<=', v: v(hp.major, hp.minor, hp.patch, hp.pre) }];
    return [...low, ...high];
  }
  const out: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const cs = desugar(token);
    if (!cs) return null;
    out.push(...cs);
  }
  return out;
}

/** True when `version` satisfies `range`. An unparsable version or range is never satisfied (fail closed). */
export function satisfies(version: string, range: string): boolean {
  const x = parseVersion(version);
  if (!x) return false;
  for (const set of range.split('||')) {
    const comparators = parseSet(set);
    if (!comparators) continue;
    if (!comparators.every((c) => test(c, x))) continue;
    if (x.prerelease.length === 0) return true;
    // A prerelease only matches when a comparator in the set names the same tuple with a prerelease.
    if (
      comparators.some(
        (c) =>
          c.v.prerelease.length > 0 &&
          !(c.v.prerelease.length === 1 && c.v.prerelease[0] === '0') &&
          c.v.major === x.major &&
          c.v.minor === x.minor &&
          c.v.patch === x.patch,
      )
    ) {
      return true;
    }
  }
  return false;
}
