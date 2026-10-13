import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Button, EmptyState, ErrorState, FileField, PageHeader, Skeleton, TextField } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { deleteCmsMedia, getCmsMedia, uploadCmsMedia } from './services';
import styles from './cms.module.css';

export function CmsMediaPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const media = useQuery({ queryKey: ['cms', 'media'], queryFn: getCmsMedia });
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const canCreate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.media' && p.canCreate) === true;
  const canDelete =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.media' && p.canDelete) === true;
  const upload = useBusinessMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file.');
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      return uploadCmsMedia({
        name: file.name,
        mimeType: file.type,
        altText: alt,
        category: 'general',
        dataBase64,
      });
    },
    onSuccess: async () => {
      setFile(null);
      setAlt('');
      setMessage('Media uploaded.');
      await client.invalidateQueries({ queryKey: ['cms', 'media'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Upload failed.'),
  });
  const remove = useBusinessMutation({
    mutationFn: deleteCmsMedia,
    onSuccess: () => client.invalidateQueries({ queryKey: ['cms', 'media'] }),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Delete failed.'),
  });
  if (media.isLoading)
    return (
      <div
        style={{ display: 'grid', gap: 'var(--space-3)' }}
        role="status"
        aria-label="Loading media"
      >
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
      </div>
    );
  if (media.isError)
    return (
      <ErrorState
        title="Media could not be loaded"
        error={media.error}
        onRetry={() => void media.refetch()}
      />
    );
  return (
    <>
      <PageHeader
        title="CMS Media"
        description="Validated public images and video uploaded through the authorized API."
      />
      {canCreate && (
        <section className={styles.panel}>
          <FileField
            id="cms-media-file"
            name="mediaFile"
            label="File"
            optional
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
            onSelect={setFile}
          />
          <TextField
            id="cms-media-alt"
            name="alt"
            label="Alternative text"
            optional
            value={alt}
            onChange={setAlt}
          />
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            Upload
          </Button>
          {message && <p role="status">{message}</p>}
        </section>
      )}
      {!media.data?.length ? (
        <EmptyState
          title="No CMS media"
          description="Repository assets remain available to the public website."
        />
      ) : (
        <div className={styles.grid}>
          {media.data.map((item) => (
            <article key={item.id} className={styles.card}>
              {item.mediaType === 'image' ? (
                <img src={item.publicUrl} alt={item.altText} />
              ) : (
                <video src={item.publicUrl} controls />
              )}
              <strong>{item.name}</strong>
              <small>
                {item.mimeType} · {Math.ceil(item.sizeBytes / 1024)} KB
              </small>
              {canDelete && (
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  Delete
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
