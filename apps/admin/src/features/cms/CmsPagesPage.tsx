import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import type { CmsPage } from '@jad/contracts';
import { useSession } from '../../lib/session';
import { createCmsPage, getCmsPages, publishCmsPage, updateCmsPage } from './services';
import styles from './cms.module.css';

export function CmsPagesPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const pages = useQuery({ queryKey: ['cms', 'pages'], queryFn: getCmsPages });
  const [editing, setEditing] = useState<CmsPage | null>(null);
  const [creating, setCreating] = useState(false);
  const canCreate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.pages' && p.canCreate) === true;
  const canUpdate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'cms.pages' && p.canUpdate) === true;
  const publication = useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => publishCmsPage(id, publish),
    onSuccess: () => client.invalidateQueries({ queryKey: ['cms', 'pages'] }),
  });
  if (pages.isLoading) return <p role="status">Loading CMS pages…</p>;
  if (pages.isError)
    return (
      <ErrorState
        title="CMS pages could not be loaded"
        error={pages.error}
        onRetry={() => void pages.refetch()}
      />
    );
  return (
    <>
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
        <div className="table-scroll">
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
                <td>{page.title}</td>
                <td>/{page.slug}</td>
                <td>
                  <StatusChip
                    label={page.status}
                    tone={page.status === 'published' ? 'success' : 'neutral'}
                  />
                </td>
                <td>{page.version}</td>
                <td>
                  <div className={styles.actions}>
                    {canUpdate && (
                      <Button variant="secondary" onClick={() => setEditing(page)}>
                        Edit
                      </Button>
                    )}
                    {canUpdate && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          publication.mutate({ id: page.id, publish: page.status !== 'published' })
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
    </>
  );
}

function PageEditor({ page, onClose }: { page: CmsPage | null; onClose: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [sections, setSections] = useState(JSON.stringify(page?.sections ?? [], null, 2));
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
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
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Slug
        <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
      </label>
      <label>
        Sections (JSON array)
        <textarea rows={18} value={sections} onChange={(e) => setSections(e.target.value)} />
      </label>
      <label>
        Change summary
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
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
