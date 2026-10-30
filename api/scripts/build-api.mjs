/**
 * Build the self-contained production API artifact.
 *
 * Output (api/dist):
 *   server.js     bundled ESM entrypoint (Node 24)
 *   package.json  marks the artifact as ESM
 *   assets/       workbook templates and reference data required at runtime
 *
 * The artifact contains the application, workspace packages, and runtime
 * dependencies. Only Node built-ins and optional native drivers are external.
 * No `.env` file, credential, or development source is copied.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'api', 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'api', '_server.ts')],
  outfile: path.join(out, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: "import { createRequire as __afhomesCreateRequire } from 'node:module'; const require = __afhomesCreateRequire(import.meta.url);",
  },
  // Optional native/peer drivers: never required by the AFHomes runtime, and
  // they must not be pulled into the artifact when absent.
  external: [
    'kerberos',
    'mongodb-client-encryption',
    '@mongodb-js/zstd',
    'snappy',
    'socks',
    'aws4',
    '@aws-sdk/credential-providers',
    '@aws-sdk/client-sts',
  ],
});

cpSync(path.join(root, 'packages', 'contracts', 'assets'), path.join(out, 'assets'), {
  recursive: true,
});
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify({ name: 'afhomes-api', private: true, type: 'module' }, null, 2)}\n`,
);

console.log(`[api-build] artifact written to ${out}`);
