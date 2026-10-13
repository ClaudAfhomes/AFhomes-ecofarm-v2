import { useMemo, useState } from 'react';
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
  const documents = useQuery({
    queryKey: ['cms', 'documents'],
    queryFn: getCmsDocuments,
    // Refetches keep the previous draft visible instead of blanking the editor.
    placeholderData: keepPreviousData,
  });
  const document = useMemo(
    () => documents.data?.find((item) => item.key === documentKey),
    [documents.data, documentKey],
  );
  // First load skeletonizes the whole page - header and editor - so no static
  // content flashes before the data it describes. Refetches keep the previous
  // draft visible via placeholderData and never reach this branch.
  if (documents.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading CMS content"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <Skeleton style={{ height: 320 }} />
          <Skeleton style={{ height: 40, maxWidth: 320 }} />
        </div>
      </section>
    );
  if (documents.isError)
    return (
      <section className={styles.page}>
        <PageHeader title={title} description={description} />
        <ErrorState
          title="CMS content could not be loaded"
          error={documents.error}
          onRetry={() => void documents.refetch()}
        />
      </section>
    );
  const permission = documentKey === 'site' ? 'cms.settings' : 'cms.pages';
  const canUpdate =
    user?.afHomesPermissions.some((item) => item.moduleKey === permission && item.canUpdate) ===
    true;
  return (
    <section className={styles.page}>
      <DocumentEditor
        key={`${documentKey}-${document?.version ?? 'new'}`}
        title={title}
        description={description}
        documentKey={documentKey}
        document={document}
        canUpdate={canUpdate}
      />
    </section>
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
  const save = useBusinessMutation({
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
  const publish = useBusinessMutation({
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
        <TextAreaField
          id="cms-document-content"
          name="content"
          label="Structured content (JSON)"
          optional
          rows={24}
          value={value}
          onChange={setValue}
          disabled={!canUpdate}
        />
        <TextField
          id="cms-document-summary"
          name="summary"
          label="Change summary"
          optional
          value={summary}
          maxLength={500}
          onChange={setSummary}
          disabled={!canUpdate}
        />
        {message && !save.isError && !publish.isError ? <p role="status">{message}</p> : null}
        {save.isError ? <p role="alert">{save.error.message}</p> : null}
        {publish.isError ? <p role="alert">{publish.error.message}</p> : null}
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
