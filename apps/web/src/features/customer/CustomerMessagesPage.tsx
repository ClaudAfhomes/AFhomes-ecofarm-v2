import { useState, type FormEvent } from 'react';
import { Button, ErrorState } from '@afhomes/ui';

import {
  useConversationQuery,
  useConversationsQuery,
  usePostMessage,
  useStartConversation,
} from './engagement';
import { formatDateTime } from './CustomerNotificationsPage';
import { Card } from './portal-ui';
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

function ThreadList({ onOpen, onCompose }: { onOpen: (id: string) => void; onCompose: () => void }) {
  const query = useConversationsQuery();
  return (
    <Card title="Messages" actions={<Button onClick={onCompose}>New message</Button>}>
      {query.isLoading ? (
        <p role="status">Loading your messages…</p>
      ) : query.isError ? (
        <ErrorState
          title="Messages unavailable"
          message="We could not load your messages. Please try again in a moment."
        />
      ) : (query.data ?? []).length === 0 ? (
        <p className={styles.hint}>No messages yet. Use New message to write to AF Homes.</p>
      ) : (
        <ul className={styles.list}>
          {(query.data ?? []).map((c) => (
            <li key={c.id} className={`${styles.item} ${c.unread ? styles.itemUnread : ''}`}>
              <div className={styles.itemHead}>
                <button type="button" className={styles.linkButton} onClick={() => onOpen(c.id)}>
                  <strong>{c.subject}</strong>
                </button>
                <span className={styles.meta}>{formatDateTime(c.lastMessageAt)}</span>
              </div>
              {c.unread && <p className={styles.meta}>New reply from AF Homes</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewMessage({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  onSent: (id: string) => void;
}) {
  const start = useStartConversation();
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
    <Card title="New message">
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label}>
          Subject
          <input
            className={styles.control}
            value={subject}
            maxLength={150}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className={styles.label}>
          Message
          <textarea
            className={styles.control}
            rows={5}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {start.isError && (
          <p className={styles.error} role="alert">
            {errorText(start.error)}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={!ready || start.isPending}>
            Send
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Back
          </Button>
        </div>
        {!ready && <p className={styles.hint}>Add a subject (3+ characters) and a message.</p>}
      </form>
    </Card>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useConversationQuery(id);
  const post = usePostMessage(id);
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
    <Card
      title={query.data?.subject ?? 'Message'}
      actions={
        <Button variant="secondary" onClick={onBack}>
          All messages
        </Button>
      }
    >
      {query.isLoading ? (
        <p role="status">Loading the conversation…</p>
      ) : query.isError || !query.data ? (
        <ErrorState
          title="Conversation unavailable"
          message="We could not load this conversation. Please try again in a moment."
        />
      ) : (
        <>
          <div className={styles.thread}>
            {query.data.messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.bubble} ${m.senderKind === 'customer' ? styles.bubbleMine : styles.bubbleStaff}`}
              >
                <p className={styles.sender}>
                  {m.senderKind === 'customer' ? 'You' : (m.senderName ?? 'AF Homes')} ·{' '}
                  {formatDateTime(m.createdAt)}
                </p>
                <p className={styles.body}>{m.body}</p>
              </div>
            ))}
          </div>
          <form className={styles.form} onSubmit={send}>
            <label className={styles.label}>
              Reply
              <textarea
                className={styles.control}
                rows={3}
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {post.isError && (
              <p className={styles.error} role="alert">
                {errorText(post.error)}
              </p>
            )}
            <div>
              <Button type="submit" disabled={!body.trim() || post.isPending}>
                Send
              </Button>
              {!body.trim() && <p className={styles.hint}>Write a reply to send it.</p>}
            </div>
          </form>
        </>
      )}
    </Card>
  );
}
