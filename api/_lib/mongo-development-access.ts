import type { IncomingMessage, ServerResponse } from 'node:http';

/** Real development DB: converted reads and account changes only, pending commercial initialization approval. */
export function createMongoDevelopmentHandler(
  runtime: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  options: {coreWritesEnabled?:boolean} = {},
) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const account =
      path.startsWith('/api/v1/auth/identity/') ||
      path === '/api/v1/auth/portals' ||
      /^\/api\/v1\/admin\/afhomes\/session(?:\/password)?$/.test(path);
    const convertedRead =
      req.method === 'GET' &&
      (/^\/api\/v1\/(?:card-products|card-categories|customers|sales|commissions|queues|memberships|members|referrals|genealogy|analytics|address|official-forms|ist-portal|ost|ost-accreditation|sale-team|profile-photo|documents)(?:\/|$)/.test(
        path,
      ) ||
        /^\/api\/v1\/admin\/afhomes\/(?:dashboard|roles|departments|staff|public-verification-settings)(?:\/|$)/.test(path) ||
        /^\/api\/v1\/customer-imports\/(?:sources|reservations)\/[^/]+\/claims$/.test(path) ||
        /^\/api\/v1\/customer-imports\/(?:continuations|rows\/[^/]+\/(?:intake|continuation)|sources\/[^/]+\/intake)$/.test(path) ||
        /^\/api\/v1\/customer-imports\/(?:jobs(?:\/[a-f0-9-]{36})?|template\/(?:csv|xlsx))$/.test(path) ||
        /^\/api\/v1\/customer-imports\/payment-claims\/[^/]+\/proof$/.test(path) ||
        path === '/api/v1/sale-team/me' ||
        path === '/api/v1/sales-involvement' ||
        path === '/api/v1/private-files' ||
        path === '/api/v1/health');
    const enabledCore=options.coreWritesEnabled === true && ['GET','POST','PUT','PATCH','DELETE'].includes(req.method ?? '') &&
      (/^\/api\/v1\/(?:card-products|card-categories|customers|sales|commissions|queues|memberships|members|referrals|genealogy|address|official-forms|ist-portal|ost|ost-accreditation|sale-team|profile-photo|customer|documents)(?:\/|$)/.test(path) ||
       /^\/api\/v1\/admin\/afhomes\/(?:roles|departments|staff|public-verification-settings)(?:\/|$)/.test(path) ||
       /^\/api\/v1\/customer-imports\/payment-claims\/[a-f0-9-]{36}\/(?:reconcile|proof(?:\/(?:upload|complete|bytes))?)$/.test(path) ||
       (req.method === 'POST' && /^\/api\/v1\/customer-imports\/(?:parse|jobs\/[a-f0-9-]{36}\/(?:cancel|confirm)|rows\/[a-f0-9-]{36}\/continuation)$/.test(path)) ||
       (req.method === 'POST' && path === '/api/v1/earning/adjust') ||
       path === '/api/v1/auth/customer/activate');
    if (account || convertedRead || enabledCore) {
      void runtime(req, res);
      return;
    }
    res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'This action is not available during the MongoDB conversion.',
        },
      }),
    );
  };
}
