import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';

import { Button, ConfirmDialog, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import { formatMoney } from '@jad/shared';
import { CMS_PROPERTIES_SEED } from '@jad/contracts';

import { useProperty } from '../hooks/useProperty';
import { useDeleteProperty } from '../hooks/useDeleteProperty';
import { PropertyFormDialog } from '../components/PropertyFormDialog';
import styles from './CatalogDetail.module.css';

function formatCategory(categoryId: string): string {
  const cat = CMS_PROPERTIES_SEED.categories.find((c) => c.slug === categoryId);
  return cat?.title ?? categoryId;
}

export function CatalogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useProperty(id!);
  const deleteMutation = useDeleteProperty();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const cms = data ? CMS_PROPERTIES_SEED.properties.find((p) => p.id === data.id) : undefined;
  const areaFact = cms?.keyFacts.find((f) => /area/i.test(f.label));

  const handleDelete = () => {
    if (!data) return;
    deleteMutation.mutate(data.id, {
      onSuccess: () => navigate('/admin/properties'),
    });
    setDeleteOpen(false);
  };

  return (
    <section>
      <PageHeader
        title="Property Detail"
        description="View and manage this property listing."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Link className={styles.backLink} to="/admin/properties">
              Back to properties
            </Link>
          </div>
        }
      />

      {isPending ? (
        <div className={styles.card}>
          <Skeleton className={styles.skeletonBlock} />
        </div>
      ) : isError ? (
        <ErrorState error={error} />
      ) : !data ? (
        <ErrorState title="Property not found" message="The requested property does not exist." />
      ) : (
        <>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>{data.name}</h2>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
              </div>
            </div>
            <dl className={styles.fieldGrid}>
              <div className={styles.field}>
                <dt>Property ID</dt>
                <dd className={styles.mono}>{data.id}</dd>
              </div>
              <div className={styles.field}>
                <dt>Category</dt>
                <dd>{formatCategory(data.categoryId)}</dd>
              </div>
              <div className={styles.field}>
                <dt>Price</dt>
                <dd className={styles.money}>{data.price ? formatMoney(data.price) : '-'}</dd>
              </div>
              <div className={styles.field}>
                <dt>Status</dt>
                <dd>
                  <StatusChip
                    label={data.status}
                    tone={data.status === 'ACTIVE' ? 'success' : 'neutral'}
                  />
                </dd>
              </div>
              {cms && (
                <>
                  <div className={styles.field}>
                    <dt>Location</dt>
                    <dd>{cms.location}</dd>
                  </div>
                  <div className={styles.field}>
                    <dt>Area</dt>
                    <dd>{areaFact?.value ?? '-'}</dd>
                  </div>
                </>
              )}
            </dl>

            {cms && cms.keyFacts.length > 0 && (
              <div className={styles.keyFactsSection}>
                <h3 className={styles.sectionTitle}>Key Facts</h3>
                <dl className={styles.keyFactsGrid}>
                  {cms.keyFacts.map((fact, i) => (
                    <div key={i} className={styles.keyFact}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {cms && cms.highlights.length > 0 && (
              <div className={styles.highlightsSection}>
                <h3 className={styles.sectionTitle}>Highlights</h3>
                <ul className={styles.highlightsList}>
                  {cms.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <PropertyFormDialog open={editOpen} onClose={() => setEditOpen(false)} property={data} />

          <ConfirmDialog
            open={deleteOpen}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={handleDelete}
            title="Delete property?"
            message={`This will permanently remove "${data.name}" from the catalog. This action cannot be undone.`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
          />
        </>
      )}
    </section>
  );
}
