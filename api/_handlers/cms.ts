/** Phase 6 CMS API. Public reads expose published values only; all writes use AF Homes staff auth. */
import {
  cmsDocumentKeySchema,
  createCmsMediaSchema,
  createCmsPageSchema,
  updateCmsDocumentSchema,
  updateCmsPageSchema,
} from '@jad/contracts';
import { randomUUID } from 'node:crypto';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  jsonBody,
  list,
  method,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const DOCUMENT_SELECT =
  'key, draft_value, published_value, status, version, published_at, updated_at';
const PAGE_SELECT =
  'id, slug, title, status, seo, version, published_at, created_at, updated_at, cms_page_sections(id, block_type, content, sort_order, is_visible)';
const MEDIA_SELECT =
  'id, name, storage_path, public_url, mime_type, media_type, alt_text, category, size_bytes, created_at';

const documentPermission = (key: string): 'cms.pages' | 'cms.settings' =>
  key === 'site' ? 'cms.settings' : 'cms.pages';

const toDocument = (row: Record<string, unknown>) => ({
  key: row.key,
  draftValue: row.draft_value,
  publishedValue: row.published_value ?? null,
  status: row.status,
  version: Number(row.version),
  publishedAt: row.published_at ?? null,
  updatedAt: row.updated_at,
});

const toPage = (row: Record<string, unknown>) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  status: row.status,
  seo: row.seo ?? {},
  sections: ((row.cms_page_sections ?? []) as Record<string, unknown>[])
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .map((section) => ({
      id: section.id,
      blockType: section.block_type,
      content: section.content,
      sortOrder: Number(section.sort_order),
      isVisible: section.is_visible === true,
    })),
  version: Number(row.version),
  publishedAt: row.published_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMedia = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  storagePath: row.storage_path,
  publicUrl: row.public_url,
  mimeType: row.mime_type,
  mediaType: row.media_type,
  altText: row.alt_text,
  category: row.category,
  sizeBytes: Number(row.size_bytes),
  createdAt: row.created_at,
});

const extensionFor = (mime: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
  })[mime];

function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png')
    return bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]);
  if (mime === 'image/gif')
    return (
      Buffer.from(bytes.slice(0, 6))
        .toString('ascii')
        .match(/^GIF8[79]a$/) !== null
    );
  if (mime === 'image/webp')
    return (
      Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP'
    );
  if (mime === 'video/mp4') return Buffer.from(bytes.slice(4, 8)).toString('ascii') === 'ftyp';
  return false;
}

async function savePageSections(db: Db, pageId: string, sections: Array<Record<string, unknown>>) {
  const { error: deleteError } = await db.from('cms_page_sections').delete().eq('page_id', pageId);
  if (deleteError) throw deleteError;
  if (!sections.length) return;
  const { error } = await db.from('cms_page_sections').insert(
    sections.map((section) => ({
      id: section.id ?? randomUUID(),
      page_id: pageId,
      block_type: section.blockType,
      content: section.content,
      sort_order: section.sortOrder,
      is_visible: section.isVisible,
    })),
  );
  if (error) throw error;
}

async function pageSnapshot(
  db: Db,
  pageId: string,
  actorId: string,
  action: string,
  summary: string,
) {
  const { data: page, error } = await db
    .from('cms_pages')
    .select(PAGE_SELECT)
    .eq('id', pageId)
    .single();
  if (error) throw error;
  const dto = toPage(page);
  const { error: versionError } = await db.from('cms_page_versions').insert({
    page_id: pageId,
    slug: dto.slug,
    title: dto.title,
    status: dto.status,
    seo: dto.seo,
    sections: dto.sections,
    version: dto.version,
    action,
    change_summary: summary,
    created_by: actorId,
  });
  if (versionError) throw versionError;
  return dto;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const path = subPath(req);
  const verb = method(req);

  try {
    if (verb === 'GET' && path === 'public') {
      const { data, error } = await db
        .from('cms_documents')
        .select('key, published_value, updated_at')
        .eq('status', 'published');
      if (error) throw error;
      const documents = Object.fromEntries(
        (data ?? []).map((row: Record<string, unknown>) => [row.key, row.published_value]),
      );
      const revision =
        (data ?? [])
          .map((row: Record<string, unknown>) => String(row.updated_at))
          .sort()
          .at(-1) ?? 'static';
      return res.status(200).json({ documents, revision });
    }

    const publicPage = path.match(/^public\/pages\/([a-z0-9-]+)$/);
    if (verb === 'GET' && publicPage) {
      const { data, error } = await db
        .from('cms_pages')
        .select('published_snapshot')
        .eq('slug', publicPage[1])
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw error;
      if (!data?.published_snapshot) return fail(res, 'NOT_FOUND', 'Page not found', 404);
      const page = data.published_snapshot as ReturnType<typeof toPage>;
      return res
        .status(200)
        .json({ ...page, sections: page.sections.filter((section) => section.isVisible) });
    }

    if (verb === 'GET' && path === 'documents') {
      let auth = await authorizeAfHomes(req, 'cms.pages', 'view');
      if ('error' in auth) auth = await authorizeAfHomes(req, 'cms.settings', 'view');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db.from('cms_documents').select(DOCUMENT_SELECT).order('key');
      if (error) throw error;
      return list(res, (data ?? []).map(toDocument));
    }

    const documentMatch = path.match(/^documents\/([^/]+)$/);
    if (documentMatch && (verb === 'PUT' || verb === 'PATCH')) {
      const key = cmsDocumentKeySchema.safeParse(documentMatch[1]);
      const parsed = updateCmsDocumentSchema.safeParse(jsonBody(req));
      if (!key.success || !parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Check the content and version.', 400);
      const auth = await authorizeAfHomes(req, documentPermission(key.data), 'update');
      if ('error' in auth) return deny(res, auth);
      const existing = await db
        .from('cms_documents')
        .select(DOCUMENT_SELECT)
        .eq('key', key.data)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) {
        if (parsed.data.expectedVersion !== 1)
          return fail(res, 'CONFLICT', 'This content changed. Reload and try again.', 409);
        const { data, error } = await db
          .from('cms_documents')
          .insert({
            key: key.data,
            draft_value: parsed.data.value,
            version: 1,
            created_by: auth.userId,
            updated_by: auth.userId,
          })
          .select(DOCUMENT_SELECT)
          .single();
        if (error) throw error;
        const versionWrite = await db
          .from('cms_document_versions')
          .insert({
            document_key: key.data,
            value: parsed.data.value,
            version: 1,
            action: 'created',
            change_summary: parsed.data.changeSummary,
            created_by: auth.userId,
          });
        if (versionWrite.error) throw versionWrite.error;
        await audit(db, auth.userId, 'CMS_DOCUMENT_CREATED', 'cms_document', key.data, undefined, {
          version: 1,
        });
        return res.status(201).json(toDocument(data));
      }
      if (Number(existing.data.version) !== parsed.data.expectedVersion)
        return fail(res, 'CONFLICT', 'This content changed. Reload and try again.', 409);
      const nextVersion = parsed.data.expectedVersion + 1;
      const { data, error } = await db
        .from('cms_documents')
        .update({
          draft_value: parsed.data.value,
          version: nextVersion,
          updated_by: auth.userId,
          updated_at: new Date().toISOString(),
        })
        .eq('key', key.data)
        .eq('version', parsed.data.expectedVersion)
        .select(DOCUMENT_SELECT)
        .single();
      if (error) throw error;
      const versionWrite = await db
        .from('cms_document_versions')
        .insert({
          document_key: key.data,
          value: parsed.data.value,
          version: nextVersion,
          action: 'updated',
          change_summary: parsed.data.changeSummary,
          created_by: auth.userId,
        });
      if (versionWrite.error) throw versionWrite.error;
      await audit(
        db,
        auth.userId,
        'CMS_DOCUMENT_UPDATED',
        'cms_document',
        key.data,
        { version: parsed.data.expectedVersion },
        { version: nextVersion },
      );
      return res.status(200).json(toDocument(data));
    }

    const publishDocument = path.match(/^documents\/([^/]+)\/(publish|unpublish)$/);
    if (verb === 'POST' && publishDocument) {
      const key = cmsDocumentKeySchema.safeParse(publishDocument[1]);
      if (!key.success) return fail(res, 'VALIDATION_ERROR', 'Unknown content document.', 400);
      const auth = await authorizeAfHomes(req, documentPermission(key.data), 'update');
      if ('error' in auth) return deny(res, auth);
      const publishing = publishDocument[2] === 'publish';
      const now = new Date().toISOString();
      const current = await db
        .from('cms_documents')
        .select(DOCUMENT_SELECT)
        .eq('key', key.data)
        .single();
      if (current.error) throw current.error;
      const nextVersion = Number(current.data.version) + 1;
      const patch: Record<string, unknown> = publishing
        ? {
            status: 'published',
            published_value: current.data.draft_value,
            published_by: auth.userId,
            published_at: now,
            updated_by: auth.userId,
            updated_at: now,
            version: nextVersion,
          }
        : { status: 'draft', updated_by: auth.userId, updated_at: now, version: nextVersion };
      const { data, error } = await db
        .from('cms_documents')
        .update(patch)
        .eq('key', key.data)
        .select(DOCUMENT_SELECT)
        .single();
      if (error) throw error;
      const versionWrite = await db
        .from('cms_document_versions')
        .insert({
          document_key: key.data,
          value: current.data.draft_value,
          version: nextVersion,
          action: publishing ? 'published' : 'unpublished',
          change_summary: publishing ? 'Published document.' : 'Unpublished document.',
          created_by: auth.userId,
        });
      if (versionWrite.error) throw versionWrite.error;
      await audit(
        db,
        auth.userId,
        publishing ? 'CMS_DOCUMENT_PUBLISHED' : 'CMS_DOCUMENT_UNPUBLISHED',
        'cms_document',
        key.data,
        { version: current.data.version },
        { version: data.version },
      );
      return res.status(200).json(toDocument(data));
    }

    if (verb === 'GET' && path === 'pages') {
      const auth = await authorizeAfHomes(req, 'cms.pages', 'view');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('cms_pages')
        .select(PAGE_SELECT)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return list(res, (data ?? []).map(toPage));
    }

    if (verb === 'POST' && path === 'pages') {
      const auth = await authorizeAfHomes(req, 'cms.pages', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createCmsPageSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the page details.', 400);
      const { data, error } = await db
        .from('cms_pages')
        .insert({
          slug: parsed.data.slug,
          title: parsed.data.title,
          seo: parsed.data.seo,
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .select('id')
        .single();
      if (error) throw error;
      await savePageSections(db, data.id, parsed.data.sections);
      const page = await pageSnapshot(
        db,
        data.id,
        auth.userId,
        'created',
        parsed.data.changeSummary,
      );
      await audit(db, auth.userId, 'CMS_PAGE_CREATED', 'cms_page', data.id, undefined, {
        slug: parsed.data.slug,
      });
      return res.status(201).json(page);
    }

    const pageMatch = path.match(/^pages\/([0-9a-f-]+)$/);
    if (pageMatch && (verb === 'PATCH' || verb === 'PUT')) {
      const auth = await authorizeAfHomes(req, 'cms.pages', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = updateCmsPageSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the page details.', 400);
      const existing = await db
        .from('cms_pages')
        .select('id, version')
        .eq('id', pageMatch[1])
        .single();
      if (existing.error) throw existing.error;
      if (Number(existing.data.version) !== parsed.data.expectedVersion)
        return fail(res, 'CONFLICT', 'This page changed. Reload and try again.', 409);
      const patch: Record<string, unknown> = {
        version: parsed.data.expectedVersion + 1,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      };
      if (parsed.data.slug !== undefined) patch.slug = parsed.data.slug;
      if (parsed.data.title !== undefined) patch.title = parsed.data.title;
      if (parsed.data.seo !== undefined) patch.seo = parsed.data.seo;
      const updated = await db
        .from('cms_pages')
        .update(patch)
        .eq('id', pageMatch[1])
        .eq('version', parsed.data.expectedVersion)
        .select('id')
        .single();
      if (updated.error) throw updated.error;
      if (parsed.data.sections !== undefined)
        await savePageSections(db, pageMatch[1]!, parsed.data.sections);
      const page = await pageSnapshot(
        db,
        pageMatch[1]!,
        auth.userId,
        'updated',
        parsed.data.changeSummary,
      );
      await audit(
        db,
        auth.userId,
        'CMS_PAGE_UPDATED',
        'cms_page',
        pageMatch[1]!,
        { version: parsed.data.expectedVersion },
        { version: page.version },
      );
      return res.status(200).json(page);
    }

    const publishPage = path.match(/^pages\/([0-9a-f-]+)\/(publish|unpublish)$/);
    if (verb === 'POST' && publishPage) {
      const auth = await authorizeAfHomes(req, 'cms.pages', 'update');
      if ('error' in auth) return deny(res, auth);
      const publishing = publishPage[2] === 'publish';
      const now = new Date().toISOString();
      const existing = await db
        .from('cms_pages')
        .select(PAGE_SELECT)
        .eq('id', publishPage[1])
        .single();
      if (existing.error) throw existing.error;
      const nextVersion = Number(existing.data.version) + 1;
      const publishedSnapshot = {
        ...toPage(existing.data),
        status: 'published',
        version: nextVersion,
        publishedAt: now,
        updatedAt: now,
      };
      const { data, error } = await db
        .from('cms_pages')
        .update(
          publishing
            ? {
                status: 'published',
                published_snapshot: publishedSnapshot,
                published_by: auth.userId,
                published_at: now,
                updated_by: auth.userId,
                updated_at: now,
                version: nextVersion,
              }
            : { status: 'draft', updated_by: auth.userId, updated_at: now, version: nextVersion },
        )
        .eq('id', publishPage[1])
        .eq('version', existing.data.version)
        .select('id, version')
        .single();
      if (error) throw error;
      const page = await pageSnapshot(
        db,
        data.id,
        auth.userId,
        publishing ? 'published' : 'unpublished',
        publishing ? 'Published page.' : 'Unpublished page.',
      );
      await audit(
        db,
        auth.userId,
        publishing ? 'CMS_PAGE_PUBLISHED' : 'CMS_PAGE_UNPUBLISHED',
        'cms_page',
        data.id,
        undefined,
        { version: data.version },
      );
      return res.status(200).json(page);
    }

    if (verb === 'GET' && path === 'media') {
      const auth = await authorizeAfHomes(req, 'cms.media', 'view');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('cms_media_assets')
        .select(MEDIA_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return list(res, (data ?? []).map(toMedia));
    }

    if (verb === 'POST' && path === 'media') {
      const auth = await authorizeAfHomes(req, 'cms.media', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createCmsMediaSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the media details.', 400);
      const bytes = Buffer.from(parsed.data.dataBase64, 'base64');
      if (
        !bytes.length ||
        bytes.length > 10 * 1024 * 1024 ||
        !signatureMatches(parsed.data.mimeType, bytes)
      )
        return fail(res, 'VALIDATION_ERROR', 'The media file is invalid or too large.', 400);
      const id = randomUUID();
      const storagePath = `${auth.userId}/${id}.${extensionFor(parsed.data.mimeType)}`;
      const storage = db.storage.from('afhomes-cms-media');
      const uploaded = await storage.upload(storagePath, bytes, {
        contentType: parsed.data.mimeType,
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
      const publicUrl = storage.getPublicUrl(storagePath).data.publicUrl;
      const { data, error } = await db
        .from('cms_media_assets')
        .insert({
          id,
          storage_path: storagePath,
          public_url: publicUrl,
          name: parsed.data.name,
          mime_type: parsed.data.mimeType,
          media_type: parsed.data.mimeType.startsWith('video/') ? 'video' : 'image',
          alt_text: parsed.data.altText,
          category: parsed.data.category,
          size_bytes: bytes.length,
          created_by: auth.userId,
        })
        .select(MEDIA_SELECT)
        .single();
      if (error) {
        await storage.remove([storagePath]);
        throw error;
      }
      await audit(db, auth.userId, 'CMS_MEDIA_UPLOADED', 'cms_media', id, undefined, {
        name: parsed.data.name,
        mimeType: parsed.data.mimeType,
        sizeBytes: bytes.length,
      });
      return res.status(201).json(toMedia(data));
    }

    const mediaMatch = path.match(/^media\/([0-9a-f-]+)$/);
    if (verb === 'DELETE' && mediaMatch) {
      const auth = await authorizeAfHomes(req, 'cms.media', 'delete');
      if ('error' in auth) return deny(res, auth);
      const current = await db
        .from('cms_media_assets')
        .select(MEDIA_SELECT)
        .eq('id', mediaMatch[1])
        .single();
      if (current.error) throw current.error;
      const url = String(current.data.public_url);
      const [documents, sections] = await Promise.all([
        db.from('cms_documents').select('draft_value, published_value'),
        db.from('cms_page_sections').select('content'),
      ]);
      const referenced = [...(documents.data ?? []), ...(sections.data ?? [])].some((row) =>
        JSON.stringify(row).includes(url),
      );
      if (referenced)
        return fail(
          res,
          'CONFLICT',
          'This media is referenced by CMS content and cannot be deleted.',
          409,
        );
      const removed = await db.storage
        .from('afhomes-cms-media')
        .remove([current.data.storage_path]);
      if (removed.error) throw removed.error;
      const deleted = await db.from('cms_media_assets').delete().eq('id', mediaMatch[1]);
      if (deleted.error) throw deleted.error;
      await audit(db, auth.userId, 'CMS_MEDIA_DELETED', 'cms_media', mediaMatch[1]!, current.data);
      return res.status(200).json(toMedia(current.data));
    }

    if (verb === 'GET' && path === 'history') {
      const auth = await authorizeAfHomes(req, 'cms.history', 'view');
      if ('error' in auth) return deny(res, auth);
      const [documents, pages] = await Promise.all([
        db
          .from('cms_document_versions')
          .select(
            'id, document_key, action, change_summary, version, created_by, created_at, staff_users!inner(full_name)',
          )
          .order('created_at', { ascending: false })
          .limit(100),
        db
          .from('cms_page_versions')
          .select(
            'id, page_id, action, change_summary, version, created_by, created_at, staff_users!inner(full_name)',
          )
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (documents.error) throw documents.error;
      if (pages.error) throw pages.error;
      const rows = [
        ...(documents.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          entity_type: 'document',
          entity_id: row.document_key,
        })),
        ...(pages.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          entity_type: 'page',
          entity_id: row.page_id,
        })),
      ]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 100);
      return list(
        res,
        rows.map((row) => ({
          id: `${row.entity_type}-${row.id}`,
          entityType: row.entity_type,
          entityId: row.entity_id,
          action: row.action,
          changeSummary: row.change_summary,
          version: Number(row.version),
          authorId: row.created_by,
          authorName: String(
            (row.staff_users as Record<string, unknown>)?.full_name ?? 'Unknown staff',
          ),
          createdAt: row.created_at,
        })),
      );
    }

    return fail(res, 'NOT_FOUND', 'CMS route not found', 404);
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? '');
    if (/duplicate key|unique constraint/i.test(message))
      return fail(res, 'CONFLICT', 'That slug or media path already exists.', 409);
    console.error('[cms] request failed:', message);
    return fail(res, 'INTERNAL', 'CMS request failed', 500);
  }
}
