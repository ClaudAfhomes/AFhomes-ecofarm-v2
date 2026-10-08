import { downloadFile as saveFile } from '../../lib/download';
import { HumanInput as NormalizedInput } from '../../lib/HumanInput';
import { HumanInputValidity } from '../../lib/human-input-validity';
import { useCallback, useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type {
  ActivationResult,
  ApplicationHolder,
  PurchaseDocumentKind,
  PurchaseReservation,
} from '@afhomes/contracts';
import {
  createCustomerApplicationSchema,
  canTransitionCustomerApplication,
  registerCustomerApplicationSchema,
  createReservationAgreementSchema,
  optionalContactNumberSchema,
  birthDateSchema,
  paymentSchemeLabel,
  governmentIdTypeSchema,
  optionalLandlineSchema,
} from '@afhomes/contracts';
import { formatDateTime } from '../../lib/format';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { useSession } from '../../lib/session';
import { downloadFile } from '../../lib/download';
import { formatMoney } from './format';
import {
  Alert,
  Button,
  IdCapturePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  StatusChip,
} from '@afhomes/ui';

import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { normalizeLiveHumanField } from '../../lib/normalize';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getDocumentAccessUrl,
  getDocuments,
  getCurrentDocument,
  completeDocumentUpload,
  confirmDocument,
  putUploadBytes,
  requestUploadGrant,
  runDocumentOcr,
} from '../documents/services';
import {
  createCustomerApplication,
  registerCustomerApplication,
  createReservationAgreement,
  decideCustomerApplication,
  decideReservationAgreement,
  exportCustomerApplication,
  exportReservationAgreement,
  getCardProducts,
  getCustomerApplication,
  getCustomerApplications,
  getCustomers,
  getOfficialFormTemplate,
  getPurchaseTermsProposal,
  getReservationPayments,
  getReservationFinance,
  activateSale,
  exportPurchaseDocument,
  finalizeReservationPurchase,
  getReservationAgreement,
  getReservationAgreements,
  getSaleSummary,
  getSales,
  previewOfficialFormImport,
  reopenCustomerApplication,
  reopenReservationAgreement,
  reviewApplicationPurchaseTerms,
  submitCustomerApplication,
  submitReservationAgreement,
  updateCustomerApplication,
  updateReservationAgreement,
  updateApplicationReservation,
} from './services';

const today = () => new Date().toISOString().slice(0, 10);
const emptyHolder = (holderType: 'PRIMARY' | 'SECONDARY'): ApplicationHolder => ({
  holderType,
  lastName: '',
  firstName: '',
  birthDate: '',
  permanentAddressLine1: '',
  cityMunicipality: '',
  province: '',
  mobile: '',
  email: '',
  printedName: '',
});
const asBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function Field({
  normalize,
  suggestName = false,
  optionalPhone = false,
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  normalize?: (value: string) => string;
  suggestName?: boolean;
  optionalPhone?: boolean;
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const isPhone = optionalPhone || /mobile|contact|landline/i.test(label);
  const isName =
    suggestName || /^(?:first|last|middle|printed|primary|secondary) name$/i.test(label);
  // HumanInput owns contact/name errors; only date validation belongs here.
  const validator = /birth date/i.test(label) ? birthDateSchema : null;
  const error =
    touched &&
    Boolean(validator && !validator.safeParse(value).success && (required || value !== ''));
  const errorMessage = 'Enter a valid past birth date.';
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span id={`${id}-label`}>{label}</span>
      <NormalizedInput
        landline={/landline/i.test(label)}
        normalize={normalize}
        suggestName={isName}
        type={isPhone ? 'tel' : /email/i.test(label) ? 'email' : type}
        inputMode={isPhone ? 'tel' : undefined}
        value={value}
        required={required}
        aria-labelledby={`${id}-label`}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
      />
      {error ? (
        <small id={`${id}-error`} role="alert">
          {errorMessage}
        </small>
      ) : null}
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const todayValue = new Date().toISOString().slice(0, 10);
  const error = touched && (required || value !== '') && !birthDateSchema.safeParse(value).success;
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span id={`${id}-label`}>{label}</span>
      <input
        type="date"
        aria-labelledby={`${id}-label`}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        max={todayValue}
        required={required}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
      />
      {error ? (
        <small id={`${id}-error`} role="alert">
          Enter a valid past birth date in YYYY-MM-DD format.
        </small>
      ) : null}
    </label>
  );
}

function HolderFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: ApplicationHolder;
  onChange: (value: ApplicationHolder) => void;
}) {
  const set = (key: keyof ApplicationHolder, next: string) => onChange({ ...value, [key]: next });
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="form-grid">
        <Field
          label="Last name"
          value={value.lastName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('lastName', v)}
          onChange={(v) => set('lastName', v)}
          required
        />
        <Field
          label="First name"
          value={value.firstName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('firstName', v)}
          onChange={(v) => set('firstName', v)}
          required
        />
        <Field
          label="Middle name"
          value={value.middleName ?? ''}
          suggestName
          normalize={(v) => normalizeLiveHumanField('middleName', v)}
          onChange={(v) => set('middleName', v)}
        />
        <Field
          label="Suffix"
          value={value.suffix ?? ''}
          normalize={(v) => normalizeLiveHumanField('suffix', v)}
          onChange={(v) => set('suffix', v)}
        />
        <DateField
          label="Birth date"
          value={value.birthDate}
          onChange={(v) => set('birthDate', v)}
          required
        />
        <Field
          label="Sex"
          value={value.sex ?? ''}
          normalize={(v) => normalizeLiveHumanField('sex', v)}
          onChange={(v) => set('sex', v)}
        />
        <Field
          label="Citizenship"
          value={value.citizenship ?? ''}
          normalize={(v) => normalizeLiveHumanField('citizenship', v)}
          onChange={(v) => set('citizenship', v)}
        />
        <Field
          label="Civil status"
          value={value.civilStatus ?? ''}
          normalize={(v) => normalizeLiveHumanField('civilStatus', v)}
          onChange={(v) => set('civilStatus', v)}
        />
        <Field
          label="Permanent address line 1"
          value={value.permanentAddressLine1}
          normalize={(v) => normalizeLiveHumanField('permanentAddressLine1', v)}
          onChange={(v) => set('permanentAddressLine1', v)}
          required
        />
        <Field
          label="Permanent address line 2"
          value={value.permanentAddressLine2 ?? ''}
          normalize={(v) => normalizeLiveHumanField('permanentAddressLine2', v)}
          onChange={(v) => set('permanentAddressLine2', v)}
        />
        <Field
          label="City / municipality"
          value={value.cityMunicipality}
          normalize={(v) => normalizeLiveHumanField('cityMunicipality', v)}
          onChange={(v) => set('cityMunicipality', v)}
          required
        />
        <Field
          label="Province"
          value={value.province}
          normalize={(v) => normalizeLiveHumanField('province', v)}
          onChange={(v) => set('province', v)}
          required
        />
        <Field
          label="Postal code"
          value={value.postalCode ?? ''}
          normalize={(v) => normalizeLiveHumanField('postalCode', v)}
          onChange={(v) => set('postalCode', v)}
        />
        <Field
          label="Landline"
          optionalPhone
          value={value.landline ?? ''}
          normalize={(v) => normalizeLiveHumanField('landline', v)}
          onChange={(v) => set('landline', v)}
        />
        <Field
          label="Mobile"
          value={value.mobile}
          normalize={(v) => normalizeLiveHumanField('mobile', v)}
          onChange={(v) => set('mobile', v)}
          required
        />
        <Field
          label="Email"
          value={value.email}
          normalize={(v) => normalizeLiveHumanField('email', v)}
          onChange={(v) => set('email', v)}
          type="email"
          required
        />
        <Field
          label="TIN"
          value={value.tinNumber ?? ''}
          normalize={(v) => normalizeLiveHumanField('tinNumber', v)}
          onChange={(v) => set('tinNumber', v)}
        />
        <Field
          label="Occupation / business"
          value={value.occupationBusinessName ?? ''}
          normalize={(v) => normalizeLiveHumanField('occupationBusinessName', v)}
          onChange={(v) => set('occupationBusinessName', v)}
        />
        <Field
          label="Office / business address"
          value={value.officeBusinessAddress ?? ''}
          normalize={(v) => normalizeLiveHumanField('officeBusinessAddress', v)}
          onChange={(v) => set('officeBusinessAddress', v)}
        />
        <Field
          label="Business / industry"
          value={value.businessIndustry ?? ''}
          normalize={(v) => normalizeLiveHumanField('businessIndustry', v)}
          onChange={(v) => set('businessIndustry', v)}
        />
        <Field
          label="Employed position"
          value={value.employedPosition ?? ''}
          normalize={(v) => normalizeLiveHumanField('employedPosition', v)}
          onChange={(v) => set('employedPosition', v)}
        />
        <Field
          label="Printed name"
          value={value.printedName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('printedName', v)}
          onChange={(v) => set('printedName', v)}
          required
        />
      </div>
    </fieldset>
  );
}

export function CustomerApplicationsPage() {
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['customer-applications', status, tier, debouncedSearch, from, to],
    queryFn: () =>
      getCustomerApplications({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    // Application decisions happen in review screens and other sessions.
    refetchInterval: 30_000,
  });
  return (
    <section>
      <PageHeader
        title="Customer Applications"
        description="Official application transactions. Submitted snapshots remain independent of later customer master-data edits."
        actions={<Link to="/admin/customers/applications/new">New application</Link>}
      />
      <FilterBar
        search={
          <SearchField
            label="Search applications"
            placeholder="Application number"
            value={search}
            onChange={setSearch}
            busy={query.isPending}
          />
        }
        filters={
          <>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {['draft', 'submitted', 'approved', 'rejected', 'cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tier
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All</option>
                {['BRONZE', 'SILVER', 'GOLD'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        }
      />
      {query.isPending ? (
        <p role="status">Loading applications…</p>
      ) : query.isError ? (
        <ErrorState title="Applications could not be loaded" onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Application</th>
                <th>Applicant</th>
                <th>Tier</th>
                <th>Seller</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((app) => (
                <tr key={app.id}>
                  <td>
                    <Link to={`/admin/customers/applications/${app.id}`}>
                      {app.applicationNumber}
                    </Link>
                  </td>
                  <td>{app.applicantName ?? '—'}</td>
                  <td>{app.tier}</td>
                  <td>{app.createdBy ?? '—'}</td>
                  <td>
                    <StatusChip label={app.status} />
                  </td>
                  <td>{app.submittedAt ?? '—'}</td>
                  <td>{app.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No customer applications"
          description="Create the first official application draft."
        />
      )}
    </section>
  );
}

/**
 * Raw Zod issues (`customerId: Invalid uuid`) are never user-facing.
 * Known selector/field failures map to actionable guidance; anything else
 * keeps its path but with a readable message.
 */
export function humanizeApplicationIssues(issues: { path: PropertyKey[]; message: string }[]) {
  return issues
    .map((issue) => {
      const [head, ...rest] = issue.path;
      if (head === 'customerId') return 'Select a customer for this application.';
      if (head === 'planId') return 'Select a VIP plan for this application.';
      if (head === 'saleId') return 'Select a sale for this reservation.';
      if (head === 'customerApplicationId')
        return 'This reservation must stay linked to its customer application.';
      const tail = [head, ...rest].filter((p) => typeof p === 'string').join('.');
      return tail ? `${tail}: ${issue.message}` : issue.message;
    })
    .join(' ');
}

export function CustomerApplicationEditorPage() {
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const reportValidity = useCallback((field: string, invalid: boolean) => {
    setInvalidFields((current) =>
      current[field] === invalid ? current : { ...current, [field]: invalid },
    );
  }, []);
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const existing = useQuery({
    queryKey: ['customer-application', id],
    queryFn: () => getCustomerApplication(id!),
    enabled: Boolean(id),
  });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => getCustomers() });
  const plans = useQuery({ queryKey: ['card-products'], queryFn: () => getCardProducts() });
  // The server-authoritative offer. Nothing on this screen computes a price: the
  // proposal below is what the operator sees AND what the submit/review calls
  // echo back as `expectedProposalHash`.
  const proposal = useQuery({
    queryKey: ['purchase-terms-proposal', id],
    queryFn: () => getPurchaseTermsProposal(id!),
    enabled: Boolean(id),
    retry: false,
  });
  const [applicationSearch] = useSearchParams();
  const [customerId, setCustomerId] = useState(() => applicationSearch.get('customerId') ?? '');
  const [planId, setPlanId] = useState('');
  const [tier, setTier] = useState<'BRONZE' | 'SILVER' | 'GOLD'>('BRONZE');
  const [paymentScheme, setPaymentScheme] = useState<
    'spot_cash' | 'move_a' | 'installment_4_month' | 'move_b1_40_12' | 'move_b2_25_12'
  >('spot_cash');
  const [primary, setPrimary] = useState(() => emptyHolder('PRIMARY'));
  const [secondary, setSecondary] = useState<ApplicationHolder | null>(null);
  const [meta, setMeta] = useState({
    salesManagerName: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    vipReferrer: '',
    acknowledgedAt: today(),
  });
  const [channels, setChannels] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [validId, setValidId] = useState(false);
  const [paymentProof, setPaymentProof] = useState(false);
  const [message, setMessage] = useState('');
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [idType, setIdType] = useState('');
  const runSave = useSingleFlight<Awaited<ReturnType<typeof createCustomerApplication>>>();
  const applicationRequest = useMutationRequest();
  const [pickerVersion, setPickerVersion] = useState(0);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: ['documents', 'customer', customerId],
    queryFn: () => getDocuments({ subjectType: 'customer', subjectId: customerId }),
    enabled: Boolean(customerId),
    retry: false,
  });
  const currentDocument = useQuery({
    queryKey: ['documents', 'current', 'customer', customerId],
    queryFn: () => getCurrentDocument({ subjectType: 'customer', subjectId: customerId }),
    enabled: Boolean(customerId),
    retry: false,
  });
  // There is no current document when the server says none, including all-rejected histories.
  const serverCurrentDocument =
    currentDocument.data?.isCurrent === true &&
    currentDocument.data.hasFile &&
    currentDocument.data.verificationStatus !== 'rejected'
      ? currentDocument.data
      : null;
  const uploadId = useMutation({
    mutationFn: async (pendingDocumentId?: string) => {
      if (pendingDocumentId) {
        const document = await completeDocumentUpload(pendingDocumentId);
        if (!document.hasFile) throw new Error('Upload is still incomplete.');
        return { documentId: document.id, filename: document.originalFilename };
      }
      if (!ocrFile || !customerId) throw new Error('Select a customer and ID file first.');
      const mime = ACCEPTED_MIME.find((value) => value === ocrFile.type);
      if (!mime || !ocrFile.size || ocrFile.size > MAX_BYTES)
        throw new Error('Choose a non-empty JPEG, PNG or PDF up to 10 MiB.');
      const grant = await requestUploadGrant({
        idType: governmentIdTypeSchema.parse(idType),
        subjectType: 'customer',
        subjectId: customerId,
        mime,
        sizeBytes: ocrFile.size,
        originalFilename: ocrFile.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, ocrFile);
      const document = await completeDocumentUpload(grant.documentId);
      if (!document.hasFile) throw new Error('Upload verification is still pending.');
      return { documentId: grant.documentId, filename: ocrFile.name };
    },
    onSuccess: async () => {
      setOcrFile(null);
      setPickerVersion((version) => version + 1);
      setIdPreview(null);
      setValidId(true);
      setMessage('Valid ID uploaded privately. Review before submitting.');
      // Wait for subject-wide authority; never promote a completion locally.
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Upload failed.'),
  });
  const previewId = useMutation({
    mutationFn: (documentId: string) => getDocumentAccessUrl(documentId),
    onSuccess: (grant) => setIdPreview(grant.url),
    onError: () => setMessage('ID preview unavailable. Try again.'),
  });
  const optionalPhonesValid =
    [meta.recommenderContact].every(
      (value) => optionalContactNumberSchema.safeParse(value).success,
    ) &&
    [primary.landline, secondary?.landline].every(
      (value) => optionalLandlineSchema.safeParse(value).success,
    );
  // WHY THIS IS A LIST AND NOT A `disabled` EXPRESSION.
  //
  // Submit used to be disabled by a silent nine-term `||`. The reported symptom
  // was "Submit cannot be clicked", and that grey button was the entire visible
  // explanation. Two of the terms were traps a user could not reason about: any
  // replacement ID photo stages `ocrFile`, which greys Submit until "Detect
  // fields" is pressed; and the ID-type gate needs a confirmed document. Neither
  // was stated anywhere on screen.
  //
  // A disabled control is also unfocusable, so a keyboard or screen-reader user
  // is not merely uninformed - the button does not exist for them at all.
  //
  // Same conditions, one derived list, rendered next to the button. Blocking is
  // unchanged; only the silence is removed. Transient states (a mutation in
  // flight) are deliberately NOT blockers - they are not something to fix.
  const submitBlockers: string[] = [];
  if (!consent) submitBlockers.push('Certification and consent must be ticked.');
  if (!serverCurrentDocument?.reviewedFields?.idType)
    submitBlockers.push('Record the ID type on the uploaded identity document.');
  if (ocrFile) submitBlockers.push('Run "Detect fields" to upload the selected ID photo.');
  if (!optionalPhonesValid)
    submitBlockers.push('Correct the recommender contact or landline number.');
  if (Object.values(invalidFields).some(Boolean))
    submitBlockers.push('Correct the highlighted fields.');
  useEffect(() => {
    const app = existing.data;
    if (!app) return;
    const timer = window.setTimeout(() => {
      setCustomerId(app.customerId);
      setPlanId(app.planId);
      setTier(app.tier);
      setPaymentScheme(app.paymentScheme);
      setPrimary(app.primary);
      setSecondary(app.secondary ?? null);
      setMeta({
        salesManagerName: app.salesManagerName ?? '',
        vipRecommenderName: app.vipRecommenderName ?? '',
        recommenderContact: app.recommenderContact ?? '',
        recommenderEmail: app.recommenderEmail ?? '',
        vipReferrer: app.vipReferrer ?? '',
        acknowledgedAt: app.acknowledgedAt,
      });
      setChannels(app.acquisitionChannels);
      setConsent(app.consentAcknowledged);
      setValidId(app.validIdReceived);
      setPaymentProof(app.reservationPaymentProofReceived);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [existing.data]);
  const payload = () => ({
    // Unchosen selectors stay absent: never send "" as a UUID.
    customerId: customerId || undefined,
    planId: planId || undefined,
    tier,
    paymentScheme,
    primary: { ...primary, holderType: 'PRIMARY' as const },
    secondary: secondary ? { ...secondary, holderType: 'SECONDARY' as const } : undefined,
    ...meta,
    acquisitionChannels: channels as (
      'CMP' | 'DRP' | 'GDP Corporate' | 'Walk-In' | 'GDP Public Servant' | 'Referral' | 'FB Ads'
    )[],
    consentAcknowledged: consent,
    primarySignatureStatus: 'received' as const,
    secondarySignatureStatus: secondary ? ('received' as const) : undefined,
    validIdReceived: validId,
    reservationPaymentProofReceived: paymentProof,
  });
  const save = useMutation({
    mutationFn: () =>
      runSave(async () => {
        if (!planId) {
          document
            .querySelector<HTMLSelectElement>(
              'select[aria-label="Customer"], select[name="customer"]',
            )
            ?.focus();
          throw new Error('Select a VIP plan before saving the registration application.');
        }
        if (!id && !customerId) {
          const registration = registerCustomerApplicationSchema.safeParse({
            ...payload(),
            registerNewCustomer: true,
          });
          if (!registration.success)
            throw new Error(humanizeApplicationIssues(registration.error.issues));
          return registerCustomerApplication({
            ...registration.data,
            requestId: applicationRequest.forPayload(registration.data),
          });
        }
        const checked = createCustomerApplicationSchema.safeParse(payload());
        if (!checked.success) {
          document
            .querySelector<HTMLInputElement>(
              '[aria-invalid="true"], input[required]:invalid, select[required]:invalid',
            )
            ?.focus();
          throw new Error(humanizeApplicationIssues(checked.error.issues));
        }
        return id
          ? updateCustomerApplication(id, checked.data)
          : createCustomerApplication({
              ...checked.data,
              requestId: applicationRequest.forPayload(checked.data),
            });
      }),
    onSuccess: (app) => {
      setMessage('Application saved as draft.');
      applicationRequest.complete();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
      if (!id) navigate(`/admin/customers/applications/${app.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save failed.'),
  });
  const submit = useMutation({
    mutationFn: async () => {
      const checked = createCustomerApplicationSchema.safeParse(payload());
      if (!checked.success) throw new Error(humanizeApplicationIssues(checked.error.issues));
      if (!checked.data.consentAcknowledged)
        throw new Error('Certification and consent are required.');
      // A lost Submit response must retry the transition, not edit a submitted record.
      const latest = await getCustomerApplication(id!);
      // The hash is fetched with the submit so it is always the offer the server
      // holds at this instant. A stale displayed offer is refused by the server.
      const offer = proposal.data;
      if (!offer) throw new Error('Load the purchase terms offer before confirming.');
      const confirmation = {
        requestId: applicationRequest.forPayload({
          applicationId: id,
          expectedProposalHash: offer.expectedProposalHash,
        }),
        expectedProposalHash: offer.expectedProposalHash,
      };
      if (latest.status === 'submitted') return submitCustomerApplication(id!, confirmation);
      await updateCustomerApplication(id!, checked.data);
      return submitCustomerApplication(id!, confirmation);
    },
    onSuccess: () => {
      setMessage('Customer application submitted successfully.');
      applicationRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Submit failed.'),
  });
  const importFile = async (file: File) => {
    const preview = await previewOfficialFormImport('customer_application', await asBase64(file));
    if (preview.errors.length) {
      setMessage(preview.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      return;
    }
    const f = preview.fields;
    setPrimary({
      ...primary,
      lastName: f.primary_last_name ?? '',
      firstName: f.primary_first_name ?? '',
      middleName: f.primary_middle_name,
      suffix: f.primary_suffix,
      birthDate: f.primary_birth_date ?? '',
      sex: f.primary_sex,
      citizenship: f.primary_citizenship,
      civilStatus: f.primary_civil_status,
      permanentAddressLine1: f.primary_address_line_1 ?? '',
      permanentAddressLine2: f.primary_address_line_2,
      cityMunicipality: f.primary_city_municipality ?? '',
      province: f.primary_province ?? '',
      postalCode: f.primary_postal_code,
      landline: f.primary_landline,
      mobile: f.primary_mobile ?? '',
      email: f.primary_email ?? '',
      tinNumber: f.primary_tin,
      occupationBusinessName: f.primary_occupation_business,
      officeBusinessAddress: f.primary_office_business_address,
      businessIndustry: f.primary_business_industry,
      employedPosition: f.primary_employed_position,
      printedName: `${f.primary_first_name ?? ''} ${f.primary_last_name ?? ''}`.trim(),
    });
    setTier((f.card_tier?.toUpperCase() || 'BRONZE') as typeof tier);
    setPaymentScheme((f.payment_scheme || 'spot_cash') as typeof paymentScheme);
    setChannels((f.acquisition_channels ?? '').split('|').filter(Boolean));
    setMessage('Imported candidates — please verify every field before saving.');
  };
  const ocr = useMutation({
    mutationFn: async () => {
      const documentId = ocrFile
        ? (await uploadId.mutateAsync()).documentId
        : serverCurrentDocument?.id;
      if (!documentId) throw new Error('Select an ID file first.');
      const doc = await runDocumentOcr(documentId);
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
      return doc;
    },
    onSuccess: (doc) => {
      const fields = doc.extractedFields;
      const confident = (key: string) => {
        const field = fields[key];
        return field && field.confidence !== null && field.confidence >= 0.8 ? field.value : null;
      };
      setPrimary((current) => ({
        ...current,
        firstName: current.firstName || confident('firstName') || '',
        middleName: current.middleName || confident('middleName') || undefined,
        lastName: current.lastName || confident('lastName') || '',
        birthDate: current.birthDate || confident('dateOfBirth') || '',
        permanentAddressLine1: current.permanentAddressLine1 || confident('address') || '',
      }));
      const suggestedType = governmentIdTypeSchema.safeParse(confident('idType'));
      if (suggestedType.success) setIdType((current) => current || suggestedType.data);
      setMessage(
        doc.ocrStatus === 'completed'
          ? 'OCR completed — review and correct suggestions before saving.'
          : 'OCR failed — Enter details manually. Your private upload is retained.',
      );
    },
    onError: (e) =>
      setMessage(e instanceof Error ? e.message : 'OCR failed; continue with manual entry.'),
  });
  const confirmIdType = useMutation({
    mutationFn: async () => {
      if (!serverCurrentDocument) throw new Error('Upload and verify an ID first.');
      const document = await confirmDocument(serverCurrentDocument.id, {
        decision: 'confirmed',
        // Only the ID type is recorded here. Identity-document numbers stay
        // write-only and are never sent from this screen.
        fields: { idType: governmentIdTypeSchema.parse(idType) },
      });
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
      return document;
    },
    onSuccess: () =>
      setMessage('ID type recorded on the identity document. The application can be submitted.'),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Could not record the ID type.'),
  });
  // One stable request identity per logical action, so a timeout-after-commit
  // retry replays the original decision instead of attempting a second one.
  const decisionRequest = useMutationRequest();
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'cancelled') =>
      decideCustomerApplication(
        id!,
        decision,
        decisionRequest.forPayload({ applicationId: id, decision }),
        'Reviewed by authorized staff.',
      ),
    onSuccess: () => {
      setMessage('Decision recorded.');
      decisionRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Decision failed.'),
  });
  // Old approved applications have no stored commercial evidence. Reviewing is an
  // explicit confirmation of the offer currently shown, never an override price.
  const [reviewReason, setReviewReason] = useState('');
  const reviewRequest = useMutationRequest();
  const review = useMutation({
    mutationFn: async () => {
      const offer = proposal.data;
      if (!offer) throw new Error('Load the purchase terms offer before confirming.');
      return reviewApplicationPurchaseTerms(id!, {
        requestId: reviewRequest.forPayload({
          applicationId: id,
          expectedProposalHash: offer.expectedProposalHash,
          reason: reviewReason.trim(),
        }),
        expectedProposalHash: offer.expectedProposalHash,
        reason: reviewReason.trim(),
      });
    },
    onSuccess: () => {
      setMessage('Purchase terms confirmed and frozen for this application.');
      setReviewReason('');
      reviewRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Review failed.'),
  });
  const reopenRequest = useMutationRequest();
  const reopen = useMutation({
    mutationFn: () =>
      reopenCustomerApplication(
        id!,
        reopenRequest.forPayload({ applicationId: id, decision: 'draft' }),
      ),
    onSuccess: () => {
      setMessage('Application reopened as draft.');
      reopenRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const editable = !existing.data || existing.data.status === 'draft';
  const selectedPlan = plans.data?.find((p) => p.id === planId);
  const relatedCustomer = customers.data?.find((c) => c.id === customerId);
  if (id && existing.isPending) {
    return <p role="status">Loading application…</p>;
  }
  if (id && (existing.isError || !existing.data)) {
    return (
      <section>
        <Link to="/admin/customers/applications">Back to applications</Link>
        <ErrorState
          title="Application could not be loaded"
          onRetry={() => void existing.refetch()}
        />
      </section>
    );
  }
  return (
    <HumanInputValidity.Provider value={reportValidity}>
      <section>
        <PageHeader
          title={existing.data?.applicationNumber ?? 'New Customer Application'}
          description="Manual entry, XLSX, and OCR all converge on the same human-reviewed draft."
        />
        <p>
          <Link to="/admin/customers/applications">Back to applications</Link>
        </p>
        {message ? <Alert variant="info">{message}</Alert> : null}
        {existing.data ? (
          <p>
            Status: {existing.data.status} · Submitted: {existing.data.submittedAt ?? '—'} ·
            Approved: {existing.data.approvedAt ?? '—'} · Rejected:{' '}
            {existing.data.rejectedAt ?? '—'} · Related customer:{' '}
            {relatedCustomer?.fullName ?? existing.data.customerId} · Related sale:{' '}
            {existing.data.saleId ?? '—'}
          </p>
        ) : null}
        {proposal.data ? (
          <section aria-label="Purchase terms offer">
            <h2>
              {proposal.data.offerKind === 'newly_confirmed_offer'
                ? 'Newly confirmed offer'
                : 'Purchase terms offer'}
            </h2>
            {/* Read-only by construction: there is no price input on this screen. */}
            <dl className="form-grid">
              <dt>Tier</dt>
              <dd>{proposal.data.terms.tier}</dd>
              <dt>Payment scheme</dt>
              <dd>{proposal.data.terms.paymentScheme}</dd>
              <dt>Total purchase amount</dt>
              <dd>₱{proposal.data.terms.totalPrice}</dd>
              <dt>Included reservation amount</dt>
              <dd>₱{proposal.data.terms.reservationFee}</dd>
              <dt>Required initial</dt>
              <dd>₱{proposal.data.terms.requiredInitial}</dd>
              {proposal.data.terms.monthlyAmount ? (
                <>
                  <dt>Installments</dt>
                  <dd>
                    ₱{proposal.data.terms.monthlyAmount} × {proposal.data.terms.installmentMonths}{' '}
                    months
                  </dd>
                </>
              ) : null}
              <dt>Spot-cash window</dt>
              <dd>{proposal.data.terms.spotCashDays} days from the first verified payment</dd>
              <dt>Yearly points</dt>
              <dd>{proposal.data.terms.yearlyPoints}</dd>
              <dt>Validity</dt>
              <dd>{proposal.data.terms.validityMonths} months</dd>
              <dt>Commission</dt>
              <dd>
                {proposal.data.terms.commissionRate} on ₱{proposal.data.terms.commissionBase} = ₱
                {proposal.data.terms.expectedCommission}
              </dd>
              <dt>Offer as of</dt>
              <dd>{new Date(proposal.data.asOf).toLocaleString()}</dd>
            </dl>
            {proposal.data.offerKind === 'newly_confirmed_offer' ? (
              <p>
                This application predates stored purchase evidence. Confirming the offer above
                records a new review record with your name, the time and your reason; today&apos;s
                figures are never presented as the historical terms.
              </p>
            ) : null}
          </section>
        ) : null}
        {selectedPlan ? (
          <p>
            Official {selectedPlan.code} benefits: {selectedPlan.discountPercent}% discount;{' '}
            {selectedPlan.cardholderLimit} holder(s) max; {selectedPlan.yearlyPoints}/year ×{' '}
            {selectedPlan.annualPointsTranches}; {selectedPlan.baseValidityYears}+
            {selectedPlan.validityExtensionYears} years; ₱{selectedPlan.totalLoyaltyValue} total
            value. Snapshots freeze at submit; later plan edits never rewrite this application.
          </p>
        ) : null}
        <fieldset disabled={!editable}>
          <div className="form-grid">
            <label>
              Customer
              <select
                aria-label="Customer"
                value={customerId}
                required={Boolean(id)}
                disabled={uploadId.isPending || ocr.isPending}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setOcrFile(null);
                  setPickerVersion((version) => version + 1);
                  setIdPreview(null);
                  setValidId(false);
                }}
              >
                <option value="">New customer — register with this application</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              VIP plan
              <select
                aria-label="VIP plan"
                value={planId}
                onChange={(e) => {
                  const plan = plans.data?.find((p) => p.id === e.target.value);
                  setPlanId(e.target.value);
                  if (plan) setTier(plan.code as typeof tier);
                }}
              >
                <option value="">Select plan</option>
                {plans.data
                  ?.filter((p) => ['BRONZE', 'SILVER', 'GOLD'].includes(p.code))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Payment scheme
              <select
                value={paymentScheme}
                onChange={(e) => setPaymentScheme(e.target.value as typeof paymentScheme)}
              >
                {[
                  'spot_cash',
                  'move_a',
                  'installment_4_month',
                  'move_b1_40_12',
                  'move_b2_25_12',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <p>
            <Button onClick={() => void getOfficialFormTemplate('customer').then(saveFile)}>
              Download template
            </Button>{' '}
            <label>
              Import XLSX{' '}
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importFile(file);
                }}
              />
            </label>
          </p>
          <fieldset>
            <legend>VALID ID</legend>
            <p>Valid ID: {validId ? 'Uploaded ✓' : 'Required / Missing'}</p>
            {serverCurrentDocument ? (
              <>
                <p>Current ID: {serverCurrentDocument.originalFilename}</p>
                <p>
                  ID type:{' '}
                  {serverCurrentDocument.reviewedFields?.idType?.replace(/_/g, ' ') ??
                    'Missing — review the identity document'}
                </p>
              </>
            ) : null}
            {ocrFile ? (
              <div role="status">
                <p>Replacement selected: {ocrFile.name} — Pending replacement. Not saved yet.</p>
                <Button
                  variant="secondary"
                  disabled={uploadId.isPending || ocr.isPending}
                  onClick={() => {
                    setOcrFile(null);
                    setPickerVersion((version) => version + 1);
                  }}
                >
                  Cancel replacement
                </Button>
              </div>
            ) : null}
            <label>
              ID Type *
              <select
                aria-label="ID Type"
                value={idType}
                disabled={uploadId.isPending || ocr.isPending}
                onChange={(event) => setIdType(event.target.value)}
              >
                <option value="">Select ID type</option>
                {governmentIdTypeSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <IdCapturePicker
              onFile={setOcrFile}
              disabled={uploadId.isPending || ocr.isPending}
              resetVersion={pickerVersion}
            />
            {ocrFile ? (
              <p role="status">
                Selected ID: {ocrFile.name}. Choose Detect fields to upload it privately and read
                the OCR suggestions.
              </p>
            ) : null}
            <Button
              onClick={() => ocr.mutate()}
              disabled={
                (!ocrFile && !serverCurrentDocument) ||
                !customerId ||
                ocr.isPending ||
                uploadId.isPending
              }
            >
              {ocr.isPending || uploadId.isPending ? 'Processing…' : 'Detect fields'}
            </Button>
            {/* Submit requires an ID type recorded on the identity document, and
                that field is only ever written by the document-confirm endpoint.
                Without this the requirement is unreachable from this screen and
                Submit stays disabled after a successful upload, so the reviewer
                records the ID type here through the same secure document
                pipeline. The gate itself is unchanged. */}
            {serverCurrentDocument && !serverCurrentDocument.reviewedFields?.idType ? (
              <p role="status">
                Submit needs the ID type recorded against this identity document.{' '}
                <Button
                  variant="secondary"
                  disabled={!idType || confirmIdType.isPending || uploadId.isPending}
                  onClick={() => confirmIdType.mutate()}
                >
                  {confirmIdType.isPending ? 'Recording…' : 'Record ID type on this ID'}
                </Button>
              </p>
            ) : null}
            {serverCurrentDocument ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => previewId.mutate(serverCurrentDocument.id)}
                >
                  Preview uploaded ID
                </Button>
                <Link to={`/admin/documents/${serverCurrentDocument.id}`}>
                  Review identity document
                </Link>
              </>
            ) : null}
            {serverCurrentDocument ? (
              <div>
                <p>OCR status: {serverCurrentDocument.ocrStatus}</p>
                {Object.entries(serverCurrentDocument.extractedFields).length ? (
                  <>
                    <p>
                      Detected suggestions — verify against the ID and correct the form manually. ID
                      numbers remain masked; use document review to confirm them.
                    </p>
                    <dl>
                      {Object.entries(serverCurrentDocument.extractedFields).map(([key, field]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {field.value ?? 'Not detected'}
                            {field.confidence !== null
                              ? ` (${Math.round(field.confidence * 100)}% confidence)`
                              : ''}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : null}
              </div>
            ) : null}
            {idPreview ? (
              <a href={idPreview} target="_blank" rel="noreferrer">
                Open short-lived private ID preview
              </a>
            ) : null}
            {documents.data
              ?.filter((doc) => doc.hasFile && doc.id !== serverCurrentDocument?.id)
              .map((doc) => (
                <p key={doc.id}>
                  Retained ID: {doc.originalFilename} · {doc.verificationStatus}{' '}
                  <Button size="sm" variant="ghost" onClick={() => previewId.mutate(doc.id)}>
                    Preview
                  </Button>
                </p>
              ))}
            {documents.data
              ?.filter((doc) => !doc.hasFile)
              .map((doc) => (
                <p key={doc.id}>
                  Pending ID upload: {doc.originalFilename}. File completion is not verified.{' '}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={uploadId.isPending || ocr.isPending || Boolean(ocrFile)}
                    onClick={() => uploadId.mutate(doc.id)}
                  >
                    Verify saved upload
                  </Button>
                </p>
              ))}
            {currentDocument.isError ? (
              <p role="status">Current ID could not be loaded. Retry before using OCR.</p>
            ) : null}
            {documents.isError ? (
              <p role="status">
                Existing ID documents could not be loaded. Document permissions still apply.
              </p>
            ) : null}
          </fieldset>
          <HolderFields title="PRIMARY CARDHOLDER" value={primary} onChange={setPrimary} />
          <label>
            <input
              type="checkbox"
              checked={Boolean(secondary)}
              disabled={tier !== 'GOLD'}
              onChange={(e) => setSecondary(e.target.checked ? emptyHolder('SECONDARY') : null)}
            />{' '}
            Add optional Gold secondary cardholder
          </label>
          {secondary ? (
            <HolderFields
              title="SECONDARY CARDHOLDER — GOLD OPTIONAL"
              value={secondary}
              onChange={setSecondary}
            />
          ) : null}
          <fieldset>
            <legend>VIP RECOMMENDER'S DETAILS</legend>
            <div className="form-grid">
              {Object.entries(meta).map(([key, value]) => (
                <Field
                  key={key}
                  label={key
                    .replace(/[A-Z]/g, (c) => ` ${c}`)
                    .replace(/^./, (c) => c.toUpperCase())}
                  value={value}
                  type={key === 'acknowledgedAt' ? 'date' : 'text'}
                  normalize={(v) => normalizeLiveHumanField(key, v)}
                  optionalPhone={key === 'recommenderContact'}
                  onChange={(v) => setMeta({ ...meta, [key]: v })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>CLIENT ACQUISITION CHANNEL</legend>
            {[
              'CMP',
              'DRP',
              'GDP Corporate',
              'Walk-In',
              'GDP Public Servant',
              'Referral',
              'FB Ads',
            ].map((channel) => (
              <label key={channel}>
                <input
                  type="checkbox"
                  checked={channels.includes(channel)}
                  onChange={(e) =>
                    setChannels(
                      e.target.checked
                        ? [...channels, channel]
                        : channels.filter((v) => v !== channel),
                    )
                  }
                />
                {channel}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>APPLICATION CERTIFICATION</legend>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{' '}
              I certify the information and consent to verification and processing under RA 10173.
            </label>
            <label>
              <input
                type="checkbox"
                checked={validId}
                onChange={(e) => setValidId(e.target.checked)}
              />{' '}
              Valid government ID with specimen signatures received
            </label>
          </fieldset>
        </fieldset>
        <p>
          <Button
            onClick={() => save.mutate()}
            disabled={
              !editable ||
              save.isPending ||
              uploadId.isPending ||
              ocr.isPending ||
              !optionalPhonesValid ||
              Object.values(invalidFields).some(Boolean)
            }
          >
            {save.isPending ? 'Saving…' : 'Save draft'}
          </Button>{' '}
          {id && editable ? (
            <>
              {submitBlockers.length > 0 ? (
                <Alert variant="warning" title="Cannot submit yet:">
                  <ul>
                    {submitBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}{' '}
              <Button
                onClick={() => submit.mutate()}
                disabled={
                  submitBlockers.length > 0 ||
                  save.isPending ||
                  uploadId.isPending ||
                  ocr.isPending ||
                  submit.isPending
                }
              >
                {submit.isPending ? 'Submitting...' : 'Submit'}
              </Button>
            </>
          ) : null}{' '}
          {id && existing.data?.status === 'submitted' ? (
            <>
              <Button onClick={() => decide.mutate('approved')} disabled={decide.isPending}>
                Approve
              </Button>{' '}
              <Button
                variant="danger"
                onClick={() => decide.mutate('rejected')}
                disabled={decide.isPending}
              >
                Reject
              </Button>{' '}
              <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                Reopen to draft
              </Button>{' '}
            </>
          ) : null}{' '}
          {id && existing.data?.status === 'rejected' ? (
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen to draft
            </Button>
          ) : null}{' '}
          {id && existing.data?.status === 'approved' && !proposal.data ? (
            <Button
              onClick={() => void proposal.refetch()}
              disabled={proposal.isFetching}
              type="button"
            >
              {proposal.isFetching ? 'Loading offer…' : 'Load purchase terms offer'}
            </Button>
          ) : null}{' '}
          {id && existing.data?.status === 'approved' && proposal.data ? (
            <>
              <label>
                Review reason
                <textarea
                  aria-label="Review reason"
                  rows={2}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                />
              </label>{' '}
              <Button
                onClick={() => review.mutate()}
                disabled={review.isPending || reviewReason.trim().length < 5}
              >
                {review.isPending ? 'Confirming…' : 'Confirm purchase terms'}
              </Button>
            </>
          ) : null}{' '}
          {id &&
          existing.data &&
          canTransitionCustomerApplication(existing.data.status, 'cancelled') ? (
            <Button onClick={() => decide.mutate('cancelled')} disabled={decide.isPending}>
              Cancel
            </Button>
          ) : null}{' '}
          {id ? (
            <>
              {existing.data && ['submitted', 'approved'].includes(existing.data.status) && (
                <Link to={`/admin/sales/reservations/new?application=${id}`}>
                  Create reservation from application
                </Link>
              )}
              <Button
                onClick={() =>
                  void exportCustomerApplication(id, 'xlsx')
                    .then(saveFile)
                    .catch((e: unknown) =>
                      setMessage(e instanceof Error ? e.message : 'Export failed.'),
                    )
                }
              >
                Export XLSX
              </Button>
              <Button
                onClick={() =>
                  void exportCustomerApplication(id, 'pdf')
                    .then(saveFile)
                    .catch((e: unknown) =>
                      setMessage(e instanceof Error ? e.message : 'Export failed.'),
                    )
                }
              >
                Export PDF
              </Button>
            </>
          ) : null}
        </p>
      </section>
    </HumanInputValidity.Provider>
  );
}

export function ReservationAgreementsPage() {
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['reservation-agreements', status, tier, debouncedSearch],
    queryFn: () =>
      getReservationAgreements({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      }),
    // Agreement decisions happen in review screens and other sessions.
    refetchInterval: 30_000,
  });
  return (
    <section>
      <PageHeader
        title="IST Reservation Agreements"
        description="Contract snapshots remain separate from actual verified payment transactions."
        actions={<Link to="/admin/sales/reservations/new">New agreement</Link>}
      />
      <FilterBar
        search={
          <SearchField
            label="Search reservation agreements"
            placeholder="Reservation number"
            value={search}
            onChange={setSearch}
            busy={query.isPending}
          />
        }
        filters={
          <>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {['draft', 'submitted', 'executed', 'cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tier
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All</option>
                {['BRONZE', 'SILVER', 'GOLD'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {query.isPending ? (
        <p role="status">Loading reservation agreements…</p>
      ) : query.isError ? (
        <ErrorState title="Agreements could not be loaded" onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Applicant</th>
                <th>Tier</th>
                <th>Sale</th>
                <th>Payment scheme</th>
                <th>Amount</th>
                <th>Signatures</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/admin/sales/reservations/${item.id}`}>
                      {item.reservationNumber}
                    </Link>
                  </td>
                  <td>{item.applicantName ?? '—'}</td>
                  <td>{item.tier}</td>
                  <td>{item.saleId}</td>
                  <td>{paymentSchemeLabel(item.paymentScheme)}</td>
                  <td>{formatMoney(item.totalPrice)}</td>
                  <td>
                    {item.primarySignatureStatus === 'received' &&
                    (!item.hasSecondaryHolder || item.secondarySignatureStatus === 'received')
                      ? 'Complete'
                      : 'Pending signature'}
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        whiteSpace: 'nowrap',
                        minWidth: 'max-content',
                      }}
                    >
                      <StatusChip
                        label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      />
                    </span>
                  </td>
                  <td>{item.submittedAt ? formatDateTime(item.submittedAt) : '—'}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No reservation agreements"
          description="Create an agreement from an existing card sale."
        />
      )}
    </section>
  );
}

export function ReservationAgreementEditorPage() {
  const [searchParams] = useSearchParams();
  const reservationRequest = useMutationRequest();
  const runReservationSave =
    useSingleFlight<Awaited<ReturnType<typeof createReservationAgreement>>>();
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const existing = useQuery({
    queryKey: ['reservation-agreement', id],
    queryFn: () => getReservationAgreement(id!),
    enabled: Boolean(id),
  });
  const sales = useQuery({ queryKey: ['sales'], queryFn: () => getSales() });
  const plans = useQuery({ queryKey: ['card-products'], queryFn: () => getCardProducts() });
  const [saleId, setSaleId] = useState('');
  const [customerApplicationId, setCustomerApplicationId] = useState(
    () => searchParams.get('application') ?? '',
  );
  const applications = useQuery({
    queryKey: ['customer-applications', 'reservation-source'],
    queryFn: () => getCustomerApplications(),
  });
  const sourceApplication = useQuery({
    queryKey: ['customer-application', 'reservation-source', customerApplicationId],
    queryFn: () => getCustomerApplication(customerApplicationId),
    enabled: Boolean(customerApplicationId) && !id,
  });
  /**
   * Application-origin mode.
   *
   * Opening from an approved application means there is NO card sale to choose:
   * the reservation IS the first commercial document, and the sale arrives only
   * when Finance finalizes fully paid. The sale selector is therefore hidden
   * rather than disabled, so a first-time purchase can never be mistaken for one
   * that needs an existing sale.
   */
  const applicationOrigin =
    existing.data?.origin === 'application' || (!id && Boolean(customerApplicationId));
  // The frozen offer is the ONLY source of the economics shown here. It is
  // server-derived, and a stale copy is refreshed rather than reused.
  const proposal = useQuery({
    queryKey: ['purchase-terms-proposal', 'reservation-source', customerApplicationId],
    queryFn: () => getPurchaseTermsProposal(customerApplicationId),
    enabled: applicationOrigin && !id,
    retry: false,
  });
  const reviewRequired =
    applicationOrigin &&
    proposal.isError &&
    /PURCHASE_TERMS_REVIEW_REQUIRED/i.test(
      (proposal.error as { message?: string } | null)?.message ?? '',
    );
  // Imported tier context (IST XLSX `vip_tier`). Display/validation only:
  // the server always derives the authoritative tier from the selected sale
  // and rejects a mismatch.
  const [vipTier, setVipTier] = useState('');
  const [dates, setDates] = useState({
    reservationDate: today(),
    agreementDate: today(),
    revisionNumber: '',
    monthlyAmortizationStart: '',
    monthlyAmortizationEnd: '',
    paymentDueDay: '',
  });
  const [primary, setPrimary] = useState({
    holderType: 'PRIMARY' as const,
    name: '',
    address: '',
    contactNumber: '',
    email: '',
    tinNumber: '',
  });
  type SecondaryState = {
    holderType: 'PRIMARY' | 'SECONDARY';
    name: string;
    address: string;
    contactNumber: string;
    email: string;
    tinNumber: string;
  };
  const [secondary, setSecondary] = useState<SecondaryState | null>(null);
  const [schedule, setSchedule] = useState({
    particular: 'Monthly amortization',
    amount: '0.00',
    paymentDate: '',
    remarks: '',
  });
  const [message, setMessage] = useState('');
  useEffect(() => {
    const app = sourceApplication.data;
    if (!app || id || !['submitted', 'approved'].includes(app.status)) return;
    // No primary holder means nothing safe to prefill. The server still refuses
    // the save, but the PAGE must not crash on a thin payload.
    if (!app.primary) return;
    const holder = (value: ApplicationHolder) => ({
      holderType: value.holderType,
      name: [value.firstName, value.middleName, value.lastName, value.suffix]
        .filter(Boolean)
        .join(' '),
      address: [
        value.permanentAddressLine1,
        value.permanentAddressLine2,
        value.cityMunicipality,
        value.province,
        value.postalCode,
      ]
        .filter(Boolean)
        .join(', '),
      contactNumber: value.mobile,
      email: value.email,
      tinNumber: value.tinNumber ?? '',
    });
    const timer = window.setTimeout(() => {
      setPrimary({ ...holder(app.primary), holderType: 'PRIMARY' });
      setSecondary(app.secondary ? { ...holder(app.secondary), holderType: 'SECONDARY' } : null);
      setVipTier(app.tier);
      if (app.saleId) setSaleId(app.saleId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sourceApplication.data, id]);
  useEffect(() => {
    const agreement = existing.data;
    if (!agreement) return;
    const timer = window.setTimeout(() => {
      setSaleId(agreement.saleId ?? '');
      setCustomerApplicationId(agreement.customerApplicationId ?? '');
      setVipTier(agreement.tier);
      setDates({
        reservationDate: agreement.reservationDate,
        agreementDate: agreement.agreementDate,
        revisionNumber: agreement.revisionNumber ?? '',
        monthlyAmortizationStart: agreement.monthlyAmortizationStart ?? '',
        monthlyAmortizationEnd: agreement.monthlyAmortizationEnd ?? '',
        paymentDueDay: String(agreement.paymentDueDay ?? ''),
      });
      setPrimary({ ...agreement.primary, tinNumber: agreement.primary.tinNumber ?? '' });
      setSecondary(
        agreement.secondary
          ? {
              ...agreement.secondary,
              holderType: 'SECONDARY' as const,
              tinNumber: agreement.secondary.tinNumber ?? '',
            }
          : null,
      );
      const first = agreement.schedule[0];
      if (first)
        setSchedule({
          particular: first.particular,
          amount: first.amount,
          paymentDate: first.paymentDate ?? '',
          remarks: first.remarks ?? '',
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [existing.data]);
  /**
   * The ONLY fields an application-origin agreement can set.
   *
   * Deliberately absent: price, scheme, seller, commission, status, source ids and
   * every total. Those come from the immutable purchase-terms row, and a body
   * field for any of them would be a field the browser could lie in.
   */
  const agreedFields = () => ({
    agreementDate: dates.agreementDate,
    revisionNumber: dates.revisionNumber || undefined,
    monthlyAmortizationStart: dates.monthlyAmortizationStart || undefined,
    monthlyAmortizationEnd: dates.monthlyAmortizationEnd || undefined,
    paymentDueDay: dates.paymentDueDay ? Number(dates.paymentDueDay) : undefined,
    primarySignatureStatus: 'received' as const,
    secondarySignatureStatus: secondary ? ('received' as const) : undefined,
    scheduleNotes: [
      {
        ...schedule,
        paymentDate: schedule.paymentDate || undefined,
        remarks: schedule.remarks || undefined,
      },
    ],
  });
  const payload = () => ({
    // An unchosen sale stays absent: never send "" as a UUID.
    saleId: saleId || undefined,
    ...(customerApplicationId ? { customerApplicationId } : {}),
    ...(vipTier === 'BRONZE' || vipTier === 'SILVER' || vipTier === 'GOLD'
      ? { vipTier: vipTier as 'BRONZE' | 'SILVER' | 'GOLD' }
      : {}),
    ...dates,
    revisionNumber: dates.revisionNumber || undefined,
    monthlyAmortizationStart: dates.monthlyAmortizationStart || undefined,
    monthlyAmortizationEnd: dates.monthlyAmortizationEnd || undefined,
    paymentDueDay: dates.paymentDueDay ? Number(dates.paymentDueDay) : undefined,
    primary,
    secondary: secondary ? { ...secondary, holderType: 'SECONDARY' } : undefined,
    primarySignatureStatus: 'received',
    secondarySignatureStatus: secondary ? 'received' : undefined,
    scheduleNotes: [
      {
        ...schedule,
        paymentDate: schedule.paymentDate || undefined,
        remarks: schedule.remarks || undefined,
      },
    ],
  });
  const save = useMutation({
    mutationFn: () =>
      runReservationSave(() => {
        if (!id && !customerApplicationId)
          throw new Error('Choose an eligible Customer Application before creating a reservation.');
        if (applicationOrigin) {
          if (id) {
            const fields = agreedFields();
            return updateApplicationReservation(id, {
              requestId: reservationRequest.forPayload({ id, ...fields }),
              ...fields,
            });
          }
          // The exact frozen terms reference comes from the APPLICATION, not from
          // the offer body: it is an identifier, and the server revalidates it
          // against the immutable row before writing anything.
          const termsId = sourceApplication.data?.purchaseTermsId;
          if (!termsId)
            throw new Error(
              'This application has no captured purchase terms. An authorized review is required first.',
            );
          if (!proposal.data)
            throw new Error('Load the current offer before creating the agreement.');
          return createReservationAgreement({
            origin: 'application',
            requestId: reservationRequest.forPayload({ application: customerApplicationId }),
            customerApplicationId,
            purchaseTermsId: termsId,
            reservationDate: dates.reservationDate,
            ...agreedFields(),
          });
        }
        if (!saleId) throw new Error('Select a sale for this reservation.');
        const checked = createReservationAgreementSchema.safeParse(payload());
        if (!checked.success) throw new Error(humanizeApplicationIssues(checked.error.issues));
        const body = checked.data;
        return id
          ? updateReservationAgreement(id, body)
          : createReservationAgreement({
              ...body,
              requestId: reservationRequest.forPayload(body),
            });
      }),
    onSuccess: (agreement) => {
      setMessage('Reservation saved.');
      reservationRequest.complete();
      void client.invalidateQueries({ queryKey: ['reservation-agreements'] });
      if (!id) navigate(`/admin/sales/reservations/${agreement.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save failed.'),
  });
  const submit = useMutation({
    mutationFn: () => submitReservationAgreement(id!),
    onSuccess: () => {
      setMessage('Agreement submitted.');
      void existing.refetch();
      void client.invalidateQueries({ queryKey: ['reservation-agreements'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Submit failed.'),
  });
  const decide = useMutation({
    mutationFn: (decision: 'executed' | 'cancelled') =>
      decideReservationAgreement(id!, decision, 'Reviewed by authorized seller.'),
    onSuccess: () => {
      setMessage('Decision recorded.');
      void existing.refetch();
      void client.invalidateQueries({ queryKey: ['reservation-agreements'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Decision failed.'),
  });
  const reopen = useMutation({
    mutationFn: () => reopenReservationAgreement(id!),
    onSuccess: () => {
      setMessage('Agreement reopened as draft.');
      void existing.refetch();
      void client.invalidateQueries({ queryKey: ['reservation-agreements'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const summary = useQuery({
    queryKey: ['sale-summary', saleId],
    queryFn: () => getSaleSummary(saleId),
    enabled: Boolean(saleId),
  });
  const autoFill = () => {
    const sale = sales.data?.find((s) => s.id === saleId);
    if (!sale) {
      setMessage('Select a card sale first.');
      return;
    }
    setPrimary((prev) => ({
      ...prev,
      name: prev.name || sale.customerName,
    }));
    setMessage('Known sale/customer data pre-filled — please verify before saving.');
  };
  const importIstFile = async (file: File) => {
    const preview = await previewOfficialFormImport('reservation_agreement', await asBase64(file));
    if (preview.errors.length) {
      setMessage(preview.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      return;
    }
    const f = preview.fields;
    if (f.sale_id) setSaleId(f.sale_id);
    if (f.customer_application_id) setCustomerApplicationId(f.customer_application_id);
    if (f.vip_tier) setVipTier(f.vip_tier.toUpperCase());
    if (f.reservation_date)
      setDates((d) => ({ ...d, reservationDate: f.reservation_date ?? d.reservationDate }));
    if (f.agreement_date)
      setDates((d) => ({ ...d, agreementDate: f.agreement_date ?? d.agreementDate }));
    if (f.revision_number !== undefined)
      setDates((d) => ({ ...d, revisionNumber: f.revision_number ?? d.revisionNumber }));
    setPrimary((prev) => ({
      ...prev,
      name: f.primary_name ?? prev.name,
      address: f.primary_address ?? prev.address,
      contactNumber: f.primary_contact_number ?? prev.contactNumber,
      email: f.primary_email ?? prev.email,
      tinNumber: f.primary_tin ?? prev.tinNumber,
    }));
    if (f.secondary_enabled === 'true')
      setSecondary((prev) => ({
        holderType: 'SECONDARY' as const,
        name: f.secondary_name ?? prev?.name ?? '',
        address: f.secondary_address ?? prev?.address ?? '',
        contactNumber: f.secondary_contact_number ?? prev?.contactNumber ?? '',
        email: f.secondary_email ?? prev?.email ?? '',
        tinNumber: f.secondary_tin ?? prev?.tinNumber ?? '',
      }));
    setSchedule((prev) => ({
      particular: f.schedule_particular || prev.particular,
      amount: f.schedule_amount || prev.amount,
      paymentDate: f.schedule_payment_date || prev.paymentDate,
      remarks: f.schedule_remarks || prev.remarks,
    }));
    setMessage('Imported candidates populated — please verify every field before saving.');
  };
  const editable = !existing.data || existing.data.status === 'draft';
  const salePlan = plans.data?.find((p) => p.id === summary.data?.saleId);
  return (
    <section>
      <PageHeader
        title={existing.data?.reservationNumber ?? 'New IST Reservation Agreement'}
        description="Benefits and economics are server-derived snapshots; schedule rows are not received payments."
      />
      <p>
        <Link to="/admin/sales/reservations">Back to agreements</Link>
      </p>
      {message ? <Alert variant="info">{message}</Alert> : null}
      {existing.data ? (
        <p>
          Status: {existing.data.status} · Tier: {existing.data.tier} · Total:{' '}
          {existing.data.totalPrice} · Verified received: {existing.data.totalPaymentReceived} ·
          Balance: {existing.data.balance} · Submitted: {existing.data.submittedAt ?? '—'} ·
          Executed: {existing.data.executedAt ?? '—'}
        </p>
      ) : null}
      {summary.data ? (
        <p>
          Linked sale {summary.data.saleId}: verified {summary.data.verifiedTotal}, balance{' '}
          {summary.data.remainingBalance}. Schedule rows below are obligations only — actual cash
          lives in the payments table.
        </p>
      ) : null}
      {salePlan ? (
        <p>
          Official {salePlan.code} benefits apply prospectively; this agreement freezes its own
          snapshot at creation.
        </p>
      ) : null}
      {reviewRequired ? (
        <Alert variant="warning">
          <strong>Purchase Terms Review Required.</strong> This application has no captured purchase
          terms, so no agreement can be created from it yet. An authorized reviewer must confirm the
          current server offer and record a reason first.{' '}
          <Link to={`/admin/sales/applications/${customerApplicationId}`}>
            Open the application review
          </Link>
          .
        </Alert>
      ) : null}
      {applicationOrigin && proposal.data ? (
        <section aria-label="Frozen purchase terms">
          <h2>Server-authoritative offer</h2>
          <p>
            These figures are read-only. They are frozen purchase terms, not an editable quote, and
            the server revalidates them at save.
          </p>
          <dl>
            <dt>Card tier</dt>
            <dd>{proposal.data.terms.tier}</dd>
            <dt>Payment scheme</dt>
            <dd>{paymentSchemeLabel(proposal.data.terms.paymentScheme)}</dd>
            <dt>Total purchase</dt>
            <dd>{formatMoney(proposal.data.terms.totalPrice)}</dd>
            <dt>Included reservation amount</dt>
            <dd>{formatMoney(proposal.data.terms.reservationFee)}</dd>
            <dt>Required initial</dt>
            <dd>{formatMoney(proposal.data.terms.requiredInitial)}</dd>
            <dt>Monthly amount</dt>
            <dd>{formatMoney(proposal.data.terms.monthlyAmount)}</dd>
            <dt>Installment months</dt>
            <dd>{proposal.data.terms.installmentMonths ?? '—'}</dd>
            <dt>Seller staff reference</dt>
            <dd>{proposal.data.terms.sellerStaffId}</dd>
            <dt>Benefits</dt>
            <dd>{proposal.data.terms.inclusions.length} captured item(s)</dd>
            <dt>Purchase terms reference</dt>
            <dd>{sourceApplication.data?.purchaseTermsId ?? 'Not captured'}</dd>
            <dt>Offer as of</dt>
            <dd>{formatDateTime(proposal.data.asOf)}</dd>
          </dl>
        </section>
      ) : null}
      <fieldset disabled={!editable}>
        {/* Application-origin reservations have NO sale: the agreement comes
            first and the sale arrives at finalization. */}
        {applicationOrigin ? null : (
          <>
            <label>
              Card sale
              <select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                <option value="">Select sale</option>
                {sales.data?.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.saleNumber} — {sale.customerName}
                  </option>
                ))}
              </select>
            </label>{' '}
            <Button onClick={autoFill}>Auto-fill from sale</Button>
          </>
        )}
        <label>
          Source Customer Application
          <select
            value={customerApplicationId}
            aria-label="Source Customer Application"
            onChange={(e) => setCustomerApplicationId(e.target.value)}
          >
            <option value="">Choose a submitted or approved application</option>
            {applications.data
              ?.filter((app) => ['submitted', 'approved'].includes(app.status))
              .map((app) => (
                <option key={app.id} value={app.id}>
                  {app.applicationNumber} — {app.applicantName}
                </option>
              ))}
          </select>
        </label>
        {sourceApplication.data && (
          <p>
            Applicant and holders copied from {sourceApplication.data.applicationNumber}.{' '}
            {sourceApplication.data.tier} ·{' '}
            {paymentSchemeLabel(sourceApplication.data.paymentScheme)} · Frozen VIP amount{' '}
            {formatMoney(sourceApplication.data.vipAmount)}.
            {applicationOrigin
              ? ' No card sale is needed: this reservation is the first commercial record.'
              : ' Select the matching existing card sale if the application has not yet been linked.'}
          </p>
        )}
        <label>
          Imported tier context (validates secondary; sale tier stays authoritative)
          <NormalizedInput
            value={vipTier}
            placeholder="BRONZE, SILVER, or GOLD"
            normalize={(value) => value.toUpperCase()}
            onChange={(e) => setVipTier(e.target.value)}
          />
        </label>
        <div className="form-grid">
          {Object.entries(dates).map(([key, value]) => (
            <Field
              key={key}
              label={key.replace(/[A-Z]/g, (c) => ` ${c}`)}
              value={value}
              type={
                key.toLowerCase().includes('date') || key.includes('Start') || key.includes('End')
                  ? 'date'
                  : 'text'
              }
              onChange={(v) => setDates({ ...dates, [key]: v })}
            />
          ))}
        </div>
        <fieldset>
          <legend>PRIMARY CARDHOLDER DETAILS</legend>
          {Object.entries(primary)
            .filter(([key]) => key !== 'holderType')
            .map(([key, value]) => (
              <Field
                key={key}
                label={key}
                value={value}
                normalize={(v) => normalizeLiveHumanField(key, v)}
                onChange={(v) => setPrimary({ ...primary, [key]: v })}
              />
            ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={Boolean(secondary)}
            onChange={(e) =>
              setSecondary(
                e.target.checked
                  ? {
                      holderType: 'SECONDARY' as const,
                      name: '',
                      address: '',
                      contactNumber: '',
                      email: '',
                      tinNumber: '',
                    }
                  : null,
              )
            }
          />{' '}
          Add optional supplementary holder (Gold only; server rejects other tiers)
        </label>
        {secondary ? (
          <fieldset>
            <legend>SUPPLEMENTARY CARDHOLDER DETAILS</legend>
            {Object.entries(secondary)
              .filter(([key]) => key !== 'holderType')
              .map(([key, value]) => (
                <Field
                  key={key}
                  label={key}
                  value={value}
                  normalize={(v) => normalizeLiveHumanField(key, v)}
                  onChange={(v) => setSecondary({ ...secondary, [key]: v })}
                />
              ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend>PAYMENT PLAN SCHEDULE — NOT AN ACTUAL PAYMENT</legend>
          {Object.entries(schedule).map(([key, value]) => (
            <Field
              key={key}
              label={key}
              value={value}
              type={key === 'paymentDate' ? 'date' : 'text'}
              onChange={(v) => setSchedule({ ...schedule, [key]: v })}
            />
          ))}
        </fieldset>
        <p>
          <Button onClick={() => void getOfficialFormTemplate('ist').then(saveFile)}>
            Download import template
          </Button>{' '}
          <label>
            Import IST XLSX{' '}
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importIstFile(file);
              }}
            />
          </label>
        </p>
      </fieldset>
      <p>
        <Button onClick={() => save.mutate()} disabled={!editable || save.isPending}>
          {save.isPending
            ? 'Saving…'
            : applicationOrigin
              ? 'Create Reservation Agreement'
              : 'Save draft'}
        </Button>{' '}
        {id && editable ? (
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            Submit
          </Button>
        ) : null}{' '}
        {id && existing.data?.status === 'submitted' ? (
          <>
            <Button onClick={() => decide.mutate('executed')} disabled={decide.isPending}>
              Execute
            </Button>{' '}
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen to draft
            </Button>{' '}
          </>
        ) : null}{' '}
        {id && (existing.data?.status === 'draft' || existing.data?.status === 'submitted') ? (
          <Button onClick={() => decide.mutate('cancelled')} disabled={decide.isPending}>
            Cancel
          </Button>
        ) : null}{' '}
        {id ? (
          <>
            <Button
              onClick={() =>
                void exportReservationAgreement(id, 'xlsx')
                  .then(saveFile)
                  .catch((e: unknown) =>
                    setMessage(e instanceof Error ? e.message : 'Export failed.'),
                  )
              }
            >
              Export XLSX
            </Button>
            <Button
              onClick={() =>
                void exportReservationAgreement(id, 'pdf')
                  .then(saveFile)
                  .catch((e: unknown) =>
                    setMessage(e instanceof Error ? e.message : 'Export failed.'),
                  )
              }
            >
              Export PDF
            </Button>
          </>
        ) : null}
      </p>
      {id && existing.data?.origin === 'application' ? (
        <ApplicationOriginAgreementPanel id={id} agreement={existing.data} />
      ) : null}
    </section>
  );
}

/**
 * The application-origin agreement after creation: lifecycle state, money, the
 * one payment ledger, and the historical prints.
 *
 * Nothing here recalculates money. Every figure is the server's, and the Finalize
 * button follows the server's own eligibility rather than a browser total.
 */
function ApplicationOriginAgreementPanel({
  id,
  agreement,
}: {
  id: string;
  agreement: Extract<PurchaseReservation, { origin: 'application' }>;
}) {
  const client = useQueryClient();
  const { user } = useSession();
  const canHandlePayments =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finance = useQuery({
    queryKey: ['reservation-finance', id],
    queryFn: () => getReservationFinance(id),
    retry: false,
  });
  const payments = useQuery({
    queryKey: ['reservation-payments', id],
    queryFn: () => getReservationPayments(id),
    retry: false,
  });
  const afterMutation = async () => {
    await client.invalidateQueries({ queryKey: ['reservation-agreements'] });
    await client.invalidateQueries({ queryKey: ['reservation-agreement', id] });
    await client.invalidateQueries({ queryKey: ['reservation-finance', id] });
    await client.invalidateQueries({ queryKey: ['reservation-payments', id] });
    // Execution makes the agreement collectable, so Finance readiness must move
    // in the same breath. A stale queue is how a customer is told "nothing to pay".
    await client.invalidateQueries({ queryKey: ['business', 'queue'] });
    await client.invalidateQueries({ queryKey: ['business', 'sales'] });
    await client.invalidateQueries({ queryKey: ['business', 'activation-queue'] });
    await client.invalidateQueries({ queryKey: ['reports'] });
  };
  const print = async (kind: PurchaseDocumentKind, label: string, sourceId = id) => {
    setBusy(true);
    setError(null);
    try {
      downloadFile(await exportPurchaseDocument(sourceId, kind));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      await finalizeReservationPurchase(id, crypto.randomUUID());
      await afterMutation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Finalization failed.');
    } finally {
      setBusy(false);
    }
  };
  const money = finance.data;
  const lifecycle = agreement.status;
  return (
    <section aria-label="Reservation lifecycle">
      <h2>Purchase state</h2>
      {error ? <Alert variant="warning">{error}</Alert> : null}
      <dl>
        <dt>Agreement state</dt>
        <dd>{lifecycle}</dd>
        <dt>Card Sale (AF-CSALE)</dt>
        <dd>{agreement.saleId ?? 'Not created — created when the purchase is finalized'}</dd>
        <dt>Total purchase</dt>
        <dd>{formatMoney(money?.totalPrice ?? agreement.totalPrice)}</dd>
        <dt>Included reservation amount</dt>
        <dd>{formatMoney(money?.reservationFee ?? agreement.reservationFee)}</dd>
        <dt>Verified paid</dt>
        <dd>{formatMoney(money?.verifiedTotal ?? '0.00')}</dd>
        <dt>Remaining</dt>
        <dd>{formatMoney(money?.remainingBalance ?? agreement.balance)}</dd>
        {money?.overpaidAmount && money.overpaidAmount !== '0.00' ? (
          <>
            <dt>Overpaid</dt>
            <dd>{formatMoney(money.overpaidAmount)}</dd>
          </>
        ) : null}
      </dl>
      <p>
        <Button onClick={() => void print('reservation', 'Reservation')} disabled={busy}>
          Print Reservation Agreement
        </Button>{' '}
        {money?.fullyPaid ? (
          <Button
            onClick={() => void finalize()}
            disabled={!canHandlePayments || busy}
            title={
              canHandlePayments
                ? 'Creates exactly one card sale from the verified payments.'
                : 'Requires the finance payment verification grant.'
            }
          >
            Finalize Purchase
          </Button>
        ) : null}
      </p>
      {lifecycle === 'executed' && !agreement.saleId ? (
        <Alert variant="info">
          Executed. This agreement is now in the Finance queue for collection. No card sale exists
          yet — one is created only when the whole price is verified.
        </Alert>
      ) : null}
      <h3>Payments</h3>
      {payments.data && payments.data.length > 0 ? (
        <table>
          <caption>Every AF-PAY recorded against this agreement</caption>
          <thead>
            <tr>
              <th scope="col">AF-PAY</th>
              <th scope="col">Amount</th>
              <th scope="col">Method</th>
              <th scope="col">Recorded</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.data.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.paymentNumber ?? payment.id}</td>
                <td>{formatMoney(payment.amount)}</td>
                <td>{payment.method}</td>
                <td>{formatDateTime(payment.recordedAt)}</td>
                <td>{payment.status}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void print('payment_recorded', 'Recorded receipt', payment.id)}
                  >
                    Print Recorded Receipt
                  </Button>{' '}
                  {/* A rejected payment never gets a verified receipt: there is no
                      verified evidence to render, and inventing one would be a lie
                      in a customer's hand. */}
                  {payment.status === 'verified' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void print('payment_verified', 'Verified receipt', payment.id)}
                    >
                      Print Verified Receipt
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No payments recorded against this agreement yet.</p>
      )}
      {agreement.saleId ? (
        <p>
          Final purchase record:{' '}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void print('purchase_finalized', 'Final purchase', agreement.saleId!)}
          >
            Print Final Purchase Record
          </Button>
        </p>
      ) : null}
      <MembershipConfirmation saleId={agreement.saleId} />
    </section>
  );
}

/**
 * The membership result after activation, with the confirmation print.
 *
 * Deliberately absent: the QR token, the fallback code, their hashes, any
 * onboarding token and any storage URL. Those are returned once by the activation
 * call and are never re-displayable, so this panel could not show them even if it
 * wanted to.
 */
function MembershipConfirmation({ saleId }: { saleId: string | null }) {
  const { user } = useSession();
  const canActivate =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'finance.card_activation' && permission.canUpdate,
    ) ?? false;
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    if (!saleId) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await activateSale(saleId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  };
  if (!saleId) return null;
  return (
    <section aria-label="Membership activation">
      <h3>Membership</h3>
      {error ? <Alert variant="warning">{error}</Alert> : null}
      {result ? (
        <>
          <dl>
            <dt>Membership</dt>
            <dd>{result.membershipNumber}</dd>
            <dt>Points allocated</dt>
            <dd>{result.pointsAllocated}</dd>
            <dt>Card Sale</dt>
            <dd>{saleId}</dd>
          </dl>
          <Alert variant="info">
            Card credentials are shown once, by the authorized activation flow, and are never
            re-displayed. Use Print Activation Confirmation for the historical record.
          </Alert>
          <PrintActivationConfirmation membershipId={result.membershipId} />
        </>
      ) : (
        <Button onClick={() => void activate()} disabled={!canActivate || busy}>
          Activate membership
        </Button>
      )}
    </section>
  );
}

function PrintActivationConfirmation({ membershipId }: { membershipId: string }) {
  const [error, setError] = useState<string | null>(null);
  // The activation confirmation is addressed by the membership, which is the
  // source the evidence builder reads.
  return (
    <p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setError(null);
          void exportPurchaseDocument(membershipId, 'membership_activated')
            .then(downloadFile)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'Print failed.'),
            );
        }}
      >
        Print Activation Confirmation
      </Button>{' '}
      <span>Membership {membershipId}</span>
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}
