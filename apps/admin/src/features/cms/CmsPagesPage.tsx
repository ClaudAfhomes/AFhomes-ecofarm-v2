import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
} from '@afhomes/ui';
import type { CmsPage } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import { createCmsPage, getCmsPages, publishCmsPage, updateCmsPage } from './services';
import styles from './cms.module.css';

export function CmsPagesPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const pages = useQuery({
    queryKey: ['cms', 'pages'],
    queryFn: getCmsPages,
    // Refetches keep the previous list visible instead of blanking the table.
    placeholderData: keepPreviousData,
  });
  const [editing, setEditing] = useState<CmsPage | null>(null);
  const [creating, setCreating] = useState(false);
  const canCreate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.pages' && p.canCreate) === true;
  const canUpdate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.pages' && p.canUpdate) === true;
  const publication = useBusinessMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => publishCmsPage(id, publish),
    onSuccess: () => client.invalidateQueries({ queryKey: ['cms', 'pages'] }),
  });
  // First load skeletonizes the whole page - header and table - so no static
  // content flashes before the data it describes. Refetches keep the previous
  // list visible via placeholderData and never reach this branch.
  if (pages.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading CMS pages"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );
  if (pages.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="CMS Pages"
          description="Custom published pages built from the legacy block vocabulary."
        />
        <ErrorState
          title="CMS pages could not be loaded"
          error={pages.error}
          onRetry={() => void pages.refetch()}
        />
      </section>
    );
  return (
    <section className={styles.page}>
      <PageHeader
        title="CMS Pages"
        description="Custom published pages built from the legacy block vocabulary."
        actions={
          canCreate ? <Button onClick={() => setCreating(true)}>New page</Button> : undefined
        }
      />
      {!pages.data?.length ? (
        <EmptyState
          title="No custom pages"
          description="The Phase 3 routes continue using repository defaults."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Page</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.data.map((page) => (
                <tr key={page.id}>
                  <td data-label="Page">{page.title}</td>
                  <td data-label="Slug">/{page.slug}</td>
                  <td data-label="Status">
                    <StatusChip
                      label={page.status}
                      tone={page.status === 'published' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td data-label="Version">{page.version}</td>
                  <td data-label="Actions">
                    <div className={styles.actions}>
                      {canUpdate && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(page)}>
                          Edit
                        </Button>
                      )}
                      {canUpdate && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            publication.mutate({
                              id: page.id,
                              publish: page.status !== 'published',
                            })
                          }
                        >
                          {page.status === 'published' ? 'Unpublish' : 'Publish'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && (
        <PageEditor
          page={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {publication.error ? <p role="alert">{publication.error.message}</p> : null}
    </section>
  );
}

function PageEditor({ page, onClose }: { page: CmsPage | null; onClose: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [sections, setSections] = useState(JSON.stringify(page?.sections ?? [], null, 2));
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useBusinessMutation({
    mutationFn: async () => {
      const body = {
        title,
        slug,
        sections: JSON.parse(sections),
        seo: page?.seo ?? {},
        changeSummary: summary,
      };
      return page
        ? updateCmsPage(page.id, { ...body, expectedVersion: page.version })
        : createCmsPage(body);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cms', 'pages'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save page.'),
  });
  return (
    <section className={styles.panel}>
      <h2>{page ? `Edit ${page.title}` : 'New custom page'}</h2>
      <TextField
        id="cms-page-title"
        name="title"
        label="Title"
        optional
        value={title}
        onChange={setTitle}
      />
      <TextField
        id="cms-page-slug"
        name="slug"
        label="Slug"
        optional
        value={slug}
        onChange={(value) => setSlug(value.toLowerCase())}
      />
      <TextAreaField
        id="cms-page-sections"
        name="sections"
        label="Sections (JSON array)"
        optional
        rows={18}
        value={sections}
        onChange={setSections}
      />
      <TextField
        id="cms-page-summary"
        name="summary"
        label="Change summary"
        optional
        value={summary}
        onChange={setSummary}
      />
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button
          disabled={save.isPending || summary.trim().length < 3}
          onClick={() => save.mutate()}
        >
          Save page
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
