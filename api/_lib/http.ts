/**
 * Shared Vercel request/response shapes for api/ handlers.
 * Both the Vercel runtime and api/dev-server.ts adapt to these types -
 * handlers stay identical in both environments.
 */
export type VercelRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
};

export type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  end: () => void;
};
