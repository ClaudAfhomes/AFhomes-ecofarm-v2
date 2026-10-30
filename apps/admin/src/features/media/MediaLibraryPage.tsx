import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  FileField,
  PageHeader,
  Skeleton,
  TextField,
  notifyConfirm,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useSession } from '../../lib/session';
import { deletePublicMedia, getPublicMedia, replacePublicMedia, updatePublicMedia, uploadPublicMedia } from './services';
import styles from '../cms/cms.module.css';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export function MediaLibraryPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const debouncedCategory = useDebouncedValue(category.trim(), 300);
  const media = useQuery({
    queryKey: ['media', debouncedSearch, debouncedCategory],
    queryFn: () => getPublicMedia({ search: debouncedSearch, category: debouncedCategory }),
    placeholderData: keepPreviousData,
  });
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [fileCategory, setFileCategory] = useState('general');
  const [replaceId, setReplaceId] = useState<string | null>(null);

  const canCreate = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'cms.media' && permission.canCreate,
  );
  const canUpdate = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'cms.media' && permission.canUpdate,
  );
  const canDelete = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'cms.media' && permission.canDelete,
  );

  const upload = useBusinessMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file.');
      return replaceId
        ? replacePublicMedia(replaceId, file, alt, fileCategory)
        : uploadPublicMedia(file, alt, fileCategory);
    },
    onSuccess: async () => {
      setFile(null);
      setAlt('');
      setFileCategory('general');
      setReplaceId(null);
      notifySuccess({ title: replaceId ? 'Media replaced' : 'Media uploaded' });
      await client.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) =>
      notifyError({ title: 'Upload failed', message: error instanceof Error ? error.message : 'Try again.' }),
  });

  const unpublish = useBusinessMutation({
    mutationFn: (id: string) => updatePublicMedia(id, { status: 'unpublished' }),
    onSuccess: async () => {
      notifySuccess({ title: 'Media unpublished' });
      await client.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) =>
      notifyError({ title: 'Could not unpublish', message: error instanceof Error ? error.message : 'Try again.' }),
  });

  const remove = useBusinessMutation({
    mutationFn: deletePublicMedia,
    onSuccess: async () => {
      notifySuccess({ title: 'Media deleted' });
      await client.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) =>
      notifyError({ title: 'Could not delete', message: error instanceof Error ? error.message : 'Try again.' }),
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notifySuccess({ title: 'URL copied' });
    } catch {
      notifyError({ title: 'Could not copy the URL' });
    }
  };

  const confirmUnpublish = async (id: string) => {
    if (
      await notifyConfirm({
        title: 'Unpublish this media?',
        message: 'The public file is removed. Upload again to publish it.',
        confirmButtonText: 'Unpublish',
      })
    )
      unpublish.mutate(id);
  };

  const confirmDelete = async (id: string) => {
    if (
      await notifyConfirm({
        title: 'Delete this media?',
        message: 'This removes the metadata and the public file.',
        confirmButtonText: 'Delete',
      })
    )
      remove.mutate(id);
  };

  if (media.isPending)
    return (
      <section className={styles.page} role="status" aria-label="Loading media">
        <Skeleton style={{ height: 32, maxWidth: 240 }} />
        <Skeleton style={{ height: 120 }} />
        <Skeleton style={{ height: 160 }} />
        <Skeleton style={{ height: 160 }} />
      </section>
    );

  if (media.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Media Library"
          description="Public images and documents for the AFHomes website."
        />
        <ErrorState
          title="Media could not be loaded"
          error={media.error}
          onRetry={() => void media.refetch()}
        />
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Media Library"
        description="Upload public images and PDFs. Private customer and payment files are not shown here."
      />
      {canCreate && (
        <section className={styles.panel}>
          {replaceId && (
            <p role="status">
              Replacing media. Choose the new file, then upload.{' '}
              <Button variant="ghost" onClick={() => setReplaceId(null)}>
                Cancel replace
              </Button>
            </p>
          )}
          <FileField
            id="media-file"
            name="mediaFile"
            label="File"
            optional
            accept={ACCEPT}
            status={file ? <small>{file.name}</small> : null}
            onSelect={setFile}
          />
          <TextField
            id="media-alt"
            name="mediaAlt"
            label="Alternative text"
            optional
            value={alt}
            onChange={setAlt}
          />
          <TextField
            id="media-category"
            name="mediaCategory"
            label="Category"
            value={fileCategory}
            onChange={setFileCategory}
          />
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {replaceId ? 'Replace media' : 'Upload media'}
          </Button>
        </section>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <TextField
          id="media-search"
          name="mediaSearch"
          label="Search"
          optional
          value={search}
          onChange={setSearch}
        />
        <TextField
          id="media-filter-category"
          name="mediaCategoryFilter"
          label="Filter by category"
          optional
          value={category}
          onChange={setCategory}
        />
      </div>
      {!media.data?.length ? (
        <EmptyState
          title="No public media"
          description="Upload a website image or an approved PDF to create a public URL."
        />
      ) : (
        <div className={styles.grid}>
          {media.data.map((item) => (
            <article key={item.id} className={styles.card}>
              {item.mediaType === 'image' && item.status === 'published' ? (
                <img src={item.publicUrl} alt={item.altText} />
              ) : item.mediaType === 'document' && item.status === 'published' ? (
                <a href={item.publicUrl} target="_blank" rel="noreferrer">
                  Open PDF
                </a>
              ) : (
                <span>Unpublished</span>
              )}
              <strong>{item.name}</strong>
              <small>
                {item.mimeType} · {formatCountOrDash(Math.ceil(item.sizeBytes / 1024))} KB ·{' '}
                {item.category} · {item.status}
              </small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <Button variant="ghost" onClick={() => void copy(item.publicUrl)}>
                  Copy URL
                </Button>
                {canUpdate && item.status === 'published' && (
                  <Button variant="ghost" onClick={() => void confirmUnpublish(item.id)}>
                    Unpublish
                  </Button>
                )}
                {canUpdate && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReplaceId(item.id);
                      setAlt(item.altText);
                      setFileCategory(item.category);
                      setFile(null);
                    }}
                  >
                    Replace
                  </Button>
                )}
                {canDelete && (
                  <Button variant="danger" onClick={() => void confirmDelete(item.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
