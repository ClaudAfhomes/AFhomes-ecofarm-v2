import { describe, expect, it } from 'vitest';

import {
  buildPhoneRule,
  buildPhoneRuleForDial,
  composeE164Phone,
  createEmptyDraft,
  dialCodeOptions,
  sanitizeNationalInput,
  splitStoredPhone,
  validateBirthDateField,
  validateFullDraft,
  validateGenericAddress,
  validateMiddleInitialField,
  validatePersonNameField,
  validatePhoneField,
  validatePhoneFieldWithDial,
  validatePhilippineAddress,
  type CountryPhoneMeta,
} from './registrationValidation';

const PH_META: CountryPhoneMeta[] = [
  {
    code: 'PH',
    name: 'Philippines',
    dialCode: '63',
    phoneMin: 10,
    phoneMax: 10,
    phonePattern: '^9[0-9]{9}$',
  },
  { code: 'US', name: 'United States' },
];

describe('validatePersonNameField', () => {
  it.each(['Juan', 'De la Cruz', "O'Brien", 'Anne-Marie'])('accepts %s', (name) => {
    expect(validatePersonNameField(name, 'First name')).toBeUndefined();
  });

  it.each(['Juan3', 'J@ne', '', '   ', 'A'.repeat(61)])('rejects %s', (name) => {
    expect(validatePersonNameField(name, 'First name')).toMatch(/First name/i);
  });
});

describe('validateMiddleInitialField', () => {
  it('accepts empty only with the explicit N/A flag', () => {
    expect(validateMiddleInitialField('', true)).toBeUndefined();
    expect(validateMiddleInitialField('', false)).toMatch(/middle initial/i);
  });

  it.each(['A', 'A.', 'a'])('accepts %s', (value) => {
    expect(validateMiddleInitialField(value, false)).toBeUndefined();
  });

  it.each(['AB', '1', '-', 'A..'])('rejects %s', (value) => {
    expect(validateMiddleInitialField(value, false)).toMatch(/middle initial/i);
  });
});

describe('validatePhoneField', () => {
  it('validates PH numbers against the PH rule and normalizes', () => {
    expect(validatePhoneField('09185550101', 'PH', PH_META)).toBeUndefined();
    expect(validatePhoneField('+639185550101', 'PH', PH_META)).toBeUndefined();
  });

  it.each(['0918-CALL-ME', '0918555010', '08185550101', '', '   '])('rejects %s', (phone) => {
    expect(validatePhoneField(phone, 'PH', PH_META)).toMatch(/phone/i);
  });

  it('falls back to generic E.164 without country metadata', () => {
    expect(validatePhoneField('+14155552671', 'US', PH_META)).toBeUndefined();
    expect(validatePhoneField('123456', 'US', PH_META)).toMatch(/phone/i);
  });
});

describe('buildPhoneRule', () => {
  it('builds a curated rule from country metadata', () => {
    expect(buildPhoneRule(PH_META, 'PH')).toMatchObject({ dialCode: '63' });
  });

  it('falls back to generic when metadata or country is missing', () => {
    expect(buildPhoneRule(PH_META, 'US')).toMatchObject({ dialCode: '' });
    expect(buildPhoneRule([], 'PH')).toMatchObject({ dialCode: '' });
  });
});

describe('dialCodeOptions', () => {
  it('lists dial codes with country names and skips rows without one', () => {
    expect(dialCodeOptions(PH_META)).toEqual([
      { dial: '63', countryCode: 'PH', label: '+63 Philippines' },
    ]);
  });

  it('collapses duplicate dials and returns empty without metadata', () => {
    const dupes: CountryPhoneMeta[] = [
      { code: 'US', name: 'United States', dialCode: '1' },
      { code: 'CA', name: 'Canada', dialCode: '1' },
    ];
    expect(dialCodeOptions(dupes)).toEqual([
      { dial: '1', countryCode: 'US', label: '+1 United States' },
    ]);
    expect(dialCodeOptions(undefined)).toEqual([]);
  });
});

describe('buildPhoneRuleForDial', () => {
  it('resolves the rule of the country carrying the dial', () => {
    expect(buildPhoneRuleForDial(PH_META, '63')).toMatchObject({
      dialCode: '63',
      nationalLengths: [10],
    });
  });

  it('falls back to generic E.164 for unknown dials', () => {
    expect(buildPhoneRuleForDial(PH_META, '999')).toMatchObject({ dialCode: '' });
  });
});

describe('sanitizeNationalInput', () => {
  it('strips non-digits and caps at the limit (typing/paste can never exceed it)', () => {
    expect(sanitizeNationalInput('918555010a1b', '63', 10)).toBe('9185550101');
    expect(sanitizeNationalInput('9185550101999', '63', 10)).toBe('9185550101');
  });

  it('drops an embedded dial code or trunk zero only on overflow', () => {
    // Pasted international form: +63 917 555 0999.
    expect(sanitizeNationalInput('+63 917 555 0999', '63', 10)).toBe('9175550999');
    // Pasted trunk form: 09185550101.
    expect(sanitizeNationalInput('09185550101', '63', 10)).toBe('9185550101');
    // A bare national number at exactly the limit is untouched.
    expect(sanitizeNationalInput('9185550101', '63', 10)).toBe('9185550101');
    // US dial shares its digit with nationals - short values are untouched.
    expect(sanitizeNationalInput('14', '1', 10)).toBe('14');
    expect(sanitizeNationalInput('+14155552671', '1', 10)).toBe('4155552671');
  });

  it('returns empty for blank input', () => {
    expect(sanitizeNationalInput('   ', '63', 10)).toBe('');
  });
});

describe('splitStoredPhone', () => {
  it('splits canonical E.164 using the verified dial first', () => {
    expect(splitStoredPhone('+639185550101', PH_META, 'PH')).toEqual({
      dial: '63',
      national: '9185550101',
    });
  });

  it('splits trunk and bare-dial forms', () => {
    expect(splitStoredPhone('09185550101', PH_META, 'PH')).toEqual({
      dial: '63',
      national: '9185550101',
    });
    expect(splitStoredPhone('639185550101', PH_META, 'PH')).toEqual({
      dial: '63',
      national: '9185550101',
    });
  });

  it('never truncates overlong values so validation flags them', () => {
    expect(splitStoredPhone('09185550101999', PH_META, 'PH')).toEqual({
      dial: '63',
      national: '9185550101999',
    });
  });

  it('returns the verified dial with empty national for blank input', () => {
    expect(splitStoredPhone('', PH_META, 'PH')).toEqual({ dial: '63', national: '' });
  });
});

describe('composeE164Phone', () => {
  it('composes canonical E.164 from dial + national digits', () => {
    expect(composeE164Phone('63', '9185550101')).toBe('+639185550101');
    expect(composeE164Phone('', '9185550101')).toBe('+9185550101');
    expect(composeE164Phone('63', '')).toBe('');
  });
});

describe('validatePhoneFieldWithDial', () => {
  it('validates national digits against the selected dial rule', () => {
    expect(validatePhoneFieldWithDial('9185550101', '63', PH_META)).toBeUndefined();
    expect(validatePhoneFieldWithDial('918555010', '63', PH_META)).toMatch(/phone/i);
    expect(validatePhoneFieldWithDial('', '63', PH_META)).toMatch(/phone/i);
  });
});

describe('validateBirthDateField', () => {
  it('rejects empty, today, future, and invalid dates immediately', () => {
    expect(validateBirthDateField('', 18)).toMatch(/date of birth/i);
    expect(validateBirthDateField('2030-01-01', 18)).toMatch(/future|valid/i);
    expect(validateBirthDateField('2026-02-30', 18)).toMatch(/valid/i);
    expect(validateBirthDateField('not-a-date', 18)).toMatch(/valid/i);
  });

  it('rejects underage and implausibly old dates', () => {
    expect(validateBirthDateField('2010-01-01', 18)).toMatch(/at least 18/i);
    expect(validateBirthDateField('1890-01-01', 18)).toMatch(/valid/i);
  });

  it('accepts a valid adult birth date', () => {
    expect(validateBirthDateField('1990-01-01', 18)).toBeUndefined();
  });
});

describe('validatePhilippineAddress', () => {
  it('requires all three hierarchy codes', () => {
    const draft = {
      ...createEmptyDraft(),
      provinceCode: '0128',
      cityCode: '012801',
      barangayCode: '012801001',
    };
    expect(validatePhilippineAddress(draft)).toEqual({});
    expect(
      validatePhilippineAddress({ ...draft, barangayCode: '' }),
    ).toMatchObject({ barangayCode: expect.stringMatching(/barangay/i) });
  });
});

describe('validateGenericAddress', () => {
  it('requires region and city text', () => {
    const draft = { ...createEmptyDraft(), region: 'California', city: 'Los Angeles' };
    expect(validateGenericAddress(draft)).toEqual({});
    expect(validateGenericAddress({ ...draft, city: '  ' })).toMatchObject({
      city: expect.stringMatching(/city/i),
    });
  });
});

describe('validateFullDraft', () => {
  it('re-validates every step for final submission', () => {
    const errors = validateFullDraft(
      { ...createEmptyDraft(), firstName: 'Juan3' },
      { minAge: 18, countries: PH_META },
    );
    expect(errors.firstName).toMatch(/First name/i);
    expect(errors.phone).toMatch(/phone/i);
    expect(errors.dateOfBirth).toMatch(/date of birth/i);
  });

  it('passes a complete valid draft', () => {
    const errors = validateFullDraft(
      {
        ...createEmptyDraft(),
        programId: 'prg-domestic',
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        noMiddleInitial: true,
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        countryCode: 'PH',
        provinceCode: '0128',
        cityCode: '012801',
        barangayCode: '012801001',
        phoneDial: '63',
        phone: '9185550101',
        answers: { 'qual-001': 'Yes' },
        email: 'juan@example.com',
        password: 'password123',
        confirmPassword: 'password123',
        consent: true,
        idDocument: { fileName: 'id.png', mimeType: 'image/png', sizeBytes: 100 },
      },
      {
        minAge: 18,
        countries: PH_META,
        questions: [{ id: 'qual-001', questionText: 'Q?' }],
      },
    );
    expect(errors).toEqual({});
  });
});
