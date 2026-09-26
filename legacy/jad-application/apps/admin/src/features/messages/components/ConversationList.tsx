import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { ErrorState, Icon, Skeleton, getInitials } from '@jad/ui';

import { formatRelativeTime } from '../../../lib/format';
import { useAdminConversations } from '../hooks/useConversations';
import styles from './ConversationList.module.css';

type ConversationsQuery = ReturnType<typeof useAdminConversations>;

interface ConversationListProps {
  query: ConversationsQuery;
  selectedId?: string;
}

function ListSkeleton() {
  return (
    <ul className={styles.list}>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className={styles.skeletonItem}>
          <Skeleton />
        </li>
      ))}
    </ul>
  );
}

/**
 * Member-conversation inbox (left pane / mobile list). One row per member with
 * a thread: avatar initials, last-message preview, relative time, and an
 * unread pill. Rows are links; the selected row is highlighted.
 */
export function ConversationList({ query, selectedId }: ConversationListProps) {
  const [search, setSearch] = useState('');

  const all = useMemo(() => [...(query.data ?? [])], [query.data]);
  const unreadTotal = all.reduce((sum, c) => sum + c.unreadCount, 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.memberName.toLowerCase().includes(q) || c.memberEmail.toLowerCase().includes(q),
    );
  }, [all, search]);

  return (
    <section className={styles.pane} aria-label="Conversations">
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Messages</h1>
          {unreadTotal > 0 ? (
            <span className={styles.unreadTotal}>{unreadTotal} unread</span>
          ) : null}
        </div>
        <label className={styles.searchBox}>
          <span className={styles.searchIcon} aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <span className={styles.srOnly}>Search conversations</span>
          <input
            type="search"
            placeholder="Search by member"
            aria-label="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </label>
        <p className={styles.count} aria-live="polite">
          {query.isLoading
            ? 'Loading conversations…'
            : `Showing ${filtered.length} of ${all.length} ${all.length === 1 ? 'conversation' : 'conversations'}`}
        </p>
      </header>

      <div className={styles.body}>
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : all.length === 0 ? (
          <div className={styles.state}>
            <span className={styles.stateIcon} aria-hidden="true">
              <Icon name="message" size={22} />
            </span>
            <p className={styles.stateTitle}>No conversations</p>
            <p className={styles.stateText}>
              Member messages will appear here when members reach out.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>No matches</p>
            <p className={styles.stateText}>No conversations match your search.</p>
            <button type="button" className={styles.inlineLink} onClick={() => setSearch('')}>
              Clear search
            </button>
          </div>
        ) : (
          <ul className={styles.list}>
            {filtered.map((conversation) => {
              const selected = conversation.memberId === selectedId;
              return (
                <li key={conversation.memberId}>
                  <Link
                    to={`/admin/messages/${conversation.memberId}`}
                    className={`${styles.item} ${selected ? styles.itemSelected : ''}`}
                    aria-current={selected ? 'page' : undefined}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {getInitials(conversation.memberName)}
                    </span>
                    <span className={styles.itemMain}>
                      <span className={styles.itemTop}>
                        <span className={styles.itemName}>{conversation.memberName}</span>
                        <span className={styles.itemTime}>
                          {conversation.lastMessageAt
                            ? formatRelativeTime(conversation.lastMessageAt)
                            : ''}
                        </span>
                      </span>
                      <span className={styles.itemPreview}>
                        {conversation.lastMessagePreview ?? 'Start the conversation'}
                      </span>
                    </span>
                    {conversation.unreadCount > 0 ? (
                      <span
                        className={styles.itemBadge}
                        aria-label={`${conversation.unreadCount} unread`}
                      >
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
