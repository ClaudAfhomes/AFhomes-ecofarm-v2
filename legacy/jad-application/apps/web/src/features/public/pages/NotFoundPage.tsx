import { ButtonLink } from '../../../components/ButtonLink';
import styles from './NotFoundPage.module.css';

/** Friendly not-found state for unmatched routes (FRONTEND-ARCHITECTURE §3; UI-UX §10). */
export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <div className="container">
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.lead}>The page you are looking for has moved or doesn’t exist.</p>
        <div className={styles.ctaRow}>
          <ButtonLink to="/" variant="primary">
            Back to Home
          </ButtonLink>
          <ButtonLink to="/properties" variant="outlineLight">
            Explore Properties
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
