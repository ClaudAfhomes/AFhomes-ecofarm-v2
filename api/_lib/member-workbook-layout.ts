/** Official company v2 labels. Technical v1 remains a separate, explicit contract. */
export const COMPANY_IDENTITY = [
  ['AAI Number', 'aa_number'],
  ['First Name', 'first_name'],
  ['Middle Name', 'middle_name'],
  ['Last Name', 'last_name'],
  ['Email Address', 'email'],
  ['Mobile Number', 'mobile'],
  ['Date of Birth', 'birth_date'],
  ['Age (Auto)', 'age'],
  ['Sex', 'sex'],
  ['Civil Status', 'civil_status'],
  ['Province / Region', 'province'],
  ['City / Municipality', 'city'],
  ['Barangay', 'barangay'],
  ['Permanent Address Line 1', 'address_line_1'],
  ['Postal Code (Auto)', 'postal_code'],
] as const;
const DETAILS = [
  ['Applicant Name (Auto)', 'applicant_name'],
  ['Government ID Type', 'government_id_type'],
  ['Government ID Number', 'government_id_number'],
  ['TIN', 'tin'],
  ['Telephone', 'telephone'],
  ['Messenger', 'messenger'],
  ['Employer Name', 'employer_name'],
  ['Employer Address', 'employer_address'],
] as const;
export function companyLayout(
  kind: 'IST' | 'OST',
): Record<string, readonly (readonly [string, string])[]> {
  return {
    Identity: COMPANY_IDENTITY.map(([label, field], i) => [
      i === 0 && kind === 'OST' ? 'AAO Number' : label,
      field,
    ]),
    Team: [
      ['Applicant Name (Auto)', 'applicant_name'],
      [kind === 'IST' ? 'Position' : 'Head Member Role', kind === 'IST' ? 'position' : 'head_role'],
      ['Head Member Name', 'head_member'],
      [kind === 'IST' ? 'Hierarchy Check (Auto)' : 'Head Member Check (Auto)', 'head_check'],
      ['Search Head Member (All Rows)', 'head_search'],
    ],
    Details: kind === 'IST' ? [...DETAILS, ['Job Position', 'job_position']] : DETAILS,
    ...(kind === 'OST'
      ? {
          Accreditation: [
            ['Applicant Name (Auto)', 'applicant_name'],
            ['Accreditation Start Date', 'starts_on'],
            ['Accreditation Expiry Date (Auto)', 'expires_on'],
            ['Date Applied', 'date_applied'],
            ['Program Category', 'program_category'],
            ['VIP Card Type', 'vip_card_type'],
            ['Applicant Signature', 'applicant_signature'],
            ['Referrer Signature', 'referrer_signature'],
            ['Applicant Signed On', 'applicant_signed_on'],
            ['Referrer Signed On', 'referrer_signed_on'],
          ] as const,
        }
      : {}),
  };
}
export const COMPANY_ROLES: Record<string, string> = {
  'Vice Director': 'vice_director',
  'Senior Sales Manager': 'senior_sales_manager',
  'Sales Manager': 'sales_manager',
};
export const COMPANY_ID_TYPES: Record<string, string> = {
  'Philippine ID': 'philippine_id',
  "Driver's License": 'drivers_license',
  Passport: 'passport',
  'Tax ID': 'tax_id',
  Other: 'other',
};
