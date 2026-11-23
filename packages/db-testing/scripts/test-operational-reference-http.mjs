import assert from 'node:assert/strict';

/** Real API/PostgREST regression; credentials remain in caller memory. */
export async function verifyOperationalReferenceRetries(f) {
  for (const url of [f.apiUrl, f.supabaseUrl])
    assert.equal(new URL(url).hostname, '127.0.0.1', 'Loopback only');
  assert.match(f.prefix, /^infra-/);
  let checks = 0;
  const check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name);
    checks++;
    console.log('PASS ' + name);
  };
  const create = async (token, reference) => {
    const response = await fetch(f.apiUrl + '/earning/purchases', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        membershipId: f.membership,
        reference,
        applyTierDiscount: false,
        lines: [{ serviceId: f.service, quantity: 1 }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  };
  const read = async (path) => {
    const response = await fetch(f.supabaseUrl + '/rest/v1/' + path, {
      headers: { apikey: f.serviceKey, Authorization: 'Bearer ' + f.serviceKey },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const ledgerBefore = (await read('points_ledger?select=id')).length;
  const paymentsBefore = (await read('purchase_payments?select=id')).length;
  const reference = f.prefix + '-retry-check';
  const initial = await create(f.gsdToken, reference);
  check('initial request creates purchase', initial.status, 201);
  const retry = await Promise.all([create(f.gsdToken, reference), create(f.gsdToken, reference)]);
  check(
    'concurrent identical retries succeed',
    retry.map((r) => r.status),
    [201, 201],
  );
  check(
    'identical retries return original purchase',
    retry.map((r) => r.body.purchaseId),
    [initial.body.purchaseId, initial.body.purchaseId],
  );
  const conflict = await create(f.adminToken, reference);
  check('conflicting actor returns controlled 409', conflict.status, 409);
  check('conflict preserves domain response', conflict.body.error.code, 'CONFLICT');
  const query = (ref) => 'purchases?select=id&idempotency_reference=eq.' + encodeURIComponent(ref);
  check('one purchase for retry reference', (await read(query(reference))).length, 1);
  const raceReference = f.prefix + '-race-check';
  const race = await Promise.all([
    create(f.gsdToken, raceReference),
    create(f.adminToken, raceReference),
  ]);
  check(
    'conflicting concurrent requests have one winner',
    race.map((r) => r.status).sort(),
    [201, 409],
  );
  check('one purchase for raced reference', (await read(query(raceReference))).length, 1);
  check(
    'duplicate requests create no payments',
    (await read('purchase_payments?select=id')).length,
    paymentsBefore,
  );
  check(
    'duplicate requests create no ledger entries',
    (await read('points_ledger?select=id')).length,
    ledgerBefore,
  );
  return checks;
}
