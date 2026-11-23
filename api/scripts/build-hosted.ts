import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostedBuildEnvironment } from '../_lib/hosted-build.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'afhomes-public-build-'));
try {
  const env = hostedBuildEnvironment(
    process.env,
    process.env.AFHOMES_PUBLIC_ORIGIN ?? '',
    temporary,
  );
  const run = (args: string[], cwd = root) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env,
        stdio: 'inherit',
        windowsHide: true,
      });
      child.once('error', () => reject(new Error('Hosted build process could not start')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Hosted build check failed')),
      );
    });
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  await run([tsc, '--noEmit', '-p', 'api/tsconfig.json']);
  // Vite resolves workspace TypeScript through its existing build pipeline; no server env file is read.
  for (const app of ['web', 'admin']) {
    await run([tsc, '--noEmit', '-p', `apps/${app}/tsconfig.json`]);
    await run([
      path.join(root, 'apps', app, 'node_modules/vite/bin/vite.js'),
      'build',
      `apps/${app}`,
      '--config',
      `apps/${app}/vite.config.ts`,
    ]);
  }
  await run([path.join(root, 'apps/web/scripts/prerender.mjs')], path.join(root, 'apps/web'));
  const output = path.resolve(root, 'vercel-static');
  if (path.dirname(output) !== path.resolve(root)) throw new Error('Unsafe static assembly target');
  await run(['scripts/assemble-vercel-output.mjs']);
  await run(['scripts/check-env-isolation.mjs', '--built']);
} catch {
  console.error(
    'Hosted public build failed. Check the public origin and build prerequisites; secret values are not logged.',
  );
  process.exitCode = 1;
} finally {
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) === path.resolve(tmpdir()) &&
    path.basename(resolved).startsWith('afhomes-public-build-')
  )
    await rm(resolved, { recursive: true, force: true });
}
