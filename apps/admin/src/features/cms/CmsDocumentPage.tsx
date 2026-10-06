import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@afhomes/ui';
import type { CmsDocument, CmsDocumentKey } from '@afhomes/contracts';

import { useSession } from '../../lib/session';
import { getCmsDocuments, publishCmsDocument, saveCmsDocument } from './services';
import styles from './cms.module.css';

export function CmsDocumentPage({
  title,
  description,
  documentKey,
}: {
  title: string;
  description: string;
  documentKey: CmsDocumentKey;
}) {
  const { user } = useSession();
  const documents = useQuery({ queryKey: ['cms', 'documents'], queryFn: getCmsDocuments });
  const document = useMemo(
    () => documents.data?.find((item) => item.key === documentKey),
    [documents.data, documentKey],
  );
  if (documents.isLoading)
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)' }} role="status" aria-label="Loading CMS content">
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
      </div>
    );
  if (documents.isError)
    return (
      <ErrorState
        title="CMS content could not be loaded"
        error={documents.error}
        onRetry={() => void documents.refetch()}
      />
    );
  const permission = documentKey === 'site' ? 'cms.settings' : 'cms.pages';
  const canUpdate =
    user?.afHomesPermissions.some((item) => item.moduleKey === permission && item.canUpdate) ===
    true;
  return (
    <DocumentEditor
      key={`${documentKey}-${document?.version ?? 'new'}`}
      title={title}
      description={description}
      documentKey={documentKey}
      document={document}
      canUpdate={canUpdate}
    />
  );
}

function DocumentEditor({
  title,
  description,
  documentKey,
  document,
  canUpdate,
}: {
  title: string;
  description: string;
  documentKey: CmsDocumentKey;
  document: CmsDocument | undefined;
  canUpdate: boolean;
}) {
  const client = useQueryClient();
  const [value, setValue] = useState(() => JSON.stringify(document?.draftValue ?? {}, null, 2));
  const [summary, setSummary] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error('Content must be valid JSON.');
      }
      return saveCmsDocument(documentKey, parsed, document?.version ?? 1, summary);
    },
    onSuccess: async () => {
      setSummary('');
      setMessage('Draft saved.');
      await client.invalidateQueries({ queryKey: ['cms', 'documents'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save.'),
  });
  const publish = useMutation({
    mutationFn: (next: boolean) => publishCmsDocument(documentKey, next),
    onSuccess: async () => {
      setMessage('Publication state updated.');
      await client.invalidateQueries({ queryKey: ['cms', 'documents'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not publish.'),
  });
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          document ? (
            <StatusChip
              label={document.status}
              tone={document.status === 'published' ? 'success' : 'neutral'}
            />
          ) : undefined
        }
      />
      {!document && (
        <EmptyState
          title="No draft exists yet"
          description="Saving creates the first managed draft without changing the public website."
        />
      )}
      <div className={styles.editor}>
        <label>
          Structured content (JSON)
          <textarea
            rows={24}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={!canUpdate}
          />
        </label>
        <label>
          Change summary
          <input
            value={summary}
            maxLength={500}
            onChange={(event) => setSummary(event.target.value)}
            disabled={!canUpdate}
          />
        </label>
        {message && <p role="status">{message}</p>}
        {canUpdate && (
          <div className={styles.actions}>
            <Button
              disabled={save.isPending || summary.trim().length < 3}
              onClick={() => save.mutate()}
            >
              Save draft
            </Button>
            {document && (
              <Button
                variant="secondary"
                disabled={publish.isPending}
                onClick={() => publish.mutate(document.status !== 'published')}
              >
                {document.status === 'published' ? 'Unpublish' : 'Publish draft'}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
