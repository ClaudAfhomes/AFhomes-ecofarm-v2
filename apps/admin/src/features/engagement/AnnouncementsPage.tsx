import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
  notifyError,
  notifySuccess,
  type StatusTone,
} from '@afhomes/ui';
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  canTransitionAnnouncement,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementStatus,
  type CreateAnnouncement,
  type UpdateAnnouncement,
} from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { errorText, useModuleAccess } from './permissions';
import { createAnnouncement, listAnnouncements, updateAnnouncement } from './services';
import styles from '../reports/AuditPage.module.css';
import local from './Engagement.module.css';

const TONE: Record<AnnouncementStatus, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

/** `datetime-local` value (browser zone) from an ISO instant. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/** The one status move offered per row, from the contract's transition table. */
export function statusAction(
  status: AnnouncementStatus,
): { label: string; status: AnnouncementStatus } | null {
  if (canTransitionAnnouncement(status, 'published'))
    return { label: status === 'archived' ? 'Republish' : 'Publish', status: 'published' };
  if (canTransitionAnnouncement(status, 'archived')) return { label: 'Archive', status: 'archived' };
  return null;
}

interface Draft {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  pinned: boolean;
  expires: string;
}

const EMPTY: Draft = { title: '', body: '', audience: 'customers', pinned: false, expires: '' };

const AUDIENCE_OPTIONS = (
  Object.entries(ANNOUNCEMENT_AUDIENCE_LABELS) as [AnnouncementAudience, string][]
).map(([value, label]) => ({ value, label }));

/**
 * Announcements. Staff write notices for members, staff or both. Reading needs
 * `communication.announcements` view, creating needs create, and editing or
 * moving a notice between draft, published and archived needs update. The
 * server re-checks all of it.
 */
export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const { canCreate, canUpdate } = useModuleAccess('communication.announcements');
  // `null` = closed, `'new'` = create, otherwise the notice being edited.
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['announcements'],
    queryFn: listAnnouncements,
    refetchInterval: 30_000,
  });

  const done = (title: string, message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['announcements'] });
    setEditing(null);
    notifySuccess({ title, message });
  };

  const create = useMutation({
    mutationFn: (input: CreateAnnouncement) => createAnnouncement(input),
    onSuccess: (saved) =>
      done(
        saved.status === 'published' ? 'Announcement published' : 'Draft saved',
        saved.title,
      ),
    onError: (e) => notifyError({ title: 'Announcement not saved', message: errorText(e) }),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAnnouncement }) =>
      updateAnnouncement(id, input),
    onSuccess: (saved) =>
      done('Announcement updated', `${saved.title} is ${ANNOUNCEMENT_STATUS_LABELS[saved.status].toLowerCase()}.`),
    onError: (e) => notifyError({ title: 'Announcement not updated', message: errorText(e) }),
  });

  const busy = create.isPending || update.isPending;

  const openNew = () => {
    setDraft(EMPTY);
    setError(null);
    setEditing('new');
  };
  const openEdit = (a: Announcement) => {
    setDraft({
      title: a.title,
      body: a.body,
      audience: a.audience,
      pinned: a.pinned,
      expires: toLocalInput(a.expiresAt),
    });
    setError(null);
    setEditing(a);
  };

  const fields = () => ({
    title: draft.title.trim(),
    body: draft.body.trim(),
    audience: draft.audience,
    pinned: draft.pinned,
    expiresAt: fromLocalInput(draft.expires),
  });
  const valid = () => {
    if (draft.title.trim().length < 3) return 'Give it a title of at least 3 characters.';
    if (!draft.body.trim()) return 'Write the announcement.';
    return null;
  };

  const submitNew = (publish: boolean) => {
    const problem = valid();
    setError(problem);
    if (!problem) create.mutate({ ...fields(), publish });
  };
  const submitEdit = (a: Announcement) => {
    const problem = valid();
    setError(problem);
    if (!problem) update.mutate({ id: a.id, input: fields() });
  };

  if (query.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading announcements"
        >
          <Skeleton style={{ height: 32, maxWidth: 240 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      </section>
    );

  const items = query.data ?? [];

  return (
    <section className={styles.page}>
      <PageHeader
        title="Announcements"
        description="Notices for members, staff or both. A draft is only visible here; publishing shows it to its audience until it is archived or expires."
        actions={
          canCreate ? <Button onClick={openNew}>New announcement</Button> : undefined
        }
      />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description={
            canCreate
              ? 'Create one to show a notice to members or staff.'
              : 'Announcements will appear here.'
          }
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Audience</th>
                <th>Status</th>
                <th>Published</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const action = statusAction(a.status);
                return (
                  <tr key={a.id}>
                    <td data-label="Title">
                      <span className={styles.actor}>
                        <span>{a.title}</span>
                        {a.pinned ? <small>Pinned</small> : null}
                      </span>
                    </td>
                    <td data-label="Audience">{ANNOUNCEMENT_AUDIENCE_LABELS[a.audience]}</td>
                    <td data-label="Status">
                      <StatusChip label={ANNOUNCEMENT_STATUS_LABELS[a.status]} tone={TONE[a.status]} />
                    </td>
                    <td data-label="Published">{formatDateTime(a.publishedAt)}</td>
                    <td data-label="Expires">{formatDateTime(a.expiresAt)}</td>
                    <td data-label="">
                      <span className={local.rowActions}>
                        {canUpdate && action ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => update.mutate({ id: a.id, input: { status: action.status } })}
                          >
                            {action.label}
                          </Button>
                        ) : null}
                        {canUpdate ? (
                          <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>
                            Edit
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New announcement' : 'Edit announcement'}
        footer={
          editing === 'new' ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => submitNew(false)}>
                Save draft
              </Button>
              <Button disabled={busy} onClick={() => submitNew(true)}>
                Publish now
              </Button>
            </>
          ) : editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => submitEdit(editing)}>
                Save changes
              </Button>
            </>
          ) : null
        }
      >
        <div className={local.form}>
          <TextField
            id="announcement-title"
            name="title"
            label="Title"
            maxLength={150}
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
          />
          <TextAreaField
            id="announcement-body"
            name="body"
            label="Message"
            rows={5}
            maxLength={5000}
            value={draft.body}
            onChange={(body) => setDraft({ ...draft, body })}
          />
          <FormField id="announcement-audience" label="Audience">
            <Select
              id="announcement-audience"
              value={draft.audience}
              onChange={(e) => setDraft({ ...draft, audience: e.target.value as AnnouncementAudience })}
              options={AUDIENCE_OPTIONS}
            />
          </FormField>
          <label className={local.checkRow}>
            <input
              type="checkbox"
              checked={draft.pinned}
              onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            />
            Pin to the top
          </label>
          <FormField
            id="announcement-expires"
            label="Expires"
            optional
            hint="Leave empty to keep it until you archive it."
          >
            <input
              id="announcement-expires"
              type="datetime-local"
              className={local.nativeInput}
              value={draft.expires}
              onChange={(e) => setDraft({ ...draft, expires: e.target.value })}
            />
          </FormField>
          {error ? (
            <p role="alert" className={local.reason}>
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
