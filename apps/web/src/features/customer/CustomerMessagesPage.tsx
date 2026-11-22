import { useId, useState, type FormEvent } from 'react';
import { Button, EmptyState, ErrorState, Icon } from '@afhomes/ui';

import {
  useConversationQuery,
  useConversationsQuery,
  usePostMessage,
  useStartConversation,
} from './engagement';
import { formatDateTime } from './CustomerNotificationsPage';
import { ActivityListSkeleton, PortalSection, ui } from './portal-ui';
import styles from './engagement.module.css';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function CustomerMessagesPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  if (openId) return <Thread id={openId} onBack={() => setOpenId(null)} />;
  if (composing) {
    return (
      <NewMessage
        onCancel={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          setOpenId(id);
        }}
      />
    );
  }
  return <ThreadList onOpen={setOpenId} onCompose={() => setComposing(true)} />;
}

function ThreadList({
  onOpen,
  onCompose,
}: {
  onOpen: (id: string) => void;
  onCompose: () => void;
}) {
  const query = useConversationsQuery();
  const uid = useId();
  const conversations = query.data ?? [];
  return (
    <div className={styles.page}>
      <PortalSection
        title="Messages"
        description="Your conversations with AF Homes."
        action={
          <Button size="lg" onClick={onCompose}>
            New message
          </Button>
        }
      >
        {query.isLoading ? (
          <div className={`${ui.surface} ${styles.panel}`}>
            <p role="status" className="sr-only">
              Loading your messages…
            </p>
            <div aria-hidden="true">
              <ActivityListSkeleton rows={3} />
            </div>
          </div>
        ) : query.isError ? (
          <ErrorState
            title="Messages unavailable"
            message="We could not load your messages. Please try again in a moment."
          />
        ) : conversations.length === 0 ? (
          <div className={`${ui.surface} ${styles.panel}`}>
            <EmptyState
              title="No messages yet."
              description="Use New message to write to AF Homes."
            />
          </div>
        ) : (
          <ul className={`${ui.surface} ${styles.rows}`} aria-label="Conversations">
            {conversations.map((c) => {
              const tagId = `${uid}-${c.id}-unread`;
              return (
                <li
                  key={c.id}
                  className={`${styles.rowItem} ${c.unread ? styles.rowItemUnread : ''}`}
                >
                  <span className={styles.dotSlot} aria-hidden="true">
                    {c.unread ? <span className={styles.unreadDot} /> : null}
                  </span>
                  <div className={styles.rowMain}>
                    <div className={styles.rowHead}>
                      <button
                        type="button"
                        className={`${styles.rowButton} ${c.unread ? styles.rowButtonUnread : ''}`}
                        aria-describedby={c.unread ? tagId : undefined}
                        onClick={() => onOpen(c.id)}
                      >
                        {c.subject}
                      </button>
                      <time className={styles.rowTime} dateTime={c.lastMessageAt}>
                        {formatDateTime(c.lastMessageAt)}
                      </time>
                    </div>
                    {c.unread && (
                      <span id={tagId} className={styles.unreadTag}>
                        New reply from AF Homes
                      </span>
                    )}
                  </div>
                  <span className={styles.chev} aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PortalSection>
    </div>
  );
}

function NewMessage({ onCancel, onSent }: { onCancel: () => void; onSent: (id: string) => void }) {
  const start = useStartConversation();
  const uid = useId();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // One id per composed message; reused if the member retries after a failure.
  const [requestId] = useState(() => crypto.randomUUID());
  const ready = subject.trim().length >= 3 && body.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    start.mutate(
      { requestId, subject: subject.trim(), body: body.trim() },
      { onSuccess: (c) => onSent(c.id) },
    );
  };

  return (
    <div className={styles.page}>
      <PortalSection
        title="New message"
        description="Write to AF Homes. Replies appear in your messages."
      >
        <div className={`${ui.surface} ${styles.panel}`}>
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-subject`}>
                Subject
              </label>
              <input
                id={`${uid}-subject`}
                className={styles.control}
                value={subject}
                maxLength={150}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-body`}>
                Message
              </label>
              <textarea
                id={`${uid}-body`}
                className={styles.control}
                rows={6}
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {start.isError && (
              <p className={styles.error} role="alert">
                <Icon name="alert" size={16} />
                <span>{errorText(start.error)}</span>
              </p>
            )}
            <div className={styles.submitRow}>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  size="lg"
                  className={styles.fullMobile}
                  disabled={!ready}
                  loading={start.isPending}
                  loadingLabel="Sending…"
                  aria-describedby={!ready ? `${uid}-hint` : undefined}
                >
                  Send
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  className={styles.fullMobile}
                  onClick={onCancel}
                >
                  Back
                </Button>
              </div>
              {!ready && (
                <p id={`${uid}-hint`} className={styles.hint}>
                  Add a subject (3+ characters) and a message.
                </p>
              )}
            </div>
          </form>
        </div>
      </PortalSection>
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useConversationQuery(id);
  const post = usePostMessage(id);
  const uid = useId();
  const [body, setBody] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    post.mutate(
      { requestId, body: body.trim() },
      {
        onSuccess: () => {
          setBody('');
          setRequestId(crypto.randomUUID());
        },
      },
    );
  };

  return (
    <div className={styles.page}>
      <PortalSection
        title={query.data?.subject ?? 'Message'}
        action={
          <Button variant="secondary" size="lg" onClick={onBack}>
            All messages
          </Button>
        }
      >
        {query.isLoading ? (
          <div className={`${ui.surface} ${styles.panel}`}>
            <p role="status" className="sr-only">
              Loading the conversation…
            </p>
            <div aria-hidden="true">
              <ActivityListSkeleton rows={3} />
            </div>
          </div>
        ) : query.isError || !query.data ? (
          <ErrorState
            title="Conversation unavailable"
            message="We could not load this conversation. Please try again in a moment."
          />
        ) : (
          <>
            <ol className={styles.convo} aria-label="Conversation">
              {query.data.messages.map((m) => {
                const mine = m.senderKind === 'customer';
                return (
                  <li
                    key={m.id}
                    className={`${styles.msg} ${mine ? styles.msgMine : styles.msgStaff}`}
                  >
                    <p className={styles.msgMeta}>
                      <span className={styles.msgName}>
                        {mine ? 'You' : (m.senderName ?? 'AF Homes')}
                      </span>
                      {!mine && m.senderName ? (
                        <span className={styles.roleTag}>AF Homes staff</span>
                      ) : null}
                      <time dateTime={m.createdAt} className={ui.numeric}>
                        {formatDateTime(m.createdAt)}
                      </time>
                    </p>
                    <p className={styles.msgBubble}>{m.body}</p>
                  </li>
                );
              })}
            </ol>
            <form className={styles.composer} onSubmit={send}>
              <label className={styles.label} htmlFor={`${uid}-reply`}>
                Reply
              </label>
              <textarea
                id={`${uid}-reply`}
                className={styles.control}
                rows={3}
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {post.isError && (
                <p className={styles.error} role="alert">
                  <Icon name="alert" size={16} />
                  <span>{errorText(post.error)}</span>
                </p>
              )}
              <div className={styles.composerFoot}>
                {!body.trim() ? (
                  <p id={`${uid}-hint`} className={styles.hint}>
                    Write a reply to send it.
                  </p>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  size="lg"
                  className={styles.fullMobile}
                  disabled={!body.trim()}
                  loading={post.isPending}
                  loadingLabel="Sending…"
                  aria-describedby={!body.trim() ? `${uid}-hint` : undefined}
                >
                  Send
                </Button>
              </div>
            </form>
          </>
        )}
      </PortalSection>
    </div>
  );
}
