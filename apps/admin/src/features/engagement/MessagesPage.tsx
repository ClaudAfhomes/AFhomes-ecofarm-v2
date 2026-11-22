import { useCallback, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import type { Conversation } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { errorText, useModuleAccess } from './permissions';
import { getConversation, listConversations, postStaffMessage, updateConversation } from './services';
import styles from '../reports/AuditPage.module.css';
import local from './Engagement.module.css';

const PAGE_SIZE = 50;

/**
 * Member Messages. Members write to the AF Homes team; staff reply here.
 * Reading needs `communication.messages` view, replying and closing need
 * update. Opening a thread marks it read for staff. A reply is sent with one
 * request id per attempt, so a double click or a retry never posts twice.
 */
export function MessagesPage() {
  const queryClient = useQueryClient();
  const { canUpdate: mayUpdate } = useModuleAccess('communication.messages');
  const [status, setStatus] = useState('awaiting');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const requestId = useRef<string | null>(null);

  const resetPage = useCallback(() => setOffset(0), []);
  const debouncedSearch = useDebouncedValue(search, 300, resetPage);

  const query = useQuery({
    queryKey: ['conversations', status, debouncedSearch, offset],
    queryFn: () =>
      listConversations({
        status: status as 'awaiting',
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const thread = useQuery({
    queryKey: ['conversation', openId],
    queryFn: () => getConversation(openId as string),
    enabled: openId !== null,
    refetchInterval: 15_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation'] });
    void queryClient.invalidateQueries({ queryKey: ['staff-alerts'] });
  };

  const send = useMutation({
    mutationFn: ({ id, body, rid }: { id: string; body: string; rid: string }) =>
      postStaffMessage(id, { requestId: rid, body }),
    onSuccess: () => {
      requestId.current = null;
      setReply('');
      refresh();
      notifySuccess({ title: 'Reply sent', message: 'The member can see it in their portal.' });
    },
    onError: (e) => notifyError({ title: 'Reply not sent', message: errorText(e) }),
  });

  const setState = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'open' | 'closed' }) =>
      updateConversation(id, { status: next }),
    onSuccess: (saved) => {
      refresh();
      notifySuccess({
        title: saved.status === 'closed' ? 'Conversation closed' : 'Conversation reopened',
        message: saved.subject,
      });
    },
    onError: (e) => notifyError({ title: 'Conversation not updated', message: errorText(e) }),
  });

  const open = (c: Conversation) => {
    setOpenId(c.id);
    setReply('');
    requestId.current = null;
  };
  const sendReply = () => {
    const body = reply.trim();
    if (!openId || !body) return;
    requestId.current ??= crypto.randomUUID();
    send.mutate({ id: openId, body, rid: requestId.current });
  };

  if (query.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading messages"
        >
          <Skeleton style={{ height: 32, maxWidth: 240 }} />
          <Skeleton style={{ height: 40, maxWidth: 420 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      </section>
    );

  const total = query.data?.total ?? 0;
  const awaitingCount = query.data?.awaitingCount ?? 0;
  const detail = thread.data;

  return (
    <section className={styles.page}>
      <PageHeader
        title="Member Messages"
        description="Questions members send from their portal. Open a conversation to read it and reply; the member sees your reply in their portal."
      />

      <FilterBar
        search={
          <SearchField
            label="Search"
            placeholder="Member name, number or subject"
            value={search}
            onChange={setSearch}
            busy={query.isFetching && !query.isPending}
          />
        }
        filters={
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
            options={[
              { value: 'awaiting', label: 'Awaiting reply' },
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />
      <div className={styles.resultBar} aria-live="polite">
        <span>
          {`${total.toLocaleString()} conversation${total === 1 ? '' : 's'}`}
          {status !== 'awaiting' && awaitingCount > 0 ? ` · ${awaitingCount} awaiting reply` : ''}
        </span>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data || query.data.data.length === 0 ? (
        <EmptyState
          title={status === 'awaiting' ? 'No messages awaiting a reply' : 'No conversations'}
          description={
            status === 'awaiting'
              ? 'You are all caught up. New member messages appear here.'
              : 'Nothing matches these filters.'
          }
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Subject</th>
                  <th>Last message</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Member">
                      <span className={styles.actor}>
                        <span>{c.customerName ?? '—'}</span>
                        <small>{c.customerNumber ?? ''}</small>
                      </span>
                    </td>
                    <td data-label="Subject">
                      <span className={styles.actor}>
                        <span>{c.subject}</span>
                        {c.unread ? <small>New message</small> : null}
                      </span>
                    </td>
                    <td data-label="Last message">
                      <span className={styles.actor}>
                        <span>{formatDateTime(c.lastMessageAt)}</span>
                        <small>{c.lastSenderKind === 'customer' ? 'From member' : 'From staff'}</small>
                      </span>
                    </td>
                    <td data-label="Status">
                      <StatusChip
                        label={c.status === 'closed' ? 'Closed' : 'Open'}
                        tone={c.status === 'closed' ? 'neutral' : 'info'}
                      />
                    </td>
                    <td data-label="">
                      <span className={local.rowActions}>
                        <Button size="sm" onClick={() => open(c)}>
                          {mayUpdate && c.status === 'open' ? 'Reply' : 'View'}
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actionsRow}>
            <span className={styles.range}>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={detail ? `${detail.subject} · ${detail.customerName ?? 'Member'}` : 'Conversation'}
        footer={
          detail ? (
            <>
              {mayUpdate ? (
                <Button
                  variant="ghost"
                  disabled={setState.isPending}
                  onClick={() =>
                    setState.mutate({
                      id: detail.id,
                      next: detail.status === 'closed' ? 'open' : 'closed',
                    })
                  }
                >
                  {detail.status === 'closed' ? 'Reopen' : 'Close conversation'}
                </Button>
              ) : null}
              {mayUpdate && detail.status === 'open' ? (
                <Button disabled={send.isPending || !reply.trim()} onClick={sendReply}>
                  Send
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setOpenId(null)}>
                  Close window
                </Button>
              )}
            </>
          ) : null
        }
      >
        {thread.isError ? (
          <ErrorState error={thread.error} onRetry={thread.refetch} />
        ) : !detail ? (
          <Skeleton style={{ height: 80 }} />
        ) : (
          <div className={styles.detailSection}>
            <div className={local.thread} role="log" aria-label="Messages">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`${local.bubble} ${m.senderKind === 'staff' ? local.bubbleStaff : ''}`}
                >
                  <small>
                    {m.senderKind === 'staff'
                      ? (m.senderName ?? 'AF Homes staff')
                      : (detail.customerName ?? 'Member')}{' '}
                    · {formatDateTime(m.createdAt)}
                  </small>
                  <p>{m.body}</p>
                </div>
              ))}
            </div>
            {mayUpdate && detail.status === 'open' ? (
              <TextAreaField
                id="conversation-reply"
                name="reply"
                label="Your reply"
                rows={3}
                maxLength={5000}
                value={reply}
                onChange={(value) => {
                  // A changed body is a new send attempt, so it gets a new id.
                  requestId.current = null;
                  setReply(value);
                }}
              />
            ) : mayUpdate ? (
              <p className={local.reason}>This conversation is closed. Reopen it to reply.</p>
            ) : null}
          </div>
        )}
      </Dialog>
    </section>
  );
}
