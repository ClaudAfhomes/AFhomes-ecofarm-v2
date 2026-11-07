import { ErrorState, StatusChip, type StatusTone, Button } from '@afhomes/ui';
import { useState } from 'react';

import { useCustomerProfileQuery } from './queries';
import { isForbidden } from './http';
import { Card, Field, FieldList, formatDate, styles } from './portal-ui';
import { ProfilePhotoCard } from './ProfilePhotoCard';

/**
 * The member's own profile.
 *
 * Identity details remain READ-ONLY, and the read model it renders is the
 * narrow one the API returns. There is no edit form, so there is no question of a
 * browser writing to `customers`. Profile photos use a separate authorized Storage API.
 *
 * Deliberately absent, and never fetched: the government ID number, the
 * government ID type, identity document storage paths, the staff member who
 * created the record, referral identifiers and any audit metadata. The API
 * cannot return them, and the database additionally withholds those columns from
 * the browser roles altogether.
 */
export function CustomerProfilePage() {
  const profile = useCustomerProfileQuery();
  const [codeCopied, setCodeCopied] = useState(false);

  /**
   * The Customer Code is the customer's OWN reference code, shown so they can
   * quote it at a desk. Copying it is a convenience only: it is not a credential
   * and nothing in the portal accepts it in place of a sign-in.
   */
  const copyCustomerCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      setCodeCopied(false);
    }
  };

  if (profile.isLoading) return <p role="status">Loading your profile…</p>;
  if (profile.isError) {
    return (
      <ErrorState
        title="Profile unavailable"
        message={
          isForbidden(profile.error)
            ? 'This sign-in is not linked to a customer record.'
            : 'We could not load your profile. Please try again in a moment.'
        }
      />
    );
  }

  const customer = profile.data!;
  const address = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.city, customer.province].filter(Boolean).join(', '),
    customer.countryCode,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n');

  return (
    <>
      <ProfilePhotoCard />
      <Card title="Your details">
        <FieldList>
          <Field label="Customer ID" value={customer.customerNumber} />
          {customer.customerCode ? (
            <Field
              label="Customer Code"
              value={
                <>
                  <code>{customer.customerCode}</code>{' '}
                  <Button
                    variant="secondary"
                    onClick={() => void copyCustomerCode(customer.customerCode!)}
                  >
                    {codeCopied ? 'Copied' : 'Copy Customer Code'}
                  </Button>
                </>
              }
            />
          ) : null}
          <Field label="Full name" value={customer.fullName} />
          <Field label="First name" value={customer.firstName} />
          <Field label="Middle name" value={customer.middleName ?? '—'} />
          <Field label="Last name" value={customer.lastName} />
          <Field label="Suffix" value={customer.suffix ?? '—'} />
        </FieldList>
      </Card>

      <Card title="Contact">
        <FieldList>
          <Field label="Email" value={customer.email} />
          <Field label="Phone" value={customer.phone} />
          <Field label="Date of birth" value={formatDate(customer.dateOfBirth)} />
          <Field
            label="Status"
            value={<StatusChip label={customer.status} tone={toneFor(customer.status)} />}
          />
        </FieldList>
        <p className={styles.notice}>
          To correct any of these, contact AFhomes Ecofarm. Your account details are maintained by
          the branch that registered you.
        </p>
      </Card>

      {address && (
        <Card title="Address">
          <p className={styles.fieldValue} style={{ whiteSpace: 'pre-line' }}>
            {address}
          </p>
        </Card>
      )}

      <Card title="Account">
        <FieldList>
          <Field label="Account created" value={formatDate(customer.updatedAt)} />
          <Field
            label="Portal access"
            value={customer.status === 'active' ? 'Active' : customer.status}
          />
        </FieldList>
      </Card>
    </>
  );
}

const toneFor = (status: string): StatusTone =>
  status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'neutral';
