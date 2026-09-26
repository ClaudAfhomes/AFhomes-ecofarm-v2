import { useRef, useState } from 'react';

import { Button, Dialog, Icon, notifyError, notifySuccess } from '@jad/ui';

import { useCreatePolicy } from '../hooks/useCreatePolicy';
import {
  POLICY_PDF_ACCEPT,
  POLICY_PDF_MAX_SIZE,
  formatBytes,
  isPolicyPdf,
  uploadPolicyPdf,
} from '../services/uploads';
import { isValidPolicySlug, slugifyPolicyTitle } from '../slug';
import styles from '../pages/PoliciesPage.module.css';

/**
 * Create dialog for an admin policy (FR-ADM-004): title, type, optional
 * plain-text summary, and the required PDF. The PDF uploads through the
 * DOCUMENT signed-URL flow (`POST /cms/upload/sign` + direct PUT) before the
 * `POST /policies` create carries its `documentUrl`.
 */
const KNOWN_TYPES = ['terms', 'privacy', 'guidelines'];

export function PolicyFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createPolicy = useCreatePolicy();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle('');
    setSlug('');
    setSlugTouched(false);
    setType('');
    setContent('');
    setFile(null);
    setFileError(undefined);
    setSaving(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const slugValid = isValidPolicySlug(slug);
  const canSave =
    title.trim().length > 0 && type.trim().length > 0 && slugValid && file !== null && !saving;

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
    if (!canSave || !file) return;
    setSaving(true);
    setFileError(undefined);
    const uploaded = await uploadPolicyPdf(file);
    if ('error' in uploaded) {
      setFileError(uploaded.error);
      setSaving(false);
      return;
    }
    try {
      await createPolicy.mutateAsync({
        title: title.trim(),
        slug: slug.trim(),
        type: type.trim(),
        ...(content.trim() && { content: content.trim() }),
        documentUrl: uploaded.documentUrl,
      });
      notifySuccess({
        title: 'Policy published',
        message: `"${title.trim()}" is now live.`,
      });
      reset();
      onClose();
    } catch (e) {
      notifyError({ title: 'Publish failed', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) {
          reset();
          onClose();
        }
      }}
      title="New Policy"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            Publish
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugifyPolicyTitle(e.target.value));
            }}
            placeholder="Terms and Conditions"
            className={styles.input}
            aria-label="Title"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>URL slug</span>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="terms"
            className={styles.input}
            aria-label="URL slug"
            aria-invalid={slug.length > 0 && !slugValid ? true : undefined}
          />
          <span className={styles.fileHint}>
            Public link: /policies/{slug.trim() || 'slug'}
            {slug.length > 0 && !slugValid ? ' - use lowercase letters, numbers, and hyphens.' : ''}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            value={KNOWN_TYPES.includes(type) ? type : ''}
            onChange={(e) => {
              const next = e.target.value;
              setType(next);
              // Only seed the slug from the type when it is still empty;
              // never clobber a title-derived slug.
              if (next && !slug.trim()) setSlug(next);
            }}
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
          <span className={styles.fieldLabel}>PDF (required)</span>
          <label className={styles.fileDropzone}>
            <Icon name="file-text" size={20} className={styles.fileDropzoneIcon} />
            <span className={styles.fileHint}>Click to browse or drag the PDF here</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={POLICY_PDF_ACCEPT}
              onChange={handleFileChange}
              className={styles.fileInput}
              aria-label="Policy PDF"
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
