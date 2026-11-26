// Install guidance for framework renderers a section declares (RELEASE_FORMAT 9; ARCHITECTURE ADR-181). Aymu
// sections stay Astro, with React islands (`.tsx`/`.jsx`, `client:*`) for interactive parts. A section that ships
// one declares `@astrojs/react`, `react` and `react-dom`; the buyer's project must then also register the
// integration. The CLI prints this next to the dependency command and the MCP `prepare_install` puts it in its next
// steps. Nothing here runs a command: the guidance is text for the user or their agent. Pure.

/** The renderer integrations Aymu knows, by npm package. */
const INTEGRATIONS: Readonly<
  Record<string, { readonly importName: string; readonly peers: readonly string[]; readonly types: readonly string[] }>
> = {
  '@astrojs/react': { importName: 'react', peers: ['react', 'react-dom'], types: ['@types/react', '@types/react-dom'] },
};

/** One short instruction per declared renderer integration (empty when the release declares none). */
export function integrationSteps(dependencies: readonly { readonly name: string }[]): string[] {
  const names = new Set(dependencies.map((d) => d.name));
  const out: string[] = [];
  for (const [pkg, { importName, peers, types }] of Object.entries(INTEGRATIONS)) {
    if (!names.has(pkg)) continue;
    out.push(
      `This section uses React islands: add ${[pkg, ...peers].join(', ')} (and ${types.join(', ')} as dev ` +
        `dependencies), register the integration in astro.config (import ${importName} from '${pkg}'; ` +
        `integrations: [${importName}()]) and set tsconfig "jsx": "react-jsx", "jsxImportSource": "react". ` +
        `\`npx astro add ${importName}\` does all of this.`,
    );
  }
  return out;
}
