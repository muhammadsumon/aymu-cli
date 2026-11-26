// GLOSSARY 11 `RECOMMENDED_CLI_VERSION`: the `aymu` version that install recipes pin (MCP_PROTOCOL 10.2). Bumped
// with each CLI release, and every CLI release embeds every active signing key (RELEASE_FORMAT 7.3).
// `packages/cli/test` asserts that the CLI package version equals this constant.
export const RECOMMENDED_CLI_VERSION = '0.1.0';

/** The CLI package name in recipes (MCP_PROTOCOL 9.1 `cli.package`). */
export const CLI_PACKAGE_NAME = 'aymu';

/** The environment variable the CLI reads a grant from (GLOSSARY 11; the literal is pinned by MCP_PROTOCOL 9.1). */
export const INSTALL_GRANT_ENV = 'BRAND_INSTALL_GRANT';
