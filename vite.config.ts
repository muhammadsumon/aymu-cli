// Bundles the `aymu` bin into one Node ESM file (dist/aymu.js). Every dependency, including the vendored domain
// code, is bundled in; Node built-ins stay external. The production server origin is fixed at build time (ADR-76):
// build with AYMU_MCP_ORIGIN=https://mcp.aymu.dev. Unset, the CLI refuses until a domain exists.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  define: { __AYMU_MCP_ORIGIN__: JSON.stringify(process.env.AYMU_MCP_ORIGIN ?? '') },
  resolve: {
    alias: [
      { find: /^@aymu\/domain\/manifest$/, replacement: at('./domain/src/release/index.ts') },
      { find: /^@aymu\/domain\/limits$/, replacement: at('./domain/src/release/limits.ts') },
      { find: /^@aymu\/domain$/, replacement: at('./domain/src/index.ts') },
    ],
  },
  ssr: { target: 'node', noExternal: true },
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rolldownOptions: { output: { entryFileNames: 'aymu.js', format: 'es' } },
  },
});
