import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Button, ErrorState, Icon, Skeleton, getInitials, notifyError, useScrollToLatest } from '@jad/ui';
import type { Message } from '@jad/contracts';

import { ApiError } from '../../../lib/api/errors';
import { formatRelativeTime } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import {
  useConversationThread,
  useMarkConversationRead,
  useSendStaffMessage,
} from '../hooks/useConversations';
import { buildThreadItems, capComposerHeight } from '../threadItems';
import styles from './ConversationThread.module.css';

const MAX_LENGTH = 4000;

interface ConversationThreadProps {
  memberId: string;
  memberName?: string;
  memberEmail?: string;
}

/**
 * One member's thread (right pane / mobile detail): member identity header,
 * date-separated grouped bubbles, and a sticky composer. Opening the thread
 * marks it read; live member replies arrive via `useMessagesRealtime`.
 */
export function ConversationThread({ memberId, memberName, memberEmail }: ConversationThreadProps) {
  const { user } = useSession();
  const threadQuery = useConversationThread(memberId);
  const sendMutation = useSendStaffMessage(memberId);
  const markReadMutation = useMarkConversationRead(memberId);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const markedRef = useRef(false);

  const messages: Message[] = useMemo(
    () => (threadQuery.data?.pages.flatMap((page) => page.items) ?? []).slice().reverse(),
    [threadQuery.data],
  );
  const items = useMemo(() => buildThreadItems(messages), [messages]);

  // Latest-message scrolling: open-at-latest on first load and per member,
  // follow new arrivals only when the reader is near the bottom, always jump
  // after the user's own send (see submit below).
  const { scrollToLatest } = useScrollToLatest(threadRef, messages.length, memberId);

  const resolvedName =
    memberName ?? messages.find((m) => m.senderType === 'MEMBER')?.senderName ?? 'Member';
  const resolvedEmail = memberEmail ?? '';

  // Mark the thread read on first successful load (idempotent server-side).
  // Draft/composer state resets per member via the `key` the workspace sets on
  // this component.
  useEffect(() => {
    if (markedRef.current) return;
    if (!threadQuery.isSuccess || threadQuery.data.pages.length === 0) return;
    markedRef.current = true;
    markReadMutation.mutate(undefined);
  }, [threadQuery.isSuccess, threadQuery.data, markReadMutation]);

  // Composer auto-grow: follow content up to the cap so the box never
  // scrolls internally (direct DOM write only - no state, no extra render).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = capComposerHeight(el.scrollHeight);
    if (next !== null) el.style.height = `${next}px`;
  }, [draft]);

  const canSend = draft.trim().length > 0 && draft.length <= MAX_LENGTH;

  const submit = () => {
    if (!canSend || sendMutation.isPending) return;
    sendMutation.mutate(draft, {
      onSuccess: () => {
        setDraft('');
        scrollToLatest();
      },
      onError: (error) => {
        notifyError({
          title: 'Could not send reply',
          message: error instanceof ApiError ? error.message : 'We could not send your message.',
        });
      },
    });
  };

  return (
    <section className={styles.pane} aria-label={`Conversation with ${resolvedName}`}>
      <header className={styles.header}>
        <Link to="/admin/messages" className={styles.back} aria-label="Back to inbox">
          <Icon name="chevron-left" size={20} />
        </Link>
        <span className={styles.avatar} aria-hidden="true">
          {getInitials(resolvedName)}
        </span>
        <div className={styles.identity}>
          <span className={styles.name}>{resolvedName}</span>
          {resolvedEmail ? <span className={styles.email}>{resolvedEmail}</span> : null}
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void threadQuery.refetch()}
          disabled={threadQuery.isFetching}
        >
          {threadQuery.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className={styles.thread} ref={threadRef} data-testid="message-thread">
        {threadQuery.isLoading ? (
          <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : threadQuery.isError ? (
          <ErrorState
            error={threadQuery.error}
            title="Could not load this conversation"
            onRetry={() => void threadQuery.refetch()}
          />
        ) : messages.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <Icon name="message" size={22} />
            </span>
            <p className={styles.emptyTitle}>No messages yet</p>
            <p className={styles.emptyText}>Send the first message to start this conversation.</p>
          </div>
        ) : (
          <>
            {threadQuery.hasNextPage ? (
              <div className={styles.loadOlder}>
                <Button
                  variant="ghost"
                  onClick={() => void threadQuery.fetchNextPage()}
                  disabled={threadQuery.isFetchingNextPage}
                >
                  {threadQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
                </Button>
              </div>
            ) : null}
            <ol className={styles.items}>
              {items.map((item) => {
                if (item.kind === 'day') {
                  return (
                    <li key={item.key} className={styles.daySeparator}>
                      <span>{item.label}</span>
                    </li>
                  );
                }
                const staff = item.message.senderType === 'STAFF';
                return (
                  <li
                    key={item.key}
                    className={`${styles.row} ${staff ? styles.rowStaff : styles.rowMember} ${
                      item.firstOfGroup ? styles.rowFirst : ''
                    }`}
                  >
                    {!staff ? (
                      item.firstOfGroup ? (
                        <span className={styles.bubbleAvatar} aria-hidden="true">
                          {getInitials(item.message.senderName)}
                        </span>
                      ) : (
                        <span className={styles.bubbleAvatarSpacer} aria-hidden="true" />
                      )
                    ) : null}
                    <div className={styles.bubbleWrap}>
                      {item.firstOfGroup ? (
                        <span className={styles.sender}>{item.message.senderName}</span>
                      ) : null}
                      <div
                        className={`${styles.bubble} ${staff ? styles.bubbleStaff : styles.bubbleMember} ${
                          item.lastOfGroup ? styles.bubbleLast : ''
                        }`}
                      >
                        <p className={styles.body}>{item.message.body}</p>
                      </div>
                      {item.lastOfGroup ? (
                        <span className={styles.time}>
                          {formatRelativeTime(item.message.createdAt)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <div className={styles.composer}>
        <label className={styles.composerLabel} htmlFor="staff-message-draft">
          Reply as {user?.name ?? 'you'}
        </label>
        <textarea
          id="staff-message-draft"
          ref={composerRef}
          className={styles.composerInput}
          value={draft}
          maxLength={MAX_LENGTH}
          rows={3}
          placeholder="Write a reply…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className={styles.composerFooter}>
          <span className={styles.hint}>Enter to send · Shift + Enter for a new line</span>
          <span className={styles.counter}>
            {draft.length}/{MAX_LENGTH}
          </span>
          <Button onClick={submit} disabled={!canSend || sendMutation.isPending}>
            {sendMutation.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </div>
    </section>
  );
}
