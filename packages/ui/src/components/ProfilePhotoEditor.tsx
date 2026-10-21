import { useId, useRef, useState } from 'react';
import type { ProfilePhoto } from '@afhomes/contracts';
import { Button } from './Button.js';
import { profilePhotoBase64 } from './compress-profile-photo.js';
import styles from './ProfilePhotoEditor.module.css';

export function ProfilePhotoEditor({
  photo,
  loading,
  error,
  onRefresh,
  onUpload,
  staged = false,
}: {
  photo?: ProfilePhoto;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onUpload: (dataBase64: string) => Promise<unknown>;
  staged?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const choose = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      await onUpload(await profilePhotoBase64(file));
      setMessage(
        staged
          ? 'Profile photo selected. It will be saved when the account is created.'
          : 'Profile photo saved.',
      );
    } catch (cause) {
      setFailed(true);
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Could not save your photo. Refresh to check before retrying.',
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const imageUrl = photo?.url;
  return (
    <section className={styles.card} aria-label="Profile photo" aria-busy={loading || busy}>
      <h2>Profile photo</h2>
      {imageUrl && imageUrl !== failedUrl ? (
        <img
          className={styles.photo}
          src={imageUrl}
          alt={staged ? 'Selected profile photo' : 'Your profile'}
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <div className={styles.placeholder}>No photo preview</div>
      )}
      <p id={`${id}-help`}>
        Photos are automatically compressed to 0.5 MB or less.{' '}
        {staged
          ? 'Choose a photo before creating the account.'
          : 'Replacing a photo overwrites the previous image.'}
      </p>
      {loading ? <p role="status">Loading profile photo...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {photo?.notice ? <p role="status">{photo.notice}</p> : null}
      {!loading && photo && !photo.canUpload ? (
        <p>Complete account verification before changing your photo.</p>
      ) : null}
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose profile photo"
        aria-required={staged || undefined}
        aria-describedby={`${id}-help`}
        disabled={loading || busy || !photo?.canUpload || !!error}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      {busy ? (
        <p role="status">{staged ? 'Preparing photo...' : 'Compressing and saving photo...'}</p>
      ) : null}
      {message ? <p role={failed ? 'alert' : 'status'}>{message}</p> : null}
      {!staged ? (
        <Button
          variant="secondary"
          disabled={loading || busy}
          onClick={() => {
            setFailedUrl(null);
            onRefresh();
          }}
        >
          Refresh photo
        </Button>
      ) : null}
    </section>
  );
}
