import { cmsDocumentKeySchema } from '@afhomes/contracts';
import { applyCmsPreview } from './cms';

/**
 * Receiving end of the admin "Preview saved draft" iframe
 * (apps/admin/src/features/cms/CmsPreview.tsx). The admin sends only a saved,
 * authorised draft; this side accepts it only from the admin origin(s): the
 * configured admin URL and, for same-origin deployments, this page's own origin,
 * from the embedding window, and for the session named in the iframe URL.
 * Nothing is stored: the overlay lives in memory for this page view only.
 */
export function startCmsPreview(
  adminOrigins: string[],
  session: string,
  parent: Window = window.parent,
): () => void {
  const receive = (event: MessageEvent) => {
    const data = event.data as {
      type?: unknown;
      session?: unknown;
      document?: { key?: unknown; draftValue?: unknown };
    } | null;
    if (
      !adminOrigins.includes(event.origin) ||
      event.source !== parent ||
      data?.type !== 'afhomes-cms-preview-content' ||
      data.session !== session
    )
      return;
    const key = cmsDocumentKeySchema.safeParse(data.document?.key);
    if (key.success) applyCmsPreview(key.data, data.document?.draftValue);
  };
  window.addEventListener('message', receive);
  for (const origin of adminOrigins)
    parent.postMessage({ type: 'afhomes-cms-preview-ready', session }, origin);
  return () => window.removeEventListener('message', receive);
}
