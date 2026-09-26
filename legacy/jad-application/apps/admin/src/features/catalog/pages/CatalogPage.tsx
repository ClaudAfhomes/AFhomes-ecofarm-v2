import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jad/ui';
import { formatMoney } from '@jad/shared';

import type { CatalogProperty } from '@jad/contracts';

import { useProperties } from '../hooks/useProperties';
import { useDeleteProperty } from '../hooks/useDeleteProperty';
import { useCategories } from '../hooks/useCategories';
import { useDeleteCategory } from '../hooks/useDeleteCategory';
import type { PropertyCategory } from '../services/catalog';
// Linked CMS entries (read-only): shows which catalog rows back public-site
// content and deep-links to the CMS sections. Explicit links win, otherwise
// entries auto-match on id/slug equality. CMS never writes catalog rows.
import { usePropertiesCms } from '../../cms/hooks/usePropertiesCms';
import {
  cmsLinkedCategorySlugs as buildLinkedCategorySlugs,
  cmsLinkedListingIds as buildLinkedListingIds,
} from '../../cms/services/catalogLinks';
import { PropertyFormDialog } from '../components/PropertyFormDialog';
import { CategoryFormDialog } from '../components/CategoryFormDialog';

import styles from './CatalogPage.module.css';

type Tab = 'categories' | 'listings';

const PAGE_SIZE = 10;

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          {Array.from({ length: columns }, (_, i) => (
            <TableHeaderCell key={i}>
              <Skeleton />
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 5 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: columns }, (_, j) => (
              <TableCell key={j}>
                <Skeleton />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CatalogPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useProperties();
  const deletePropertyMutation = useDeleteProperty();
  const { data: categories } = useCategories();
  const deleteCategoryMutation = useDeleteCategory();
  const { data: cmsContent } = usePropertiesCms();

  // Catalog ids/slugs referenced by CMS entries (explicit links win,
  // otherwise auto-matched on id/slug equality).
  const cmsLinkedListingIds = useMemo(
    () => buildLinkedListingIds(cmsContent?.properties, data),
    [cmsContent, data],
  );
  const cmsLinkedCategorySlugs = useMemo(
    () => buildLinkedCategorySlugs(cmsContent?.categories, categories),
    [cmsContent, categories],
  );

  const [tab, setTab] = useState<Tab>('listings');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Listing state
  const [listingFormOpen, setListingFormOpen] = useState(false);
  const [listingEditTarget, setListingEditTarget] = useState<CatalogProperty | null>(null);
  const [listingDeleteTarget, setListingDeleteTarget] = useState<CatalogProperty | null>(null);

  // Category state
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catEditTarget, setCatEditTarget] = useState<PropertyCategory | null>(null);
  const [catDeleteTarget, setCatDeleteTarget] = useState<PropertyCategory | null>(null);
  const [catDeleteBlocked, setCatDeleteBlocked] = useState<PropertyCategory | null>(null);

  const filtered = useMemo(() => {
    const all = data ?? [];
    return all.filter((p) => {
      if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      return true;
    });
  }, [data, categoryFilter, statusFilter]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (categories) {
      for (const cat of categories) {
        counts[cat.slug] = cat.listingCount;
      }
    }
    return counts;
  }, [categories]);

  const handleListingDelete = () => {
    if (!listingDeleteTarget) return;
    deletePropertyMutation.mutate(listingDeleteTarget.id);
    setListingDeleteTarget(null);
    const remaining = total - 1;
    const newPageCount = Math.max(1, Math.ceil(remaining / PAGE_SIZE));
    if (page > newPageCount) setPage(newPageCount);
  };

  const handleCategoryDelete = async () => {
    if (!catDeleteTarget) return;
    const result = await deleteCategoryMutation.mutateAsync(catDeleteTarget.slug);
    if (result && !result.ok) {
      setCatDeleteTarget(null);
      setCatDeleteBlocked(catDeleteTarget);
      return;
    }
    setCatDeleteTarget(null);
  };

  const handleListingFormClose = () => {
    setListingFormOpen(false);
    setListingEditTarget(null);
  };

  const handleCatFormClose = () => {
    setCatFormOpen(false);
    setCatEditTarget(null);
  };

  return (
    <section>
      <PageHeader
        title="Properties"
        description="Manage property listings and their presentation across the website."
        actions={
          tab === 'categories' ? (
            <Button variant="primary" onClick={() => setCatFormOpen(true)}>
              Create Category
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setListingFormOpen(true)}>
              Create Property
            </Button>
          )
        }
      />

      <div className={styles.entryCards}>
        <button
          type="button"
          className={tab === 'categories' ? styles.entryCardActive : styles.entryCard}
          onClick={() => {
            setTab('categories');
            setPage(1);
          }}
        >
          <span className={styles.entryCardTitle}>Property Categories</span>
          <span className={styles.entryCardMeta}>{categories?.length ?? 0} categories</span>
        </button>
        <button
          type="button"
          className={tab === 'listings' ? styles.entryCardActive : styles.entryCard}
          onClick={() => {
            setTab('listings');
            setPage(1);
          }}
        >
          <span className={styles.entryCardTitle}>Property Listings</span>
          <span className={styles.entryCardMeta}>{data?.length ?? 0} listings</span>
        </button>
      </div>

      {isPending ? (
        <TableSkeleton columns={tab === 'categories' ? 5 : 5} />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : tab === 'categories' ? (
        !categories || categories.length === 0 ? (
          <EmptyState title="No categories" description="No property categories are defined." />
        ) : (
          <>
            <div className="table-scroll">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Title</TableHeaderCell>
                    <TableHeaderCell>Slug</TableHeaderCell>
                    <TableHeaderCell>Featured</TableHeaderCell>
                    <TableHeaderCell>Listings</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categories.map((cat) => (
                    <TableRow key={cat.slug}>
                      <TableCell label="Title">
                        <span style={{ fontWeight: 600 }}>{cat.title}</span>{' '}
                        {cmsLinkedCategorySlugs.has(cat.slug) ? (
                          <Link
                            to="/admin/cms/properties#categories"
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: 'var(--text-caption)' }}
                          >
                            In CMS
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell label="Slug">
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-caption)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {cat.slug}
                        </span>
                      </TableCell>
                      <TableCell label="Featured">
                        {cat.isFeatured ? (
                          <StatusChip label="Featured" tone="info" />
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                        )}
                      </TableCell>
                      <TableCell label="Listings">{cat.listingCount}</TableCell>
                      <TableCell label="Actions">
                        <div
                          style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Button variant="secondary" onClick={() => setCatEditTarget(cat)}>
                            Edit
                          </Button>
                          <Button variant="danger" onClick={() => setCatDeleteTarget(cat)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className={styles.tableFooter}>
              <span className={styles.captionText} role="status" aria-live="polite">
                {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
          </>
        )
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState title="No properties" description="The property catalog is empty." />
      ) : (
        <>
          <div className={styles.filterBar}>
            <Select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All categories' },
                ...(categories ?? []).map((c) => ({ value: c.slug, label: c.title })),
              ]}
            />
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
            {categoryFilter !== 'ALL' || statusFilter !== 'ALL' ? (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('ALL');
                  setStatusFilter('ALL');
                  setPage(1);
                }}
                className={styles.clearButton}
              >
                Clear
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState
              title="No properties match this filter"
              description="Try adjusting the filter or create a new property."
            />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Property</TableHeaderCell>
                      <TableHeaderCell>Category</TableHeaderCell>
                      <TableHeaderCell align="right">Price</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const catLabel =
                        categories?.find((c) => c.slug === row.categoryId)?.title ?? row.categoryId;
                      return (
                        <TableRow
                          key={row.id}
                          onClick={() => navigate(`/admin/properties/${row.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <TableCell label="Property">
                            <span style={{ fontWeight: 600 }}>{row.name}</span>{' '}
                            {cmsLinkedListingIds.has(row.id) ? (
                              <Link
                                to="/admin/cms/properties#properties"
                                onClick={(e) => e.stopPropagation()}
                                style={{ fontSize: 'var(--text-caption)' }}
                              >
                                In CMS
                              </Link>
                            ) : null}
                          </TableCell>
                          <TableCell label="Category">
                            <StatusChip label={catLabel} tone="info" />
                          </TableCell>
                          <TableCell label="Price" align="right">
                            {row.price ? (
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {formatMoney(row.price)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                            )}
                          </TableCell>
                          <TableCell label="Status">
                            <StatusChip
                              label={row.status}
                              tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                            />
                          </TableCell>
                          <TableCell label="Actions">
                            <div
                              style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Button variant="secondary" onClick={() => setListingEditTarget(row)}>
                                Edit
                              </Button>
                              <Button variant="danger" onClick={() => setListingDeleteTarget(row)}>
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} propert{total === 1 ? 'y' : 'ies'} page {page} of {pageCount}
                </span>
                <Pagination page={page} pageCount={pageCount} onChange={setPage} />
              </div>
            </>
          )}
        </>
      )}

      {/* Listing dialogs */}
      <PropertyFormDialog
        open={listingFormOpen || listingEditTarget !== null}
        onClose={handleListingFormClose}
        property={listingEditTarget ?? undefined}
      />
      <ConfirmDialog
        open={listingDeleteTarget !== null}
        onCancel={() => setListingDeleteTarget(null)}
        onConfirm={handleListingDelete}
        title="Delete property?"
        message={`This will permanently remove "${listingDeleteTarget?.name ?? ''}" from the catalog. This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Category dialogs */}
      <CategoryFormDialog
        open={catFormOpen || catEditTarget !== null}
        onClose={handleCatFormClose}
        category={catEditTarget ?? undefined}
      />
      <ConfirmDialog
        open={catDeleteTarget !== null}
        onCancel={() => setCatDeleteTarget(null)}
        onConfirm={handleCategoryDelete}
        title="Delete category?"
        message={
          catDeleteTarget && (categoryCounts[catDeleteTarget.slug] ?? 0) > 0
            ? `Cannot delete "${catDeleteTarget.title}" because it has ${categoryCounts[catDeleteTarget.slug]} listing${categoryCounts[catDeleteTarget.slug] === 1 ? '' : 's'}. Remove or reassign all listings first.`
            : `This will permanently remove the "${catDeleteTarget?.title ?? ''}" category. This action cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
      <ConfirmDialog
        open={catDeleteBlocked !== null}
        onCancel={() => setCatDeleteBlocked(null)}
        onConfirm={() => setCatDeleteBlocked(null)}
        title="Cannot delete category"
        message={`"${catDeleteBlocked?.title ?? ''}" has ${categoryCounts[catDeleteBlocked?.slug ?? ''] ?? 0} listing${(categoryCounts[catDeleteBlocked?.slug ?? ''] ?? 0) === 1 ? '' : 's'} assigned. Remove or reassign all listings before deleting this category.`}
        confirmLabel="OK"
        cancelLabel="Cancel"
      />
    </section>
  );
}
