import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';

it.each([
  ['GET', '/api/v1/admin/afhomes/dashboard', true],
  ['GET', '/api/v1/sales', true],
  ['GET', '/api/v1/ost/me', true],
  ['GET', '/api/v1/members', true],
  ['GET', '/api/v1/admin/afhomes/public-verification-settings', true],
  ['POST', '/api/v1/members/ost', false],
  ['POST', '/api/v1/members/123/team-transfer', false],
  ['PATCH', '/api/v1/members/123', false],
  ['POST', '/api/v1/members/123/transfer', false],
  ['POST', '/api/v1/sale-team/search/start', false],
  ['GET', '/api/v1/ost-accreditation/sponsors', true],
  ['GET', '/api/v1/sale-team/123?kind=OST', true],
  ['GET', '/api/v1/profile-photo/staff', true],
  ['GET', '/api/v1/documents/current', true],
  ['GET', '/api/v1/analytics?period=month', true],
  ['GET', '/api/v1/analytics/sales-trend', true],
  ['GET','/api/v1/customer-imports/reservations/123/claims',true],
  ['GET','/api/v1/customer-imports/continuations',true],
  ['GET','/api/v1/customer-imports/rows/123/intake',true],
  ['GET','/api/v1/customer-imports/rows/123/continuation',true],
  ['POST','/api/v1/customer-imports/rows/123/continuation',false],
  ['GET','/api/v1/customer-imports/jobs',true],
  ['GET','/api/v1/customer-imports/template/xlsx',true],
  ['POST','/api/v1/customer-imports/parse',false],
  ['POST','/api/v1/customer-imports/reservations/123/claims',false],
  ['POST','/api/v1/customer-imports/payment-claims/11111111-1111-4111-8111-111111111111/reconcile',false],
  ['PUT','/api/v1/customer-imports/payment-claims/11111111-1111-4111-8111-111111111111/proof/bytes',false],
  ['POST', '/api/v1/analytics', false],
  ['POST', '/api/v1/documents/customer/upload-url', false],
  ['PUT', '/api/v1/documents/123/upload-bytes', false],
  ['GET', '/api/v1/private-files?token=synthetic', true],
  ['POST', '/api/v1/private-files', false],
  ['POST', '/api/v1/ost-accreditation/members/123/renew', false],
  ['POST', '/api/v1/ost-accreditation/members/123/applicant', false],
  ['PUT', '/api/v1/profile-photo/staff', false],
  ['POST', '/api/v1/sale-team/123', false],
  ['GET', '/api/v1/ist-portal', true],
  ['GET', '/api/v1/official-forms/customer-applications', true],
  ['POST', '/api/v1/admin/afhomes/session/password', true],
  ['POST', '/api/v1/auth/identity/sign-in/email', true],
  ['POST', '/api/v1/sales', false],
  ['POST', '/api/v1/earning/adjust', false],
  ['POST', '/api/v1/official-forms/customer-applications', false],
  ['DELETE', '/api/v1/customers/123', false],
  ['GET', '/api/v1/customer/points', false],
  ['GET', '/api/v1/sales-unconverted', false],
])('limits real-database development access for %s %s', (method, url, allowed) => {
  const runtime = vi.fn(async () => {}),
    writeHead = vi.fn(),
    end = vi.fn();
  createMongoDevelopmentHandler(runtime)(
    { method, url } as IncomingMessage,
    { writeHead, end } as unknown as ServerResponse,
  );
  expect(runtime).toHaveBeenCalledTimes(allowed ? 1 : 0);
  if (!allowed)
    expect(writeHead).toHaveBeenCalledWith(
      403,
      expect.objectContaining({ 'Cache-Control': 'no-store' }),
    );
});

it.each([
  ['POST','/api/v1/documents/customer/upload-url',true],['PUT','/api/v1/documents/123/upload-bytes',true],
  ['POST','/api/v1/members/123/team-transfer',true],
  ['POST','/api/v1/ost-accreditation/members/123/applicant',true],
  ['PATCH','/api/v1/members/123',true],
  ['POST','/api/v1/members/123/transfer',true],
  ['POST','/api/v1/members/ost',true],['POST','/api/v1/official-forms/customer-applications',true],
  ['PUT','/api/v1/admin/afhomes/public-verification-settings',true],['GET','/api/v1/customer/points',true],
  ['POST','/api/v1/auth/customer/activate',true],['POST','/api/v1/sale-team/search/start',true],
  ['POST','/api/v1/customer-imports',false],['POST','/api/v1/earning',false],['GET','/api/v1/sales-unconverted',false],
  ['POST','/api/v1/earning/adjust',true],['GET','/api/v1/earning/adjust',false],
  ['POST','/api/v1/earning/services',false],
  ['POST','/api/v1/customer-imports/parse',true],
  ['POST','/api/v1/customer-imports/jobs/11111111-1111-4111-8111-111111111111/cancel',true],
  ['POST','/api/v1/customer-imports/jobs/11111111-1111-4111-8111-111111111111/confirm',true],
  ['POST','/api/v1/customer-imports/rows/11111111-1111-4111-8111-111111111111/continuation',true],
  ['POST','/api/v1/customer-imports/payment-claims/11111111-1111-4111-8111-111111111111/reconcile',true],
  ['PUT','/api/v1/customer-imports/payment-claims/11111111-1111-4111-8111-111111111111/proof/bytes',true],
  ['POST','/api/v1/customer-imports/payment-claims/11111111-1111-4111-8111-111111111111/unknown',false],
])('enables only native core routes after explicit operator readiness for %s %s',(method,url,allowed)=>{
  const runtime=vi.fn(async()=>{});
  createMongoDevelopmentHandler(runtime,{coreWritesEnabled:true})({method,url} as IncomingMessage,{writeHead:vi.fn(),end:vi.fn()} as unknown as ServerResponse);
  expect(runtime).toHaveBeenCalledTimes(allowed ? 1:0);
});
