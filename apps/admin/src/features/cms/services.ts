import {
  cmsDocumentSchema,
  cmsHistorySchema,
  cmsMediaSchema,
  cmsPageSchema,
  type CmsDocumentKey,
} from '@afhomes/contracts';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const getCmsDocuments = () => requestList('/cms/documents', cmsDocumentSchema);
export const saveCmsDocument = (
  key: CmsDocumentKey,
  value: unknown,
  expectedVersion: number,
  changeSummary: string,
) =>
  request(
    `/cms/documents/${key}`,
    cmsDocumentSchema,
    json('PATCH', { value, expectedVersion, changeSummary }),
  );
export const publishCmsDocument = (key: CmsDocumentKey, publish: boolean) =>
  request(
    `/cms/documents/${key}/${publish ? 'publish' : 'unpublish'}`,
    cmsDocumentSchema,
    json('POST'),
  );

export const getCmsPages = () => requestList('/cms/pages', cmsPageSchema);
export const createCmsPage = (body: unknown) =>
  request('/cms/pages', cmsPageSchema, json('POST', body));
export const updateCmsPage = (id: string, body: unknown) =>
  request(`/cms/pages/${id}`, cmsPageSchema, json('PATCH', body));
export const publishCmsPage = (id: string, publish: boolean) =>
  request(`/cms/pages/${id}/${publish ? 'publish' : 'unpublish'}`, cmsPageSchema, json('POST'));

export const getCmsMedia = () => requestList('/cms/media', cmsMediaSchema);
export const uploadCmsMedia = (body: unknown) =>
  request('/cms/media', cmsMediaSchema, json('POST', body));
export const deleteCmsMedia = (id: string) =>
  request(`/cms/media/${id}`, cmsMediaSchema, json('DELETE'));
export const getCmsHistory = () => requestList('/cms/history', cmsHistorySchema);
