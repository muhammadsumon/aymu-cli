# aymu

The command-line installer for [Aymu](https://aymu.dev) Astro templates and sections.

It downloads a release you have access to, checks its signature and every file hash against the release manifest,
shows what it will change, and only then writes the files into your Astro project. It never overwrites a file without
asking, and it refuses archives with path traversal, symlinks, lifecycle scripts or unexpected files.

## Use

```bash
npx aymu login
npx aymu add section <id>
```

Most people run it through their coding agent: connect the Aymu MCP server, ask the agent to install an item, and run
the command it prints.

## Trust

- Releases are signed with Ed25519. The public keys the CLI accepts are in [`src/keyring.json`](src/keyring.json);
  the server's list, including revoked keys, is at https://aymu.dev/release-keys.json.
- Every version on npm is published from this repository by GitHub Actions with
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can check which commit built it.
- The package has no install scripts and no runtime dependencies: `dist/aymu.js` is one unminified file.

## Develop

Node 22.23.4 or later and pnpm (the version in `package.json` `packageManager`).

```bash
pnpm install
pnpm test
pnpm typecheck
AYMU_MCP_ORIGIN=https://mcp.aymu.dev pnpm build
```

This repository is generated from the Aymu monorepo (`scripts/export-cli-repo.mjs`). `domain/` holds the shared
release-format code the CLI uses.

## License

MIT
