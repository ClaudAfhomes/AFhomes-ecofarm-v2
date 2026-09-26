import { Fragment, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton, useScrollToLatest } from '@jad/ui';
import type { Message } from '@jad/contracts';

import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/ButtonLink';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { useSession } from '../../../lib/session';
import {
  useMarkMessagesRead,
  useMessagesPage,
  useMessagesSummary,
  useSendMessage,
} from '../hooks/useMember';
import { formatDate, formatTime } from '../lib/presentation';
import styles from './MessagesPage.module.css';

const dayOf = (iso: string): string => new Date(iso).toDateString();

/** Day divider label for the thread - Today / Yesterday / full date. */
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatDate(iso);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return formatDate(iso);
}

/**
 * Messages (SCR-MEM Messages, FEAT-072, ADR-013). One thread with the JA&D
 * admin team, newest-first via the API but rendered oldest→newest (standard
 * chat). Live staff replies arrive via `useMessagesRealtime`; opening the
 * thread marks it read (member watermark). Sends are optimistic-free: the
 * mutation posts, then the thread + summary queries invalidate.
 */
export function MessagesPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const threadQuery = useMessagesPage();
  const summaryQuery = useMessagesSummary();
  const sendMutation = useSendMessage();
  const markReadMutation = useMarkMessagesRead();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement | null>(null);
  const markedRef = useRef(false);

  // Mark the thread read on first successful load when there are unread
  // staff replies (idempotent server-side; ref-guard prevents repeats).
  useEffect(() => {
    if (markedRef.current) return;
    if (!threadQuery.isSuccess || threadQuery.data.pages.length === 0) return;
    if (summaryQuery.data && summaryQuery.data.unreadCount > 0) {
      markedRef.current = true;
      markReadMutation.mutate(undefined, {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ['member', 'messages', 'summary', user?.id],
          });
        },
      });
    }
  }, [
    threadQuery.isSuccess,
    threadQuery.data,
    summaryQuery.data,
    markReadMutation,
    queryClient,
    user?.id,
  ]);

  // Scroll to the newest message on open; follow new arrivals only while
  // the reader is near the bottom; always jump after the user's own send.
  const messages: Message[] = (threadQuery.data?.pages.flatMap((page) => page.items) ?? [])
    .slice()
    .reverse();
  const { scrollToLatest } = useScrollToLatest(threadRef, messages.length);
  const now = new Date();

  const canSend = draft.trim().length > 0 && draft.length <= 4000;

  const submit = () => {
    if (!canSend || sendMutation.isPending) return;
    setSendError(undefined);
    sendMutation.mutate(
      { body: draft },
      {
        onSuccess: () => {
          setDraft('');
          scrollToLatest();
        },
        onError: (error) => {
          setSendError(apiErrorMessage(error, 'We could not send your message.'));
        },
      },
    );
  };

  return (
    <section>
      <PageHeader
        title="Messages"
        description="One-to-one chat with the JA&D admin team."
        actions={
          <ButtonLink to="/member" variant="ghost">
            ← Back to Dashboard
          </ButtonLink>
        }
      />

      {sendError ? (
        <Alert variant="danger" title="Something went wrong">
          {sendError}
        </Alert>
      ) : null}

      <div className={styles.conversation}>
        <header className={styles.conversationHeader}>
          <span className={styles.teamAvatar} aria-hidden="true">
            <Icon name="message" size={18} />
          </span>
          <div className={styles.identity}>
            <h2 className={styles.identityName}>JA&D Admin Team</h2>
            <p className={styles.identityNote}>
              Support from the JA&D admin team - replies arrive right here.
            </p>
          </div>
        </header>

        <div className={styles.thread} ref={threadRef} aria-live="polite" data-testid="message-thread">
          {threadQuery.isLoading ? (
            <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
              <div className={styles.skeletonRow}>
                <Skeleton className={styles.skeletonBubble} style={{ width: '55%' }} />
              </div>
              <div className={styles.skeletonRowOwn}>
                <Skeleton className={styles.skeletonBubble} style={{ width: '40%' }} />
              </div>
              <div className={styles.skeletonRow}>
                <Skeleton className={styles.skeletonBubble} style={{ width: '68%' }} />
              </div>
            </div>
          ) : threadQuery.isError ? (
            <ErrorState
              error={threadQuery.error}
              title="Could not load messages"
              onRetry={() => void threadQuery.refetch()}
            />
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
              {messages.length === 0 ? (
                <div className={styles.empty}>
                  <EmptyState
                    title="No messages yet"
                    description="Ask the JA&D admin team anything - they will reply right here."
                  />
                </div>
              ) : (
                <ul className={styles.list}>
                  {messages.map((message, index) => {
                    const own = message.senderType === 'MEMBER';
                    const previous = messages[index - 1];
                    const showDay =
                      !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
                    return (
                      <Fragment key={message.id}>
                        {showDay ? (
                          <li className={styles.dayDivider}>
                            <span>{dayLabel(message.createdAt, now)}</span>
                          </li>
                        ) : null}
                        <li className={`${styles.row} ${own ? styles.rowOwn : styles.rowStaff}`}>
                          {!own ? (
                            <span className={styles.threadAvatar} aria-hidden="true">
                              {(message.senderName.trim()[0] ?? 'A').toUpperCase()}
                            </span>
                          ) : null}
                          <div
                            className={`${styles.bubble} ${own ? styles.bubbleOwn : styles.bubbleStaff}`}
                          >
                            <p className={styles.sender}>{own ? 'You' : message.senderName}</p>
                            <p className={styles.body}>{message.body}</p>
                            <time className={styles.meta} dateTime={message.createdAt}>
                              {formatTime(message.createdAt)}
                            </time>
                          </div>
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <div className={styles.composer}>
          <label className={styles.composerLabel} htmlFor="message-draft">
            New message
          </label>
          <div className={styles.composerRow}>
            <textarea
              id="message-draft"
              className={styles.composerInput}
              value={draft}
              maxLength={4000}
              rows={2}
              placeholder="Write a message to the JA&D admin team…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <Button onClick={submit} disabled={!canSend || sendMutation.isPending}>
              {sendMutation.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
          <div className={styles.composerFooter}>
            <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
            <span className={styles.counter}>{draft.length}/4000</span>
          </div>
        </div>
      </div>
    </section>
  );
}
