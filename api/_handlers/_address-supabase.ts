import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { createAddressHandler } from './_address.js';

/**
 * Supabase/Vercel binding for the shared address handler. Loaded only by the
 * legacy router; the MongoDB production runtime passes its own authorize.
 */
export default createAddressHandler(authorizeAfHomes);
