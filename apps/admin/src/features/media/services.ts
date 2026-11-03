import {
  deletePublicMediaSchema,
  publicMediaSchema,
  type PublicMedia,
  type PublicMediaStatus,
} from '@afhomes/contracts';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

const upload = (path: string, file: File): RequestInit => ({
  method: path.includes('/media/') ? 'PUT' : 'POST',
  body: file,
  headers: { 'Content-Type': file.type || 'application/octet-stream' },
});

const meta = (name: string, altText: string, category: string) =>
  `name=${encodeURIComponent(name)}&alt=${encodeURIComponent(altText)}&category=${encodeURIComponent(category)}`;

export const getPublicMedia = (params: { search: string; category: string }) => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  return requestList(`/media?${query}`, publicMediaSchema);
};

export const uploadPublicMedia = (file: File, altText: string, category: string) =>
  request(`/media?${meta(file.name, altText, category)}`, publicMediaSchema, upload('/media', file));

export const replacePublicMedia = (
  id: string,
  file: File,
  altText: string,
  category: string,
) =>
  request(
    `/media/${id}?${meta(file.name, altText, category)}`,
    publicMediaSchema,
    upload(`/media/${id}`, file),
  );

export const updatePublicMedia = (
  id: string,
  body: { altText?: string; category?: string; status?: PublicMediaStatus },
): Promise<PublicMedia> => request(`/media/${id}`, publicMediaSchema, json('PATCH', body));

export const deletePublicMedia = (id: string) =>
  request(`/media/${id}?confirm=true`, deletePublicMediaSchema, { method: 'DELETE' });
