import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import type { ContentKind } from '@jad/contracts';

import { useContent } from '../hooks/useContent';
import { useDeleteContent } from '../hooks/useDeleteContent';
import { ContentEditDialog } from '../components/ContentEditDialog';
import { CONTENT_KIND_LABEL, CONTENT_KIND_TONE } from '../status';
import { formatDate } from '../../../lib/format';
import styles from './MarketingToolDetailPage.module.css';

const KIND_ICON: Record<ContentKind, 'file-text' | 'image' | 'video' | 'grid'> = {
  DOCUMENT: 'file-text',
  IMAGE: 'image',
  VIDEO: 'video',
  PROMO: 'grid',
};

function isPdfUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, 'http://mock.local');
    return u.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}

/** Marketing Tool Detail - read-only view of a single forwardable content item. */
export function MarketingToolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useContent();
  const deleteContent = useDeleteContent();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const item = data?.find((c) => c.id === id);

  const handleDelete = async () => {
    if (!item) return;
    try {
      const result = await deleteContent.mutateAsync(item.id);
      notifySuccess({
        title: 'Marketing tool deleted',
        message: result.fileRemoved
          ? `"${item.title}" was permanently removed, including its uploaded file.`
          : `"${item.title}" was permanently removed.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'content'] });
      navigate('/admin/marketing-tools');
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
      setShowDeleteConfirm(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Marketing Tool"
        description="View marketing tool details."
        actions={
          <Link className={styles.backLink} to="/admin/marketing-tools">
            Back to marketing tools
          </Link>
        }
      />

      {isPending ? (
        <div className={styles.card}>
          <Skeleton className={styles.skeletonBlock} />
        </div>
      ) : isError ? (
        <ErrorState error={error} />
      ) : !item ? (
        <ErrorState title="Tool not found" message="The requested marketing tool does not exist." />
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{item.title}</h2>
            <StatusChip
              label={CONTENT_KIND_LABEL[item.kind]}
              tone={CONTENT_KIND_TONE[item.kind]}
              icon={KIND_ICON[item.kind]}
            />
          </div>

          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>ID</dt>
              <dd className={styles.mono}>{item.id}</dd>
            </div>
            <div className={styles.field}>
              <dt>Type</dt>
              <dd>
                <StatusChip
                  label={CONTENT_KIND_LABEL[item.kind]}
                  tone={CONTENT_KIND_TONE[item.kind]}
                  icon={KIND_ICON[item.kind]}
                />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Published</dt>
              <dd>{formatDate(item.createdAt)}</dd>
            </div>
          </dl>

          {item.description && (
            <div className={styles.descriptionSection}>
              <h3 className={styles.sectionTitle}>Description</h3>
              <p className={styles.descriptionText}>{item.description}</p>
            </div>
          )}

          {(item.kind === 'IMAGE' || item.kind === 'VIDEO') && item.downloadUrl && (
            <div className={styles.previewSection}>
              <h3 className={styles.sectionTitle}>Preview</h3>
              {item.kind === 'IMAGE' ? (
                <img src={item.downloadUrl} alt={item.title} className={styles.previewImage} />
              ) : (
                <video
                  controls
                  src={item.downloadUrl}
                  className={styles.previewVideo}
                  aria-label={item.title}
                />
              )}
            </div>
          )}

          {item.kind === 'DOCUMENT' && item.downloadUrl && isPdfUrl(item.downloadUrl) && (
            <div className={styles.previewSection}>
              <h3 className={styles.sectionTitle}>Preview</h3>
              <iframe src={item.downloadUrl} title={item.title} className={styles.previewPdf} />
            </div>
          )}

          {item.downloadUrl && (
            <div className={styles.linksSection}>
              <h3 className={styles.sectionTitle}>Links</h3>
              <div className={styles.links}>
                <a
                  className={styles.linkButton}
                  href={item.downloadUrl}
                  download={item.title}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download
                </a>
              </div>
            </div>
          )}

          {item.share && (
            <div className={styles.linksSection}>
              <h3 className={styles.sectionTitle}>Share</h3>
              <div className={styles.links}>
                {item.share.messengerUrl && (
                  <a
                    className={styles.linkButton}
                    href={item.share.messengerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Share on Messenger
                  </a>
                )}
                {item.share.viberUrl && (
                  <a
                    className={styles.linkButton}
                    href={item.share.viberUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Share on Viber
                  </a>
                )}
                {item.share.copyUrl && <CopyLinkButton url={item.share.copyUrl} />}
              </div>
            </div>
          )}

          <div className={styles.linksSection}>
            <h3 className={styles.sectionTitle}>Danger zone</h3>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => setShowEditDialog(true)}>
                Edit
              </Button>
              <Button
                variant="danger"
                onClick={() => setShowDeleteConfirm(true)}
                aria-label={`Delete ${item.title}`}
              >
                Delete Permanently
              </Button>
            </div>
          </div>
        </div>
      )}

      <ContentEditDialog
        open={showEditDialog}
        item={item ?? null}
        onClose={() => setShowEditDialog(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={`Delete "${item?.title ?? ''}"?`}
        message="This will permanently remove this marketing tool and its uploaded file. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />
    </section>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard API unavailable
    }
  };

  return (
    <button type="button" className={styles.linkButton} onClick={handleCopy}>
      Copy Link
    </button>
  );
}
