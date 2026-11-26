// Package-manager hooks a delivered `package.json` must not carry (RELEASE_FORMAT 12, SECURITY_MODEL TM-ZIP-5 / V7;
// P11 CLI-1). One list for the packager (`@aymu/delivery` source checks) and the CLI re-check, so they cannot drift.
// It covers every script npm, pnpm and yarn run on their own during install, publish, pack or uninstall: npm runs
// `preprepare` / `prepare` / `postprepare` on a local install (https://docs.npmjs.com/cli/v11/using-npm/scripts), and
// pnpm runs `pnpm:devPreinstall` (https://pnpm.io/scripts); every `pnpm:`-prefixed key is refused for future hooks.

export const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'preuninstall',
  'uninstall',
  'postuninstall',
  'dependencies',
] as const;

const PNPM_HOOK_PREFIX = 'pnpm:';

/** The hook names present in a `scripts` object, in a stable order (exact keys; any `pnpm:` key counts). */
export function lifecycleScriptsIn(scripts: Readonly<Record<string, unknown>>): string[] {
  const keys = Object.keys(scripts);
  const listed = LIFECYCLE_SCRIPTS.filter((hook) => Object.prototype.hasOwnProperty.call(scripts, hook));
  const pnpm = keys.filter((key) => key.toLowerCase().startsWith(PNPM_HOOK_PREFIX)).sort();
  return [...listed, ...pnpm];
}
