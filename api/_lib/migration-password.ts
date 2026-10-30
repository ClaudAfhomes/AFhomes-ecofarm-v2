import { compare, truncates } from 'bcryptjs';
import { verifyPassword } from 'better-auth/crypto';

const PREFIX = 'afhomes-supabase-bcrypt-v1:';

/** Only explicitly tagged migration credentials use bcrypt; new hashes remain native. */
export async function verifyMigrationPassword(input: { hash: string; password: string }) {
  if (!input.hash.startsWith(PREFIX)) {
    try {
      return await verifyPassword(input);
    } catch {
      return false;
    }
  }
  const legacy = input.hash.slice(PREFIX.length);
  // Bound imported work factors and reject bcrypt's silent 72-byte truncation.
  if (!/^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(legacy) || truncates(input.password))
    return false;
  return compare(input.password, legacy);
}
