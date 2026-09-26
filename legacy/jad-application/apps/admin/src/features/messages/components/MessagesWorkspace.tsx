import { useParams } from 'react-router';

import { Icon, useMediaQuery } from '@jad/ui';

import { useAdminConversations } from '../hooks/useConversations';
import { ConversationList } from './ConversationList';
import { ConversationThread } from './ConversationThread';
import styles from './MessagesWorkspace.module.css';

/**
 * Admin Messages surface. Mobile: list, then thread on selection. Desktop
 * (≥1024px): a two-pane master-detail - inbox left, thread right - so staff
 * move between members without losing their place.
 */
export function MessagesWorkspace() {
  const { memberId } = useParams<{ memberId?: string }>();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const query = useAdminConversations();
  const selected = memberId ? query.data?.find((c) => c.memberId === memberId) : undefined;

  if (!isDesktop) {
    return memberId ? (
      <ConversationThread
        key={memberId}
        memberId={memberId}
        memberName={selected?.memberName}
        memberEmail={selected?.memberEmail}
      />
    ) : (
      <ConversationList query={query} />
    );
  }

  return (
    <div className={styles.workspace}>
      <ConversationList query={query} selectedId={memberId} />
      <div className={styles.detail}>
        {memberId ? (
          <ConversationThread
            key={memberId}
            memberId={memberId}
            memberName={selected?.memberName}
            memberEmail={selected?.memberEmail}
          />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.placeholderIcon} aria-hidden="true">
              <Icon name="message" size={26} />
            </span>
            <p className={styles.placeholderTitle}>Select a conversation</p>
            <p className={styles.placeholderText}>
              Choose a member on the left to read and reply to their thread.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
