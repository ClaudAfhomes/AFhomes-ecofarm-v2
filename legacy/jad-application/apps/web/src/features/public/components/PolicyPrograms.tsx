import { usePrograms } from '../hooks/usePrograms';
import styles from './PolicyPrograms.module.css';

/**
 * Live programs list embedded in policy content via the `{{programs}}` token
 * (`GET /programs`, PUBLIC). Rendered as plain structured content so it
 * inherits the policy page's text styling.
 */
export function PolicyProgramsList() {
  const { data, isPending } = usePrograms();
  if (isPending) return <p className={styles.muted}>Loading programs…</p>;
  if (!data || data.length === 0) return null;
  return (
    <ul className={styles.list}>
      {data.map((program) => (
        <li key={program.id} className={styles.item}>
          <span className={styles.name}>{program.name}</span>
          <span className={styles.code}>{program.code}</span>
          {program.description ? <p className={styles.description}>{program.description}</p> : null}
        </li>
      ))}
    </ul>
  );
}
