import { useQuery } from '@tanstack/react-query';

import { getGlobalCmsPublic } from '@/lib/cms';
import { MESSENGER_URL } from '../features/public/content';
import styles from './MessengerButton.module.css';

/**
 * Persistent floating "Let's Talk" Messenger link, rendered by the shared
 * public layout so it appears on every public page. Uses an inline SVG
 * (project convention - no icon library) and a real anchor with an explicit
 * accessible label, target, and rel for safe external navigation.
 *
 * The white icon + label are pinned via explicit `:link`/`:visited`/`:hover`/
 * `:active`/`:focus`/`:focus-visible` overrides - the global `a:visited`
 * rule would otherwise recolor the link brand-blue after it has been visited.
 */
export function MessengerButton() {
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const messengerUrl = globalCms?.messenger?.url ?? MESSENGER_URL;
  const messengerLabel = globalCms?.messenger?.label ?? 'Let\u2019s Talk';
  const messengerAriaLabel =
    globalCms?.messenger?.ariaLabel ?? 'Message JA&D Realty Services on Messenger';
  return (
    <a
      className={styles.button}
      href={messengerUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={messengerAriaLabel}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13" />
      </svg>
      <span className={styles.label}>{messengerLabel}</span>
    </a>
  );
}
