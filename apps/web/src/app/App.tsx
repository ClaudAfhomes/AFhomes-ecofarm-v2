import { env } from '../lib/env';
import styles from './App.module.css';

/**
 * Public-site shell.
 *
 * Phase 1 scope is the staff operations console (apps/admin). The public site
 * has no implemented routes yet, so this is a deliberately minimal placeholder:
 * it establishes the mount, providers, and design-system wiring that later
 * phases build on, without inventing screens or content.
 */
export default function App() {
  return (
    <main className={styles.shell}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={styles.title}>Public site under construction</h1>
        <p className={styles.body}>
          Phase 1 delivers the staff operations console. Public pages will be added in a later
          phase.
        </p>
        <a className={styles.adminLink} href={env.VITE_ADMIN_URL}>
          Staff administration
        </a>
      </div>
    </main>
  );
}
