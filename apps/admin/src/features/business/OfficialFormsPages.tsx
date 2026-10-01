import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { ApplicationHolder, CreateReservationAgreementRequest } from '@jad/contracts';
import { Alert, Button, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import { putUploadBytes, requestUploadGrant, runDocumentOcr } from '../documents/services';
import {
  createCustomerApplication,
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
  getReservationAgreement,
  getReservationAgreements,
  getSaleSummary,
  getSales,
  previewOfficialFormImport,
  reopenCustomerApplication,
  reopenReservationAgreement,
  submitCustomerApplication,
  submitReservationAgreement,
  updateCustomerApplication,
  updateReservationAgreement,
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
const saveFile = (file: { filename: string; mime: string; content: string }) => {
  const bytes = Uint8Array.from(atob(file.content), (value) => value.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};
const asBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
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
          onChange={(v) => set('lastName', v)}
          required
        />
        <Field
          label="First name"
          value={value.firstName}
          onChange={(v) => set('firstName', v)}
          required
        />
        <Field
          label="Middle name"
          value={value.middleName ?? ''}
          onChange={(v) => set('middleName', v)}
        />
        <Field label="Suffix" value={value.suffix ?? ''} onChange={(v) => set('suffix', v)} />
        <Field
          label="Birth date"
          value={value.birthDate}
          onChange={(v) => set('birthDate', v)}
          type="date"
          required
        />
        <Field label="Sex" value={value.sex ?? ''} onChange={(v) => set('sex', v)} />
        <Field
          label="Citizenship"
          value={value.citizenship ?? ''}
          onChange={(v) => set('citizenship', v)}
        />
        <Field
          label="Civil status"
          value={value.civilStatus ?? ''}
          onChange={(v) => set('civilStatus', v)}
        />
        <Field
          label="Permanent address line 1"
          value={value.permanentAddressLine1}
          onChange={(v) => set('permanentAddressLine1', v)}
          required
        />
        <Field
          label="Permanent address line 2"
          value={value.permanentAddressLine2 ?? ''}
          onChange={(v) => set('permanentAddressLine2', v)}
        />
        <Field
          label="City / municipality"
          value={value.cityMunicipality}
          onChange={(v) => set('cityMunicipality', v)}
          required
        />
        <Field
          label="Province"
          value={value.province}
          onChange={(v) => set('province', v)}
          required
        />
        <Field
          label="Postal code"
          value={value.postalCode ?? ''}
          onChange={(v) => set('postalCode', v)}
        />
        <Field label="Landline" value={value.landline ?? ''} onChange={(v) => set('landline', v)} />
        <Field label="Mobile" value={value.mobile} onChange={(v) => set('mobile', v)} required />
        <Field
          label="Email"
          value={value.email}
          onChange={(v) => set('email', v)}
          type="email"
          required
        />
        <Field label="TIN" value={value.tinNumber ?? ''} onChange={(v) => set('tinNumber', v)} />
        <Field
          label="Occupation / business"
          value={value.occupationBusinessName ?? ''}
          onChange={(v) => set('occupationBusinessName', v)}
        />
        <Field
          label="Office / business address"
          value={value.officeBusinessAddress ?? ''}
          onChange={(v) => set('officeBusinessAddress', v)}
        />
        <Field
          label="Business / industry"
          value={value.businessIndustry ?? ''}
          onChange={(v) => set('businessIndustry', v)}
        />
        <Field
          label="Employed position"
          value={value.employedPosition ?? ''}
          onChange={(v) => set('employedPosition', v)}
        />
        <Field
          label="Printed name"
          value={value.printedName}
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
  const query = useQuery({
    queryKey: ['customer-applications', status, tier, search, from, to],
    queryFn: () =>
      getCustomerApplications({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(search ? { search } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });
  return (
    <section>
      <PageHeader
        title="Customer Applications"
        description="Official application transactions. Submitted snapshots remain independent of later customer master-data edits."
        actions={<Link to="/admin/customers/applications/new">New application</Link>}
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
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
          Search
          <input
            value={search}
            placeholder="Application number"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {query.isError ? (
        <ErrorState title="Applications could not be loaded" onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
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
                <td>
                  {app.primary
                    ? `${app.primary.firstName} ${app.primary.lastName}`
                    : ((app as unknown as Record<string, string>).applicant_name ?? '—')}
                </td>
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
      ) : (
        <EmptyState
          title="No customer applications"
          description="Create the first official application draft."
        />
      )}
    </section>
  );
}

export function CustomerApplicationEditorPage() {
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
  const [customerId, setCustomerId] = useState('');
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
    customerId,
    planId,
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
      id ? updateCustomerApplication(id, payload()) : createCustomerApplication(payload()),
    onSuccess: (app) => {
      setMessage('Draft saved.');
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
      if (!id) navigate(`/admin/customers/applications/${app.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save failed.'),
  });
  const submit = useMutation({
    mutationFn: () => submitCustomerApplication(id!),
    onSuccess: () => {
      setMessage('Application submitted.');
      void existing.refetch();
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
      if (!ocrFile || !customerId) throw new Error('Select a customer and ID file first.');
      const grant = await requestUploadGrant({
        subjectType: 'customer',
        subjectId: customerId,
        mime: ocrFile.type as 'image/jpeg' | 'image/png' | 'application/pdf',
        sizeBytes: ocrFile.size,
        originalFilename: ocrFile.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, ocrFile);
      return runDocumentOcr(grant.documentId);
    },
    onSuccess: (doc) => {
      const fields = doc.extractedFields;
      setPrimary({
        ...primary,
        firstName: fields.firstName?.value ?? primary.firstName,
        middleName: fields.middleName?.value ?? primary.middleName,
        lastName: fields.lastName?.value ?? primary.lastName,
        birthDate: fields.dateOfBirth?.value ?? primary.birthDate,
        permanentAddressLine1: fields.address?.value ?? primary.permanentAddressLine1,
      });
      setMessage('Detected — please verify. OCR did not save or submit this application.');
    },
    onError: (e) =>
      setMessage(e instanceof Error ? e.message : 'OCR failed; continue with manual entry.'),
  });
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'cancelled') =>
      decideCustomerApplication(id!, decision, 'Reviewed by authorized staff.'),
    onSuccess: () => {
      setMessage('Decision recorded.');
      void existing.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Decision failed.'),
  });
  const reopen = useMutation({
    mutationFn: () => reopenCustomerApplication(id!),
    onSuccess: () => {
      setMessage('Application reopened as draft.');
      void existing.refetch();
      void client.invalidateQueries({ queryKey: ['customer-applications'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const editable = !existing.data || existing.data.status === 'draft';
  const selectedPlan = plans.data?.find((p) => p.id === planId);
  const relatedCustomer = customers.data?.find((c) => c.id === customerId);
  return (
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
          Approved: {existing.data.approvedAt ?? '—'} · Rejected: {existing.data.rejectedAt ?? '—'} ·
          Related customer: {relatedCustomer?.fullName ?? existing.data.customerId} · Related sale:{' '}
          {existing.data.saleId ?? '—'}
        </p>
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
            <select value={customerId} required onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer</option>
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
              {['spot_cash', 'move_a', 'installment_4_month', 'move_b1_40_12', 'move_b2_25_12'].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
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
        <p>
          <label>
            Upload ID for OCR{' '}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setOcrFile(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <Button onClick={() => ocr.mutate()} disabled={!ocrFile || !customerId || ocr.isPending}>
            Detect fields
          </Button>
        </p>
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
                label={key.replace(/[A-Z]/g, (c) => ` ${c}`).replace(/^./, (c) => c.toUpperCase())}
                value={value}
                type={key === 'acknowledgedAt' ? 'date' : 'text'}
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
          <legend>CERTIFICATION AND RESERVATION REQUIREMENTS</legend>
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
          <label>
            <input
              type="checkbox"
              checked={paymentProof}
              onChange={(e) => setPaymentProof(e.target.checked)}
            />{' '}
            Reservation payment proof received
          </label>
        </fieldset>
        <p>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save draft
          </Button>{' '}
          {id && editable ? (
            <Button onClick={() => submit.mutate()} disabled={!consent || submit.isPending}>
              Submit
            </Button>
          ) : null}{' '}
          {id && existing.data?.status === 'submitted' ? (
            <>
              <Button onClick={() => decide.mutate('approved')} disabled={decide.isPending}>
                Approve
              </Button>{' '}
              <Button onClick={() => decide.mutate('rejected')} disabled={decide.isPending}>
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
          {id && (existing.data?.status === 'draft' || existing.data?.status === 'submitted') ? (
            <Button onClick={() => decide.mutate('cancelled')} disabled={decide.isPending}>
              Cancel
            </Button>
          ) : null}{' '}
          {id ? (
            <>
              <Button onClick={() => void exportCustomerApplication(id, 'xlsx').then(saveFile)}>
                Export XLSX
              </Button>
              <Button onClick={() => void exportCustomerApplication(id, 'pdf').then(saveFile)}>
                Export PDF
              </Button>
            </>
          ) : null}
        </p>
      </fieldset>
    </section>
  );
}

export function ReservationAgreementsPage() {
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['reservation-agreements', status, tier, search],
    queryFn: () =>
      getReservationAgreements({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(search ? { search } : {}),
      }),
  });
  return (
    <section>
      <PageHeader
        title="IST Reservation Agreements"
        description="Contract snapshots remain separate from actual verified payment transactions."
        actions={<Link to="/admin/sales/reservations/new">New agreement</Link>}
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
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
        <label>
          Search
          <input
            value={search}
            placeholder="Reservation number"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {query.isError ? (
        <ErrorState title="Agreements could not be loaded" onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Reservation</th>
              <th>Tier</th>
              <th>Sale</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/admin/sales/reservations/${item.id}`}>{item.reservationNumber}</Link>
                </td>
                <td>{item.tier}</td>
                <td>{item.saleId}</td>
                <td>
                  <StatusChip label={item.status} />
                </td>
                <td>{item.submittedAt ?? '—'}</td>
                <td>{item.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [customerApplicationId, setCustomerApplicationId] = useState('');
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
    const agreement = existing.data;
    if (!agreement) return;
    const timer = window.setTimeout(() => {
      setSaleId(agreement.saleId);
      setCustomerApplicationId(agreement.customerApplicationId ?? '');
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
  const payload = (): CreateReservationAgreementRequest => ({
    saleId,
    ...(customerApplicationId ? { customerApplicationId } : {}),
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
      id ? updateReservationAgreement(id, payload()) : createReservationAgreement(payload()),
    onSuccess: (agreement) => {
      setMessage('Draft saved.');
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
    const preview = await previewOfficialFormImport(
      'reservation_agreement',
      await asBase64(file),
    );
    if (preview.errors.length) {
      setMessage(preview.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      return;
    }
    const f = preview.fields;
    if (f.sale_id) setSaleId(f.sale_id);
    if (f.customer_application_id) setCustomerApplicationId(f.customer_application_id);
    if (f.reservation_date) setDates((d) => ({ ...d, reservationDate: f.reservation_date ?? d.reservationDate }));
    if (f.agreement_date) setDates((d) => ({ ...d, agreementDate: f.agreement_date ?? d.agreementDate }));
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
      <fieldset disabled={!editable}>
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
        <label>
          Customer application (optional)
          <input
            value={customerApplicationId}
            placeholder="Application UUID"
            onChange={(e) => setCustomerApplicationId(e.target.value)}
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
                  ? { holderType: 'SECONDARY' as const, name: '', address: '', contactNumber: '', email: '', tinNumber: '' }
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
        <p>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save draft
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
              <Button onClick={() => void exportReservationAgreement(id, 'xlsx').then(saveFile)}>
                Export XLSX
              </Button>
              <Button onClick={() => void exportReservationAgreement(id, 'pdf').then(saveFile)}>
                Export PDF
              </Button>
            </>
          ) : null}
        </p>
      </fieldset>
    </section>
  );
}
