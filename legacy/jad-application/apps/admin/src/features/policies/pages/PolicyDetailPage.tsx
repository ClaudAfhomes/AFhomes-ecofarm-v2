import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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

import { usePolicies } from '../hooks/usePolicies';
import { useDeletePolicy } from '../hooks/useDeletePolicy';
import { PolicyEditDialog } from '../components/PolicyEditDialog';
import { policyTypeLabel, policyTypeTone } from '../status';
import { formatDate } from '../../../lib/format';
import styles from './PolicyDetailPage.module.css';

/** Policy Detail - read-only view of a single policy, with its required PDF. */
export function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = usePolicies();
  const deletePolicy = useDeletePolicy();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const item = data?.find((p) => p.id === id);

  const handleDelete = async () => {
    if (!item) return;
    try {
      const result = await deletePolicy.mutateAsync(item.id);
      notifySuccess({
        title: 'Policy deleted',
        message:
          `"${item.title}" was permanently removed` +
          (item.documentUrl && result.fileRemoved === false
            ? ', but its uploaded PDF could not be removed.'
            : '.'),
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
      navigate('/admin/policies');
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
      setShowDeleteConfirm(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Policy"
        description="View policy details."
        actions={
          <Link className={styles.backLink} to="/admin/policies">
            Back to policies
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
        <ErrorState title="Policy not found" message="The requested policy does not exist." />
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{item.title}</h2>
            <StatusChip
              label={policyTypeLabel(item.type)}
              tone={policyTypeTone(item.type)}
              icon="file-text"
            />
          </div>

          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>ID</dt>
              <dd className={styles.mono}>{item.id}</dd>
            </div>
            <div className={styles.field}>
              <dt>Type</dt>
              <dd>{item.type}</dd>
            </div>
            <div className={styles.field}>
              <dt>Updated</dt>
              <dd>{formatDate(item.updatedAt)}</dd>
            </div>
          </dl>

          {item.content?.trim() && (
            <div className={styles.descriptionSection}>
              <h3 className={styles.sectionTitle}>Summary</h3>
              <p className={styles.descriptionText}>{item.content}</p>
            </div>
          )}

          {item.documentUrl ? (
            <div className={styles.previewSection}>
              <h3 className={styles.sectionTitle}>PDF</h3>
              <iframe src={item.documentUrl} title={item.title} className={styles.previewPdf} />
            </div>
          ) : (
            <div className={styles.previewSection}>
              <h3 className={styles.sectionTitle}>PDF</h3>
              <p className={styles.descriptionText}>
                No PDF attached yet - use Edit to upload the required document.
              </p>
            </div>
          )}

          {item.documentUrl && (
            <div className={styles.linksSection}>
              <h3 className={styles.sectionTitle}>Links</h3>
              <div className={styles.links}>
                <a
                  className={styles.linkButton}
                  href={item.documentUrl}
                  download={item.title}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download
                </a>
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

      <PolicyEditDialog
        open={showEditDialog}
        item={item ?? null}
        onClose={() => setShowEditDialog(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={`Delete "${item?.title ?? ''}"?`}
        message="This will permanently remove this policy and its uploaded PDF. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />
    </section>
  );
}
