import { useId } from 'react';
import { Button } from '@afhomes/ui';
import {
  GOVERNMENT_ID_TYPE_LABELS,
  paymentSchemeLabel,
  type ApplicationHolder,
  type GenealogyNode,
  type GovernmentIdType,
  type PaymentScheme,
} from '@afhomes/contracts';
import type { RecommenderFields } from './official-forms-fields';
import styles from './ApplicationReview.module.css';

type Item = { label: string; value?: string | null; required?: boolean };
function ReviewSection({
  title,
  items,
  onEdit,
}: {
  title: string;
  items: Item[];
  onEdit: () => void;
}) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.heading}>
        <h3 id={id}>{title}</h3>
        <Button variant="secondary" onClick={onEdit} aria-label={`Edit ${title}`}>
          Edit
        </Button>
      </div>
      <dl className={styles.details}>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd data-missing={Boolean(!item.value && item.required)}>
              {item.value ||
                (item.required ? 'Required — not provided' : 'Not provided (optional)')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const personal: [keyof ApplicationHolder, string, boolean?][] = [
  ['firstName', 'First name', true],
  ['middleName', 'Middle name'],
  ['lastName', 'Last name', true],
  ['suffix', 'Suffix'],
  ['birthDate', 'Birth date', true],
  ['sex', 'Sex'],
  ['citizenship', 'Citizenship'],
  ['civilStatus', 'Civil status'],
  ['printedName', 'Printed name', true],
  ['raNumber', 'RA Number (Customer ID)'],
];
const address: [keyof ApplicationHolder, string, boolean?][] = [
  ['permanentAddressLine1', 'House / unit and street', true],
  ['permanentAddressLine2', 'Address line 2'],
  ['barangay', 'Barangay'],
  ['cityMunicipality', 'City / municipality', true],
  ['province', 'Province', true],
  ['postalCode', 'Postal code'],
];
const contact: [keyof ApplicationHolder, string, boolean?][] = [
  ['mobile', 'Mobile', true],
  ['landline', 'Landline'],
  ['email', 'Email', true],
];
const work: [keyof ApplicationHolder, string, boolean?][] = [
  ['tinNumber', 'TIN'],
  ['occupationBusinessName', 'Occupation / business'],
  ['officeBusinessAddress', 'Office / business address'],
  ['businessIndustry', 'Business / industry'],
  ['employedPosition', 'Employed position'],
];
const holderItems = (holder: ApplicationHolder, fields: typeof personal): Item[] =>
  fields.map(([key, label, required]) => ({ label, required, value: holder[key] }));

export function ApplicationReview({
  primary,
  secondary,
  planName,
  tier,
  paymentScheme,
  idType,
  idNumber,
  idFilename,
  kind,
  nodes,
  meta,
  channels,
  consent,
  onEdit,
}: {
  primary: ApplicationHolder;
  secondary: ApplicationHolder | null;
  planName?: string;
  tier: string;
  paymentScheme: PaymentScheme;
  idType: string;
  idNumber: string;
  idFilename?: string;
  kind: 'OST' | 'IST';
  nodes: readonly GenealogyNode[];
  meta: Parameters<typeof RecommenderFields>[0]['meta'];
  channels: string[];
  consent: boolean;
  onEdit: (step: number, target?: string) => void;
}) {
  const selectedId =
    kind === 'OST' ? meta.referrerStaffId : meta.smStaffId || meta.ssmStaffId || meta.svdStaffId;
  const selected = nodes.find((node) => node.staffId === selectedId);
  const name = (id: string) =>
    id
      ? (nodes.find((node) => node.staffId === id)?.fullName ?? 'Unavailable — return to Network')
      : '';
  return (
    <div className={styles.review}>
      <header>
        <h2 tabIndex={-1}>Review your application</h2>
        <p>Check each section before submitting. Edit any section without losing your entries.</p>
      </header>
      {[primary, ...(secondary ? [secondary] : [])].map((holder, index) => (
        <div className={styles.holder} key={holder.holderType}>
          {index > 0 ? <h2>Secondary cardholder</h2> : null}
          <ReviewSection
            title={index ? 'Secondary personal information' : 'Customer personal information'}
            items={holderItems(holder, personal)}
            onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-personal`)}
          />
          <ReviewSection
            title={index ? 'Secondary address information' : 'Address information'}
            items={holderItems(holder, address)}
            onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-address`)}
          />
          <ReviewSection
            title={index ? 'Secondary contact information' : 'Contact information'}
            items={holderItems(holder, contact)}
            onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-contact`)}
          />
          <ReviewSection
            title={index ? 'Secondary other details' : 'Other personal and employment details'}
            items={holderItems(holder, work)}
            onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-work`)}
          />
        </div>
      ))}
      <ReviewSection
        title="Government ID information"
        items={[
          {
            label: 'ID type',
            value: GOVERNMENT_ID_TYPE_LABELS[idType as GovernmentIdType] ?? idType,
            required: true,
          },
          { label: 'ID number', value: idNumber },
          { label: 'Government ID image', value: idFilename, required: true },
        ]}
        onEdit={() => onEdit(1, 'step-identity')}
      />
      <ReviewSection
        title="Application details"
        items={[
          { label: 'VIP plan', value: planName, required: true },
          { label: 'Tier', value: tier, required: true },
          { label: 'Payment scheme', value: paymentSchemeLabel(paymentScheme), required: true },
          { label: 'Acknowledged at', value: meta.acknowledgedAt },
        ]}
        onEdit={() => onEdit(0, 'step-application')}
      />
      <ReviewSection
        title="Network information"
        items={[
          { label: 'IST/OST', value: kind },
          { label: 'Referring member', value: name(selectedId) },
          {
            label: 'Direct Head',
            value: selected
              ? selected.uplineStaffId
                ? name(selected.uplineStaffId)
                : 'No Direct Head assigned'
              : '',
          },
          { label: 'SVD', value: name(meta.svdStaffId) },
          { label: 'SSM', value: name(meta.ssmStaffId) },
          { label: 'SM', value: name(meta.smStaffId) },
          { label: 'Referrer', value: name(meta.referrerStaffId) },
          { label: 'VIP recommender', value: meta.vipRecommenderName },
          { label: 'Recommender contact', value: meta.recommenderContact },
          { label: 'Recommender email', value: meta.recommenderEmail },
        ]}
        onEdit={() => onEdit(3, 'step-recommender')}
      />
      <ReviewSection
        title="Acquisition channel"
        items={[{ label: 'Channels', value: channels.join(', ') }]}
        onEdit={() => onEdit(4, 'step-channel')}
      />
      <ReviewSection
        title="Certification"
        items={[
          { label: 'Certification and consent', value: consent ? 'Confirmed' : '', required: true },
        ]}
        onEdit={() => onEdit(5, 'step-cert')}
      />
    </div>
  );
}
