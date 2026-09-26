import { useEffect, useRef, useState } from 'react';

import { Button, Dialog, Icon, notifyError, notifySuccess } from '@jad/ui';
import type { Policy } from '@jad/contracts';

import { useUpdatePolicy } from '../hooks/useUpdatePolicy';
import {
  POLICY_PDF_ACCEPT,
  POLICY_PDF_MAX_SIZE,
  formatBytes,
  isPolicyPdf,
  uploadPolicyPdf,
} from '../services/uploads';
import { isValidPolicySlug } from '../slug';
import styles from '../pages/PoliciesPage.module.css';

/**
 * Edit dialog for an admin policy (FR-ADM-004): title, type, optional
 * summary, and optional PDF replacement (uploaded through the same
 * DOCUMENT signed-URL flow as create). The stored PDF can never be unset -
 * replacement only - so every policy keeps its required document.
 */
const KNOWN_TYPES = ['terms', 'privacy', 'guidelines'];

export function PolicyEditDialog({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: Policy | null;
  onClose: () => void;
}) {
  const updatePolicy = useUpdatePolicy();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && item) {
      setTitle(item.title);
      setSlug(item.slug);
      setType(item.type);
      setContent(item.content ?? '');
      setFile(null);
      setFileError(undefined);
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  if (!item) return null;
  const current: Policy = item;

  const titleChanged = title.trim() !== current.title;
  const slugChanged = slug.trim() !== current.slug;
  const typeChanged = type.trim() !== current.type;
  const contentChanged = (content.trim() || '') !== (current.content ?? '');
  const dirty = titleChanged || slugChanged || typeChanged || contentChanged || file !== null;
  const canSave =
    dirty &&
    title.trim().length > 0 &&
    type.trim().length > 0 &&
    isValidPolicySlug(slug) &&
    !saving;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])[0];
    setFileError(undefined);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!isPolicyPdf(selected)) {
      setFileError(`"${selected.name}" must be a PDF file.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (selected.size > POLICY_PDF_MAX_SIZE) {
      setFileError(`"${selected.name}" must be ${formatBytes(POLICY_PDF_MAX_SIZE)} or less.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFile(selected);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFileError(undefined);
    try {
      let documentUrl: string | undefined;
      if (file) {
        const uploaded = await uploadPolicyPdf(file);
        if ('error' in uploaded) {
          setFileError(uploaded.error);
          setSaving(false);
          return;
        }
        documentUrl = uploaded.documentUrl;
      }
      await updatePolicy.mutateAsync({
        id: current.id,
        patch: {
          ...(titleChanged && { title: title.trim() }),
          ...(slugChanged && { slug: slug.trim() }),
          ...(typeChanged && { type: type.trim() }),
          ...(contentChanged && { content: content.trim() }),
          ...(documentUrl !== undefined && { documentUrl }),
        },
      });
      notifySuccess({
        title: 'Policy updated',
        message: `"${title.trim()}" was saved${documentUrl ? ', including its replacement PDF' : ''}.`,
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
            placeholder="Terms and Conditions"
            className={styles.input}
            aria-label="Title"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>URL slug</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="terms"
            className={styles.input}
            aria-label="URL slug"
            aria-invalid={!isValidPolicySlug(slug) ? true : undefined}
          />
          <span className={styles.fileHint}>
            Public link: /policies/{slug.trim() || 'slug'}
            {!isValidPolicySlug(slug) ? ' - use lowercase letters, numbers, and hyphens.' : ''}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            value={KNOWN_TYPES.includes(type) ? type : ''}
            onChange={(e) => setType(e.target.value)}
            className={styles.input}
            aria-label="Type"
          >
            <option value="" disabled>
              Select a type
            </option>
            {KNOWN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Summary (optional)</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Plain-text summary shown until the PDF is opened"
            className={styles.textarea}
            aria-label="Summary"
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>PDF</span>
          {current.documentUrl ? (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Current PDF:{' '}
              <a href={current.documentUrl} target="_blank" rel="noopener noreferrer">
                {current.documentUrl.split('/').pop() ?? current.documentUrl}
              </a>
            </span>
          ) : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              No PDF attached - upload one below to add it.
            </span>
          )}
          <label className={styles.fileDropzone}>
            <Icon name="file-text" size={20} className={styles.fileDropzoneIcon} />
            <span className={styles.fileHint}>Click to browse or drag a replacement PDF here</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={POLICY_PDF_ACCEPT}
              onChange={handleFileChange}
              className={styles.fileInput}
              aria-label="Replacement PDF"
            />
          </label>
          {file ? (
            <ul className={styles.fileList} aria-live="polite">
              <li className={styles.fileItem}>
                <span className={styles.fileItemName}>{file.name}</span>
                <span className={styles.fileItemSize}>{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className={styles.fileItemRemove}
                  aria-label={`Remove ${file.name}`}
                  disabled={saving}
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
