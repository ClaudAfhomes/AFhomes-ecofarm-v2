import { Icon } from './Icon.js';
import styles from './PasswordChecklist.module.css';

export interface PasswordChecklistItem {
  id: string;
  /** Short, stable rule label (e.g. "One digit"). */
  label: string;
  met: boolean;
}

export interface PasswordChecklistProps {
  items: PasswordChecklistItem[];
}

/**
 * Live password-rule checklist: one row per rule with a green check when the
 * rule is met and a red x while it is missing. Presentation only - callers
 * compute `items` (e.g. from `@jad/shared#passwordRuleStates`) on every
 * keystroke and keep their submit-time validator as the authority.
 */
export function PasswordChecklist({ items }: PasswordChecklistProps) {
  return (
    <ul className={styles.list} aria-label="Password requirements">
      {items.map((item) => (
        <li
          key={item.id}
          className={`${styles.row} ${item.met ? styles.met : styles.unmet}`}
          data-met={item.met}
        >
          <Icon name={item.met ? 'check' : 'close'} size={16} />
          <span>{item.label}</span>
          <span className="sr-only">{item.met ? '(met)' : '(missing)'}</span>
        </li>
      ))}
    </ul>
  );
}
