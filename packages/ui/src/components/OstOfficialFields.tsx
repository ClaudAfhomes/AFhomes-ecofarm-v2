import { GOVERNMENT_ID_TYPE_LABELS, governmentIdTypeSchema } from '@afhomes/contracts';
import { useId } from 'react';
import { TextField } from './TextField';
import { DateField } from './DateField';
import { FormField } from './FormField';
import { Select } from './Select';

/** Shared official supplemental fields for public and authorized manual entry.
 * Validation belongs to the shared contracts and server, never this renderer. */
export function OstOfficialFields({
  values,
  onChange,
  className,
  grouped = false,
}: {
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  className?: string;
  grouped?: boolean;
}) {
  const idPrefix = useId();
  if (grouped)
    return (
      <>
        {[
          { title: 'Identification', fields: ['governmentIdType', 'governmentIdNumber'] },
          {
            title: 'Program and personal details',
            fields: ['dateApplied', 'programCategory', 'vipCardType', 'sex', 'civilStatus'],
          },
          {
            title: 'Contact and employment',
            fields: [
              'telephone',
              'messenger',
              'tin',
              'employerName',
              'employerAddress',
              'jobPosition',
            ],
          },
          {
            title: 'Referrer details (optional)',
            fields: ['referrerTelephone', 'referrerMobile', 'referrerAddress', 'referrerMessenger'],
          },
          {
            title: 'Signature evidence',
            fields: [
              'applicantSignatureStatus',
              'applicantSignedOn',
              'referrerSignatureStatus',
              'referrerSignedOn',
            ],
          },
        ].map(({ title, fields }) => (
          <fieldset className={className} key={title}>
            <legend>{title}</legend>
            {fields.map((name) => {
              const id = `${idPrefix}-${name}`;
              const select = selects.find((field) => field.name === name);
              if (select) {
                const optional = name === 'vipCardType' && values.programCategory !== 'vip_holder';
                return (
                  <FormField key={name} id={id} label={select.label} optional={optional}>
                    <Select
                      id={id}
                      name={name}
                      value={values[name] ?? ''}
                      required={!optional}
                      onChange={(event) => onChange(name, event.target.value)}
                      options={select.options.map(([value, label]) => ({ value, label }))}
                    />
                  </FormField>
                );
              }
              const field = textFields.find(([fieldName]) => fieldName === name)!;
              const label = field[1].replace(' (optional)', '');
              if (field[2] === 'date') {
                const status =
                  name === 'applicantSignedOn'
                    ? 'applicantSignatureStatus'
                    : 'referrerSignatureStatus';
                return (
                  <DateField
                    key={name}
                    id={id}
                    name={name}
                    label={label}
                    value={values[name] ?? ''}
                    onChange={(value) => onChange(name, value)}
                    optional={name !== 'dateApplied' && values[status] !== 'received'}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                );
              }
              return (
                <TextField
                  key={name}
                  id={id}
                  name={name}
                  label={label}
                  value={values[name] ?? ''}
                  onChange={(value) => onChange(name, value)}
                  normalize={(value) => value}
                  optional={name !== 'governmentIdNumber'}
                  type={field[2] === 'tel' ? 'tel' : 'text'}
                  {...(name === 'governmentIdNumber'
                    ? {
                        hint: 'Enter the number printed on the selected ID.',
                        autoComplete: 'off',
                        maxLength: 100,
                      }
                    : {})}
                />
              );
            })}
          </fieldset>
        ))}
        <p>
          Signature status records the reviewed paper form; it does not replace a legal signature.
        </p>
      </>
    );
  return (
    <fieldset className={className}>
      <legend>Official accreditation details</legend>
      {textFields.map(([name, label, type]) => (
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
      </p>
    </fieldset>
  );
}
const textFields = [
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
  ['governmentIdNumber', 'Government ID number', 'text'],
  ['applicantSignedOn', 'Applicant signature date', 'date'],
  ['referrerSignedOn', 'Referrer signature date', 'date'],
] as const;
const selects: { name: string; label: string; options: [string, string][] }[] = [
  {
    name: 'governmentIdType',
    label: 'Government ID type',
    options: [
      ['', 'Choose ID type'],
      ...governmentIdTypeSchema.options.map((value): [string, string] => [
        value,
        GOVERNMENT_ID_TYPE_LABELS[value],
      ]),
    ],
  },
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
