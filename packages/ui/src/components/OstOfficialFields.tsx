/** Shared official supplemental fields for public and authorized manual entry.
 * Validation belongs to the shared contracts and server, never this renderer. */
export function OstOfficialFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <fieldset>
      <legend>Official accreditation details</legend>
      {[
        ['dateApplied', 'Date applied', 'date'],
        ['telephone', 'Telephone / landline', 'tel'],
        ['messenger', 'Facebook / Messenger', 'text'],
        ['tin', 'TIN (optional)', 'text'],
        ['employerName', 'Business / employer (optional)', 'text'],
        ['employerAddress', 'Business / employer address (optional)', 'text'],
        ['jobPosition', 'Job position (optional)', 'text'],
        ['referrerTelephone', 'Referrer telephone on the form (optional)', 'tel'],
        ['referrerMobile', 'Referrer mobile on the form (optional)', 'tel'],
        ['referrerAddress', 'Referrer address on the form (optional)', 'text'],
        ['referrerMessenger', 'Referrer Messenger on the form (optional)', 'text'],
        ['governmentIdType', 'Government ID type', 'text'],
        ['governmentIdNumber', 'Government ID number', 'text'],
        ['applicantSignedOn', 'Applicant signature date', 'date'],
        ['referrerSignedOn', 'Referrer signature date', 'date'],
      ].map(([name, label, type]) => (
        <label key={name}>
          {label}
          <input
            name={name}
            aria-label={label}
            type={type}
            value={values[name!] ?? ''}
            onChange={(e) => onChange(name!, e.target.value)}
            required={['dateApplied', 'governmentIdType', 'governmentIdNumber'].includes(name!)}
            max={type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
          />
        </label>
      ))}
      {selects.map(({ name, label, options }) => (
        <label key={name}>
          {label}
          <select
            aria-label={label}
            value={values[name] ?? ''}
            onChange={(e) => onChange(name, e.target.value)}
          >
            {options.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p>
        Signature status records the reviewed paper form; it does not replace a legal signature.
        Your Sales Manager must endorse this application before management approval.
      </p>
    </fieldset>
  );
}
const selects: { name: string; label: string; options: [string, string][] }[] = [
  {
    name: 'programCategory',
    label: 'Program category',
    options: [
      ['', 'Choose category'],
      ['vip_holder', 'VIP Privilege Card Holder'],
      ['non_vip', 'Non-VIP Client'],
      ['future_vip', 'Future VIP Privilege Card Holder'],
    ],
  },
  {
    name: 'vipCardType',
    label: 'VIP card tier',
    options: [
      ['', 'Not applicable'],
      ['BRONZE', 'Bronze'],
      ['SILVER', 'Silver'],
      ['GOLD', 'Gold'],
    ],
  },
  {
    name: 'sex',
    label: 'Sex',
    options: [
      ['', 'Choose'],
      ['female', 'Female'],
      ['male', 'Male'],
      ['prefer_not_to_say', 'Prefer not to say'],
    ],
  },
  {
    name: 'civilStatus',
    label: 'Civil status',
    options: [
      ['', 'Choose'],
      ['single', 'Single'],
      ['married', 'Married'],
      ['widowed', 'Widowed'],
      ['separated', 'Separated'],
    ],
  },
  {
    name: 'applicantSignatureStatus',
    label: 'Applicant signature',
    options: [
      ['pending', 'Pending'],
      ['received', 'Received'],
    ],
  },
  {
    name: 'referrerSignatureStatus',
    label: 'Referrer signature',
    options: [
      ['pending', 'Pending'],
      ['received', 'Received'],
    ],
  },
];
