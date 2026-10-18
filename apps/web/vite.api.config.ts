import { fileURLToPath } from 'node:url';

import apiPackage from '../api/package.json' with { type: 'json' };
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const externalDependencies = new Set(
  Object.keys(apiPackage.dependencies).filter((name) => name !== '@kendo-menu/domain'),
);

function getPackageName(id: string): string | undefined {
  const parts = id.split('/');
  if (!parts[0]?.startsWith('@')) return parts[0];
  return parts[1] === undefined ? undefined : `${parts[0]}/${parts[1]}`;
}

export default defineConfig({
  root: webRoot,
  envDir: false,
  ssr: {
    noExternal: [/^@kendo-menu\/domain(?:\/.*)?$/u],
  },
  build: {
    ssr: true,
    outDir: fileURLToPath(new URL('../api/dist/', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: {
      input: fileURLToPath(new URL('../api/src/index.ts', import.meta.url)),
      external: (id) => {
        const packageName = getPackageName(id);
        return packageName !== undefined && externalDependencies.has(packageName);
      },
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
