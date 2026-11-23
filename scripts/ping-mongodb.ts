import { loadEnvFile } from 'node:process';
import { pingMongoDB } from '../api/_lib/mongodb.js';

async function main() {
  try {
    // Run from the repository root. Existing shell variables take precedence.
    loadEnvFile('.env.local');
    await pingMongoDB();
    console.log('PASS: authenticated MongoDB ping against afhomes_dev. No data writes executed.');
  } catch {
    // Driver errors can contain hostnames and connection details; never print them.
    console.error(
      'FAIL: MongoDB ping. Check local environment, database name, Atlas access, DNS and TLS. No data writes executed.',
    );
    process.exitCode = 1;
  }
}
void main();
