import { useId, useState } from 'react';
import { Alert, Button, Dialog } from '@afhomes/ui';
import {
  GOVERNMENT_ID_TYPE_LABELS,
  paymentSchemeLabel,
  type ApplicationHolder,
  type GenealogyNode,
  type GovernmentIdType,
  type PaymentScheme,
  type CardProduct,
  type ApplicationRaDraft,
} from '@afhomes/contracts';
import type { RecommenderFields } from './official-forms-fields';
import styles from './ApplicationReview.module.css';
import v4 from './CustomerApplicationV4.module.css';
import { downloadFile } from '../../lib/download';
import { applicationPdf, printApplicationPages, renderApplicationPaper } from './application-print';
import { draftReservationPaper, reservationPdf } from './reservation-print';

type Item = { label: string; value?: string | null; required?: boolean };
function ReviewSection({
  title,
  items,
  onEdit,
  compact = false,
}: {
  compact?: boolean;
  title: string;
  items: Item[];
  onEdit: () => void;
}) {
  const id = useId();
  return (
    <section className={compact ? v4.reviewbox : styles.section} aria-labelledby={id}>
      <div className={compact ? v4.rtop : styles.heading}>
        <h3 className={compact ? v4.reviewTitle : undefined} id={id}>
          {title}
        </h3>
        <Button variant="secondary" onClick={onEdit} aria-label={`Edit ${title}`}>
          Edit
        </Button>
      </div>
      <dl className={compact ? undefined : styles.details}>
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
  ['prefix', 'Prefix'],
  ['firstName', 'First name', true],
  ['middleName', 'Middle name'],
  ['lastName', 'Last name', true],
  ['suffix', 'Suffix'],
  ['birthDate', 'Birth date', true],
  ['printedName', 'Printed name', true],
  ['raNumber', 'Customer ID'],
];
const contact: [keyof ApplicationHolder, string, boolean?][] = [
  ['mobile', 'Mobile', true],
  ['landline', 'Landline'],
  ['email', 'Email', true],
];
const address: [keyof ApplicationHolder, string, boolean?][] = [
  ['permanentAddressLine1', 'House / unit and street', true],
  ['permanentAddressLine2', 'Address line 2'],
  ['barangay', 'Barangay'],
  ['cityMunicipality', 'City / municipality', true],
  ['province', 'Province', true],
  ['postalCode', 'Postal code'],
];
const identity: [keyof ApplicationHolder, string, boolean?][] = [
  ['sex', 'Sex'],
  ['citizenship', 'Citizenship'],
  ['civilStatus', 'Civil status'],
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
  raDraft,
  separateRaReview = false,
  primary,
  secondary,
  planName,
  plan,
  tier,
  paymentScheme,
  idType,
  idNumber,
  idFilename,
  nodes,
  meta,
  channels,
  consent,
  validId = false,
  referenceLayout = false,
  onEdit,
}: {
  raDraft?: ApplicationRaDraft;
  separateRaReview?: boolean;
  primary: ApplicationHolder;
  secondary: ApplicationHolder | null;
  planName?: string;
  plan?: CardProduct;
  tier: string;
  paymentScheme: PaymentScheme;
  idType: string;
  idNumber: string;
  idFilename?: string;
  nodes: readonly GenealogyNode[];
  meta: Parameters<typeof RecommenderFields>[0]['meta'];
  channels: string[];
  consent: boolean;
  validId?: boolean;
  referenceLayout?: boolean;
  onEdit: (step: number, target?: string) => void;
}) {
  const name = (id: string) =>
    id
      ? (nodes.find((node) => node.staffId === id)?.fullName ?? 'Unavailable — return to Network')
      : '';
  const [paper, setPaper] = useState<string[] | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [printing, setPrinting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const createPaper = () =>
    renderApplicationPaper({
      primary,
      secondary,
      planName,
      tier,
      paymentScheme,
      idType: GOVERNMENT_ID_TYPE_LABELS[idType as GovernmentIdType] ?? idType,
      idNumber,
      recommender: meta.vipRecommenderName,
      recommenderAaNumber: meta.recommenderAaNumber,
      recommenderContact: meta.recommenderContact,
      recommenderEmail: meta.recommenderEmail,
      referrer: name(meta.referrerStaffId),
      referrerAaNumber: meta.referrerAaNumber,
      svd: name(meta.svdStaffId),
      ssm: name(meta.ssmStaffId),
      sm: name(meta.smStaffId),
      acknowledgedAt: meta.acknowledgedAt,
      channels,
      consent,
    });
  const documentAction = async (download: boolean) => {
    setDocumentError('');
    setPreparing(true);
    try {
      const pages = await createPaper();
      if (download) downloadFile(applicationPdf(pages));
      else setPaper(pages);
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'Application document could not be created.',
      );
    } finally {
      setPreparing(false);
    }
  };
  const downloadRa = async () => {
    setDocumentError('');
    setPreparing(true);
    try {
      downloadFile(
        await reservationPdf(draftReservationPaper(primary, secondary, tier, paymentScheme, plan, raDraft)),
      );
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'Reservation form could not be created.',
      );
    } finally {
      setPreparing(false);
    }
  };
  return (
    <div className={referenceLayout ? v4.stepContent : styles.review}>
      {!referenceLayout ? (
        <header>
          <h2 tabIndex={-1}>Review your application</h2>
          <p>Check each section before submitting. Edit any section without losing your entries.</p>
        </header>
      ) : null}
      <div className={referenceLayout ? v4.reviewTools : styles.documentActions}>
        {referenceLayout ? (
          <p className={v4.subtle}>
            Check what will be submitted. You can edit any section or preview the paper application.
          </p>
        ) : null}
        <div className={referenceLayout ? v4.reviewActions : styles.documentActions}>
          <Button
            className={referenceLayout ? v4.btn : undefined}
            variant="secondary"
            disabled={preparing}
            onClick={() => void documentAction(false)}
          >
            Print Application
          </Button>
          <Button
            className={referenceLayout ? `${v4.btn} ${v4.primary}` : undefined}
            variant="secondary"
            disabled={preparing}
            onClick={() => void documentAction(true)}
          >
            Download PDF
          </Button>
          {!separateRaReview ? <Button
            className={referenceLayout ? v4.btn : undefined}
            variant="secondary"
            disabled={preparing}
            onClick={() => void downloadRa()}
          >
            Download RA form
          </Button> : null}
        </div>
      </div>
      <p className={referenceLayout ? v4.sr : styles.documentHint}>
        Unsigned copy of your current entries. Printing or downloading does not submit the
        application. The RA form is preliminary; entered document details remain unverified until
        recorded.
      </p>
      {documentError ? <Alert variant="danger">{documentError}</Alert> : null}
      <Dialog
        open={paper !== null}
        onClose={() => setPaper(null)}
        title="Customer Application print preview"
        footer={
          <Button
            loading={printing}
            onClick={async () => {
              if (!paper) return;
              setPrinting(true);
              try {
                await printApplicationPages(paper);
              } catch (error) {
                setDocumentError(error instanceof Error ? error.message : 'Printing failed.');
              } finally {
                setPrinting(false);
              }
            }}
          >
            Print Application
          </Button>
        }
      >
        <p>A4 portrait · Blank signature and date lines · Not submitted or approved</p>
        {documentError ? <Alert variant="danger">{documentError}</Alert> : null}
        <div className={styles.paperPreview}>
          {paper?.map((src, index) => (
            <img key={index} src={src} alt={`Unsigned Customer Application, page ${index + 1}`} />
          ))}
        </div>
      </Dialog>
      {referenceLayout ? (
        <>
          <div className={v4.reviewgrid}>
            <ReviewSection
              compact
              title="Application"
              items={[
                { label: 'VIP plan', value: planName, required: true },
                { label: 'Payment scheme', value: paymentSchemeLabel(paymentScheme) },
              ]}
              onEdit={() => onEdit(0)}
            />
            <ReviewSection
              compact
              title="Identity"
              items={[
                {
                  label: 'ID type',
                  value: GOVERNMENT_ID_TYPE_LABELS[idType as GovernmentIdType] ?? idType,
                },
                { label: 'Evidence', value: idFilename, required: true },
                { label: 'ID number', value: idNumber },
              ]}
              onEdit={() => onEdit(1)}
            />
            <ReviewSection
              compact
              title="Primary holder"
              items={[
                {
                  label: 'Full name',
                  value: [
                    primary.prefix,
                    primary.firstName,
                    primary.middleName,
                    primary.lastName,
                    primary.suffix,
                  ]
                    .filter(Boolean)
                    .join(' '),
                  required: true,
                },
                { label: 'Date of birth', value: primary.birthDate },
                { label: 'Mobile', value: primary.mobile },
                { label: 'Email', value: primary.email },
              ]}
              onEdit={() => onEdit(2, 'primary-personal')}
            />
            <ReviewSection
              compact
              title="Address & additional"
              items={[
                {
                  label: 'Address',
                  value: [
                    primary.permanentAddressLine1,
                    primary.permanentAddressLine2,
                    primary.barangay,
                    primary.cityMunicipality,
                    primary.province,
                    primary.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', '),
                },
                { label: 'Customer ID', value: primary.raNumber || 'Server-generated' },
                { label: 'Printed name', value: primary.printedName },
              ]}
              onEdit={() => onEdit(2, 'primary-address')}
            />
            <ReviewSection
              compact
              title="Network"
              items={[
                { label: 'Referring member', value: meta.referrerAaNumber },
                {
                  label: 'VIP recommender',
                  value: meta.recommenderAaNumber || meta.vipRecommenderName,
                },
                { label: 'Acknowledged at', value: meta.acknowledgedAt },
              ]}
              onEdit={() => onEdit(3)}
            />
            <ReviewSection
              compact
              title="Acquisition channel & certification"
              items={[
                { label: 'Channels', value: channels.join(', ') },
                { label: 'Privacy consent', value: consent ? 'Confirmed' : 'Missing' },
                { label: 'ID acknowledgement', value: validId ? 'Confirmed' : 'Not checked' },
              ]}
              onEdit={() => onEdit(4)}
            />
          </div>
          {secondary ? (
            <div className={v4.infobar}>
              Optional secondary cardholder:{' '}
              {[secondary.prefix, secondary.firstName, secondary.lastName]
                .filter(Boolean)
                .join(' ') || 'Not completed'}
              .{' '}
              <button
                type="button"
                className={v4.textlink}
                onClick={() => onEdit(2, 'secondary-personal')}
              >
                Edit secondary
              </button>
            </div>
          ) : null}
          <div className={v4.notice}>
            <strong>Submission does not mean approval.</strong> Once submitted, authorized staff
            review the application and purchase terms. Reservation and payment processing happen
            afterward.
          </div>
        </>
      ) : (
        <>
          {[primary, ...(secondary ? [secondary] : [])].map((holder, index) => (
            <div className={styles.holder} key={holder.holderType}>
              {index > 0 ? <h2>Secondary cardholder</h2> : null}
              <ReviewSection
                title={index ? 'Secondary personal information' : 'Customer personal information'}
                items={holderItems(holder, personal)}
                onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-personal`)}
              />
              <ReviewSection
                title={index ? 'Secondary contact information' : 'Contact information'}
                items={holderItems(holder, contact)}
                onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-contact`)}
              />
              <ReviewSection
                title={index ? 'Secondary address information' : 'Address information'}
                items={holderItems(holder, address)}
                onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-address`)}
              />
              <ReviewSection
                title={index ? 'Secondary identity information' : 'Identity'}
                items={holderItems(holder, identity)}
                onEdit={() => onEdit(2, `${holder.holderType.toLowerCase()}-identity`)}
              />
              <ReviewSection
                title={index ? 'Secondary additional information' : 'Additional Information'}
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
              { label: 'Referrer AA number', value: meta.referrerAaNumber },
              { label: 'Referrer', value: name(meta.referrerStaffId) },
              { label: 'VIP recommender AA number', value: meta.recommenderAaNumber },
              { label: 'VIP recommender', value: meta.vipRecommenderName },
              { label: 'Recommender mobile', value: meta.recommenderContact },
              { label: 'Recommender email', value: meta.recommenderEmail },
              { label: 'SVD', value: name(meta.svdStaffId) },
              { label: 'SSM', value: name(meta.ssmStaffId) },
              { label: 'SM', value: name(meta.smStaffId) },
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
              {
                label: 'Certification and consent',
                value: consent ? 'Confirmed' : '',
                required: true,
              },
            ]}
            onEdit={() => onEdit(5, 'step-cert')}
          />
        </>
      )}
    </div>
  );
}
