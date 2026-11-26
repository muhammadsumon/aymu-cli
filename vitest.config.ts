import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@aymu\/domain\/manifest$/, replacement: at('./domain/src/release/index.ts') },
      { find: /^@aymu\/domain\/limits$/, replacement: at('./domain/src/release/limits.ts') },
      { find: /^@aymu\/domain$/, replacement: at('./domain/src/index.ts') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
