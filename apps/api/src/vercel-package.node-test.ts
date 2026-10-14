/**
 * Checks the deployed package boundary without Vitest, tsx, workspace sources, or credentials.
 * The fixture contains the emitted API and the transpiled Vercel adapter; native Node must resolve
 * the package export and answer health without connecting to PostgreSQL or an auth service.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiPackageRoot = join(repositoryRoot, 'apps/api');

await test('Vercel API rewrites use anonymous captures before the SPA fallback', async () => {
  const configuration: unknown = JSON.parse(
    await readFile(join(repositoryRoot, 'vercel.json'), 'utf8'),
  );
  assert.ok(
    typeof configuration === 'object' && configuration !== null && 'rewrites' in configuration,
  );
  // Vercel forwards unused named captures as query parameters; the API rejects query selectors.
  assert.deepEqual(configuration.rewrites, [
    { source: '/api', destination: '/api/[...path]' },
    { source: '/api/(.*)', destination: '/api/[...path]' },
    { source: '/(.*)', destination: '/index.html' },
  ]);
});

await test('native Node loads the packaged Vercel adapter without workspace TypeScript', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'kendomenu-vercel-package-'));
  try {
    const packagedApi = join(fixture, 'node_modules/@kendo-menu/api');
    await mkdir(packagedApi, { recursive: true });
    await cp(join(apiPackageRoot, 'package.json'), join(packagedApi, 'package.json'));
    await cp(join(apiPackageRoot, 'dist'), join(packagedApi, 'dist'), { recursive: true });

    const manifest: unknown = JSON.parse(
      await readFile(join(apiPackageRoot, 'package.json'), 'utf8'),
    );
    assert.ok(typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest);
    const dependencies = manifest.dependencies;
    assert.ok(typeof dependencies === 'object' && dependencies !== null);
    for (const name of Object.keys(dependencies)) {
      if (name.startsWith('@kendo-menu/')) continue;
      const destination = join(fixture, 'node_modules', name);
      await mkdir(dirname(destination), { recursive: true });
      await symlink(join(apiPackageRoot, 'node_modules', name), destination, 'dir');
    }
    await mkdir(join(fixture, 'node_modules/@vercel'), { recursive: true });
    await symlink(
      join(repositoryRoot, 'node_modules/@vercel/functions'),
      join(fixture, 'node_modules/@vercel/functions'),
      'dir',
    );
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
    await mkdir(join(fixture, 'api'));
    const adapter = ts.transpileModule(
      await readFile(join(repositoryRoot, 'api/[...path].ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    );
    await writeFile(join(fixture, 'api/[...path].js'), adapter.outputText);

    const result = spawnSync(
      process.execPath,
      [
        '--no-experimental-strip-types',
        '--input-type=module',
        '--eval',
        `
          import assert from 'node:assert/strict';
          import pg from 'pg';
          let pools = 0;
          pg.Pool = new Proxy(pg.Pool, {
            construct() {
              pools += 1;
              throw new Error('UNEXPECTED_DATABASE_POOL');
            },
          });
          globalThis.fetch = () => { throw new Error('UNEXPECTED_OUTBOUND_REQUEST'); };
          const { default: handler } = await import('./api/[...path].js');
          const health = await handler.fetch(new Request('https://preview.example/api/health'));
          assert.equal(health.status, 200);
          assert.deepEqual(await health.json(), { status: 'ok' });
          assert.equal(health.headers.get('cache-control'), 'private, no-store');
          const account = await handler.fetch(new Request('https://preview.example/api/account'));
          assert.equal(account.status, 401);
          assert.deepEqual(await account.json(), { error: 'UNAUTHENTICATED' });
          const queriedAccount = await handler.fetch(new Request('https://preview.example/api/account?path=account'));
          assert.equal(queriedAccount.status, 400);
          assert.deepEqual(await queriedAccount.json(), { error: 'INVALID_ACCOUNT_REQUEST' });
          const protectedResponse = await handler.fetch(new Request('https://preview.example/api/dashboard'));
          assert.equal(protectedResponse.status, 401);
          const proof = await handler.fetch(new Request('https://preview.example/api/dev/managed-identity'));
          assert.equal(proof.status, 404);
          assert.equal(pools, 0);
        `,
      ],
      {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          NODE_ENV: 'production',
        },
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
