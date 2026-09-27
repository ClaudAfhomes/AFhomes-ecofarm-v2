import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader } from '@jad/ui';
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
  const upload = useMutation({
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
  const remove = useMutation({
    mutationFn: deleteCmsMedia,
    onSuccess: () => client.invalidateQueries({ queryKey: ['cms', 'media'] }),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Delete failed.'),
  });
  if (media.isLoading) return <p role="status">Loading media…</p>;
  if (media.isError) return <ErrorState title="Media could not be loaded" />;
  return (
    <>
      <PageHeader
        title="CMS Media"
        description="Validated public images and video uploaded through the authorized API."
      />
      {canCreate && (
        <section className={styles.panel}>
          <label>
            File
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Alternative text
            <input value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
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
                  variant="secondary"
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
