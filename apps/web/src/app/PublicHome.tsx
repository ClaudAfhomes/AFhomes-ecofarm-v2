import { Link } from 'react-router';

import { env } from '../lib/env';
import styles from './PublicHome.module.css';

/**
 * Public landing placeholder.
 *
 * A marketing site is explicitly out of scope for this phase, so this stays
 * minimal: it identifies the platform, links to the customer portal, and points
 * staff at the administration console. It invents no content, no programmes and
 * no marketing claims.
 */
export function PublicHome() {
  return (
    <main className={styles.shell}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={styles.title}>Public site under construction</h1>
        <p className={styles.body}>
          This phase delivers the customer portal. Public pages will be added in a later phase.
        </p>
        <div className={styles.links}>
          <Link className={styles.portalLink} to="/customer/login">
            Customer portal
          </Link>
          <a className={styles.adminLink} href={env.VITE_ADMIN_URL} rel="noreferrer">
            Staff administration
          </a>
        </div>
      </div>
    </main>
  );
}
