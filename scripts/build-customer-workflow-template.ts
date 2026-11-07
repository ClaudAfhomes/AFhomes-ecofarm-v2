import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_COLUMNS } from '../packages/contracts/src/schemas/customer-workflow.js';

// Rebuild the application-owned asset from the canonical manifest. Requires local Python/openpyxl.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('python', ['scripts/build-customer-workflow-template.py'], {
  cwd: root,
  input: JSON.stringify(WORKFLOW_COLUMNS),
  encoding: 'utf8',
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
