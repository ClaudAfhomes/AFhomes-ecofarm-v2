import { useEffect, useRef, useState } from 'react';

import { Button, Dialog, Icon, notifyError, notifySuccess } from '@jad/ui';
import type { ContentKind, ForwardableContent } from '@jad/contracts';

import { useUpdateContent } from '../hooks/useUpdateContent';
import {
  KIND_ACCEPT,
  KIND_MAX_SIZE,
  formatBytes,
  matchesAccept,
  uploadContentFile,
} from '../services/uploads';
import styles from '../pages/ContentPage.module.css';

/**
 * Edit dialog for a marketing tool (FR-ADM-003): title, description, type,
 * and optional file replacement (uploaded via the same signed-URL flow as
 * create; the server swaps the download URL and removes the superseded
 * bucket object). Shared by the list and detail pages.
 */
export function ContentEditDialog({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: ForwardableContent | null;
  onClose: () => void;
}) {
  const updateContent = useUpdateContent();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ContentKind>('DOCUMENT');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [removeMarked, setRemoveMarked] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local preview URL for the newly selected replacement file. Revoked
  // whenever the selection changes, the dialog closes, or unmounts.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const setPreview = (url: string | null) => {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  const clearPreview = () => setPreview(null);

  useEffect(() => {
    if (open && item) {
      setTitle(item.title);
      setDescription(item.description ?? '');
      setKind(item.kind);
      setFile(null);
      setFileError(undefined);
      setRemoveMarked(false);
      setSaving(false);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  useEffect(
    () => () => {
      if (
        previewUrlRef.current &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  if (!item) return null;
  const current: ForwardableContent = item;

  const accept = KIND_ACCEPT[kind];
  const titleChanged = title.trim() !== current.title;
  const descriptionChanged = (description.trim() || '') !== (current.description ?? '');
  const kindChanged = kind !== current.kind;
  const fileChange = file !== null || (removeMarked && current.downloadUrl !== undefined);
  const dirty = titleChanged || descriptionChanged || kindChanged || fileChange;
  const canSave = dirty && title.trim().length > 0 && !saving;

  const markRemove = () => {
    setRemoveMarked(true);
    setFile(null);
    setFileError(undefined);
    clearPreview();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearSelection = () => {
    setFile(null);
    setFileError(undefined);
    clearPreview();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])[0];
    setFileError(undefined);
    if (!selected) {
      setFile(null);
      return;
    }
    if (accept !== '*/*' && !matchesAccept(selected, accept)) {
      setFileError(`"${selected.name}" is not a supported ${kind.toLowerCase()} file.`);
      setFile(null);
      clearPreview();
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (selected.size > KIND_MAX_SIZE[kind]) {
      setFileError(`"${selected.name}" must be ${formatBytes(KIND_MAX_SIZE[kind])} or less.`);
      setFile(null);
      clearPreview();
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setRemoveMarked(false);
    setFile(selected);
    if (
      selected.type.toLowerCase().startsWith('image/') &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      setPreview(URL.createObjectURL(selected));
    } else {
      clearPreview();
    }
  };

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setFileError(undefined);
    try {
      let downloadUrl: string | null | undefined;
      if (file) {
        const uploaded = await uploadContentFile(file, kind);
        if ('error' in uploaded) {
          setFileError(uploaded.error);
          setSaving(false);
          return;
        }
        downloadUrl = uploaded.downloadUrl;
      } else if (removeMarked) {
        downloadUrl = null;
      }
      await updateContent.mutateAsync({
        id: current.id,
        patch: {
          ...(titleChanged && { title: title.trim() }),
          ...(descriptionChanged && { description: description.trim() }),
          ...(kindChanged && { kind }),
          ...(downloadUrl !== undefined && { downloadUrl }),
        },
      });
      notifySuccess({
        title: 'Marketing tool updated',
        message: `"${title.trim()}" was saved${
          typeof downloadUrl === 'string'
            ? ', including its replacement file'
            : downloadUrl === null
              ? ', file removed'
              : ''
        }.`,
      });
      onClose();
    } catch (e) {
      notifyError({ title: 'Update failed', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Edit ${current.title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            Save
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="JA&D Project Showcase"
            className={styles.input}
            aria-label="Title"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="High-resolution image for social posts"
            className={styles.textarea}
            aria-label="Description"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ContentKind)}
            className={styles.select}
            aria-label="Type"
          >
            <option value="DOCUMENT">Document</option>
            <option value="IMAGE">Image</option>
            <option value="VIDEO">Video</option>
            <option value="PROMO">Promo</option>
          </select>
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>File</span>
          {file && previewUrl ? (
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <img
                src={previewUrl}
                alt={`Preview of ${file.name}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: 160,
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
                New file preview - Save to replace the current file.
              </span>
            </div>
          ) : current.downloadUrl && !removeMarked ? (
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              {current.kind === 'IMAGE' ? (
                <img
                  src={current.downloadUrl}
                  alt={current.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 160,
                    objectFit: 'contain',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              ) : null}
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
                Current file:{' '}
                <a href={current.downloadUrl} target="_blank" rel="noopener noreferrer">
                  {current.downloadUrl.split('/').pop() ?? current.downloadUrl}
                </a>
              </span>
              <span>
                <Button variant="danger" onClick={markRemove} disabled={saving}>
                  Remove file
                </Button>
              </span>
            </div>
          ) : removeMarked ? (
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-body-s)' }}>
                File marked for removal - Save to confirm.
              </span>
              <span>
                <Button
                  variant="secondary"
                  onClick={() => setRemoveMarked(false)}
                  disabled={saving}
                >
                  Undo remove
                </Button>
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              No file attached - upload one below to add it.
            </span>
          )}
          <label className={styles.fileDropzone}>
            <Icon name="download" size={20} className={styles.fileDropzoneIcon} />
            <span className={styles.fileHint}>
              {current.downloadUrl && !removeMarked
                ? 'Click to browse or drag a replacement file here'
                : 'Click to browse or drag a file here'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFileChange}
              className={styles.fileInput}
              aria-label="Replacement file"
            />
          </label>
          {file ? (
            <ul className={styles.fileList} aria-live="polite">
              <li className={styles.fileItem}>
                <span className={styles.fileItemName}>{file.name}</span>
                <span className={styles.fileItemSize}>{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className={styles.fileItemRemove}
                  aria-label={`Remove ${file.name}`}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            </ul>
          ) : null}
          {fileError ? (
            <div className={styles.fileErrors}>
              <span className={styles.fileError}>{fileError}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
