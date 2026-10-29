/**
 * AFHomes geographic address lookup.
 *
 * Three read-only routes that let a client walk the official Philippine
 * hierarchy without ever learning where the data came from:
 *
 *   GET provinces
 *   GET provinces/{provinceCode}/localities
 *   GET localities/{localityCode}/barangays
 *
 * The browser never calls the provider directly. It talks to AFHomes, gets
 * normalized `{ code, name }` (plus `type` for localities), and the provider URL,
 * its field names and its failure modes stay on the server.
 *
 * Authorization is the existing model and adds NO new module key: reference
 * data is readable by anyone who may view customer applications
 * (`sales.customers`), which is the screen that needs it.
 */
import { addressHierarchyQuerySchema } from '@afhomes/contracts';

import { addressProvider } from '../_lib/address-source.js';
import { AddressProviderError } from '../_lib/address-provider.js';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { deny, fail, list, method, route } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';

/** A provider failure -> a status and a message that says nothing about upstream. */
function failProvider(res: VercelResponse, error: unknown): void {
  if (!(error instanceof AddressProviderError)) {
    return fail(res, 'INTERNAL', 'Address lookup is unavailable', 503);
  }
  switch (error.code) {
    case 'PROVIDER_NOT_FOUND':
      return fail(res, 'NOT_FOUND', 'No such location', 404);
    case 'PROVIDER_BAD_RESPONSE':
      // 502: we asked, upstream answered with something we refuse to trust.
      return fail(res, 'INTERNAL', 'Address lookup returned an unusable response', 502);
    default:
      return fail(res, 'INTERNAL', 'Address lookup is unavailable', 503);
  }
}

export function createAddressHandler(authorize = authorizeAfHomes, provider = addressProvider()) {
  return async function address(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (method(req) !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(res, 'VALIDATION_ERROR', 'Method not allowed', 405);
    }

    const publicReference = route(req, 'GET', /^public(?:\/(.*))?$/);
    if (publicReference) {
      if (!consumeIdentifierAttempt(req, 'public-address-reference').allowed)
        return fail(res, 'RATE_LIMITED', 'Too many address lookups. Try again shortly.', 429);
      req = { ...req, query: { ...req.query, familyPath: publicReference[1] ?? '' } };
    } else {
      const auth = await authorize(req, 'sales.customers');
      if ('error' in auth) {
        const ost = await authorize(req, 'network.ost_registrations');
        if ('error' in ost) return deny(res, auth);
      }
    }

    if (route(req, 'GET', /^regions$/)) {
      try {
        if (!provider.regions) throw new AddressProviderError('PROVIDER_UNAVAILABLE');
        return list(res, await provider.regions());
      } catch (error) {
        return failProvider(res, error);
      }
    }
    const regionProvinces = route(req, 'GET', /^regions\/([^/]+)\/provinces$/);
    if (regionProvinces) {
      const code = addressHierarchyQuerySchema.safeParse(regionProvinces[1]);
      if (!code.success)
        return fail(res, 'VALIDATION_ERROR', 'Use the 10-digit PSGC region code', 400);
      try {
        if (!provider.provincesInRegion) throw new AddressProviderError('PROVIDER_UNAVAILABLE');
        return list(res, await provider.provincesInRegion(code.data));
      } catch (error) {
        return failProvider(res, error);
      }
    }

    const provinceList = route(req, 'GET', /^$/);
    const localityList = route(req, 'GET', /^provinces\/([^/]+)\/localities$/);
    const barangayList = route(req, 'GET', /^localities\/([^/]+)\/barangays$/);

    if (provinceList) {
      try {
        return list(res, await provider.provinces());
      } catch (error) {
        return failProvider(res, error);
      }
    }

    const scoped = localityList ?? barangayList;
    if (!scoped) {
      return fail(res, 'NOT_FOUND', 'Unknown address route', 404);
    }

    // The code is a path segment, so validate it as one. A name in a code slot is
    // a client mistake and must never become an upstream request.
    const code = addressHierarchyQuerySchema.safeParse(scoped[1]);
    if (!code.success) {
      return fail(res, 'VALIDATION_ERROR', 'Use the 10-digit PSGC code for that location', 400);
    }

    try {
      return list(
        res,
        localityList ? await provider.localities(code.data) : await provider.barangays(code.data),
      );
    } catch (error) {
      return failProvider(res, error);
    }
  };
}

export default createAddressHandler();
