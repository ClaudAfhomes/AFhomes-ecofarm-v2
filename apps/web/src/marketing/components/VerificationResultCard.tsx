import type { PublicSaleTeamSearchResult, SaleTeamSearchConfig } from '@afhomes/contracts';
import { AccreditationId } from '@afhomes/ui';
import styles from './VerificationResultCard.module.css';

function ContactIcon({ kind }: { kind: 'email' | 'phone' | 'check' }) {
  return (
    <span
      className={`${styles.icon} ${kind === 'phone' ? styles.phoneIcon : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        {kind === 'email' ? (
          <>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m3 6 9 7 9-7" fill="none" stroke="white" strokeWidth="1.5" />
          </>
        ) : kind === 'phone' ? (
          <path d="m6 2 4 5-2 3c1 3 3 5 6 6l3-2 5 4c-1 4-3 5-6 4C8 20 4 16 2 8 1 5 2 3 6 2Z" />
        ) : (
          <>
            <path d="M5 2h10l5 5v15H5z" />
            <path d="M15 2v6h5M8 12h8M8 16h8" fill="none" stroke="white" strokeWidth="1.4" />
          </>
        )}
      </svg>
    </span>
  );
}
function BankAccount({ name, account }: { name: string; account: string }) {
  const normalized = name.toUpperCase().replace(/[^A-Z]/g, '');
  const logo =
    normalized === 'SECURITYBANK'
      ? 'security-bank'
      : normalized === 'CHINABANK'
        ? 'chinabank'
        : null;
  return (
    <div className={styles.bankCard}>
      <div className={styles.bankBrand}>
        {logo ? <img src={`/images/banks/${logo}.svg`} alt={name} /> : <strong>{name}</strong>}
      </div>
      <div className={styles.account}>
        <span>Account Number:</span>
        <strong>{account}</strong>
      </div>
    </div>
  );
}
export function VerificationResultCard({
  result,
  config,
  failedPhotoUrl,
  onPhotoError,
  onEnlarge,
}: {
  result: PublicSaleTeamSearchResult;
  config: SaleTeamSearchConfig;
  failedPhotoUrl: string | null;
  onPhotoError: () => void;
  onEnlarge: () => void;
}) {
  return (
    <article aria-label="Verified sales team member" className={styles.card}>
      <div className={styles.identity}>
        <span className={styles.badge}>Employee Identity</span>
        <div className={styles.identityRow}>
          <button
            type="button"
            aria-label="Enlarge profile photo"
            className={styles.photo}
            disabled={!result.photoUrl || failedPhotoUrl === result.photoUrl}
            onClick={onEnlarge}
          >
            <span aria-hidden="true">{result.maskedName.charAt(0)}</span>
            {result.photoUrl && failedPhotoUrl !== result.photoUrl ? (
              <img src={result.photoUrl} alt={result.maskedName} onError={onPhotoError} />
            ) : null}
          </button>
          <div role="group" aria-label="Seller identity" className={styles.identityText}>
            <h2>{result.maskedName}</h2>
            <div aria-label={`AA number ${result.aaNumber}`}>
              <AccreditationId value={result.aaNumber} />
            </div>
          </div>
        </div>
        <dl className={styles.status} data-testid="accreditation-details">
          <div>
            <dt>Verification Status</dt>
            <dd>Accredited</dd>
          </div>
        </dl>
      </div>
      <section className={styles.support} aria-labelledby="support-heading">
        <h3 id="support-heading">{config.supportHeading}</h3>
        <div className={styles.contacts}>
          <a
            href={`mailto:${config.supportEmail}`}
            aria-label={`Email: ${config.supportEmail}`}
            className={styles.email}
          >
            <ContactIcon kind="email" />
            <span>{config.supportEmail}</span>
          </a>
          <a
            href={`tel:${config.supportPhone.replace(/[^+\d]/g, '')}`}
            aria-label={`Phone: ${config.supportPhone}`}
            className={styles.phone}
          >
            <ContactIcon kind="phone" />
            <span>{config.supportPhone}</span>
          </a>
        </div>
        <div className={styles.banks}>
          <h3>OFFICIAL COMPANY BANK ACCOUNTS:</h3>
          <p>
            Bank Account Name: <strong>{config.bankHolder}</strong>
          </p>
          <div className={styles.bankGrid}>
            <BankAccount name={config.bank1Name} account={config.bank1Account} />
            <BankAccount name={config.bank2Name} account={config.bank2Account} />
          </div>
        </div>
        <div className={styles.checkInstructions}>
          <ContactIcon kind="check" />
          <div>
            <p>
              For check payments, please make the check payable to:{' '}
              <strong>{config.checkPayee}</strong>
            </p>
            <p className={styles.bankReminder}>{config.bankReminder}</p>
          </div>
        </div>
      </section>
      <p className={styles.agentReminder}>{config.agentReminder}</p>
    </article>
  );
}
