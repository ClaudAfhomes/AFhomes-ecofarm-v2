import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation, useSearchParams } from 'react-router';

import { RegisterPage } from './RegisterPage';
import { mockFetchRoutes, renderWithProviders } from '../../../test/utils';

vi.mock('../hooks/useLocationVerification', () => {
  // Stable reference across renders - mirrors the real hook (React Query keeps
  // `data` referentially stable), so sync effects in the form settle instead
  // of re-firing on every render.
  const stable = {
    status: 'success' as const,
    data: {
      verifiedCountryCode: 'PH',
      programId: 'prg-domestic',
      method: 'GPS' as const,
      blocked: false,
      requiresException: false,
      verificationId: '550e8400-e29b-41d4-a716-446655440001',
    },
    error: null,
    retry: vi.fn(),
  };
  return { useLocationVerification: () => stable };
});

const CONFIG = {
  minimumAge: 18,
  genders: ['Male', 'Female', 'LGBT'],
  countries: [
    {
      code: 'PH',
      name: 'Philippines',
      dialCode: '63',
      phoneMin: 10,
      phoneMax: 10,
      phonePattern: '^9[0-9]{9}$',
    },
  ],
};

const LOCATIONS = {
  '/locations/provinces': {
    data: [
      { code: '0128', name: 'Ilocos Norte', kind: 'province' },
      { code: '133900', name: 'City of Manila', kind: 'city' },
    ],
    meta: {},
  },
  '/locations/cities': {
    data: [
      { code: '012801', name: 'Laoag City', provinceCode: '0128', kind: 'city' },
      { code: '012802', name: 'Adams', provinceCode: '0128', kind: 'municipality' },
    ],
    meta: {},
  },
  '/locations/barangays': {
    // Static fetch mock (no per-city branching): the server filters by
    // parent in production (covered by API specs); the UI only renders rows.
    data: [
      { code: '012801001', name: 'Brgy 1', cityCode: '012801' },
      { code: '133900001', name: 'Brgy 2', cityCode: '133900' },
    ],
    meta: {},
  },
};

const PROGRAMS = {
  data: [
    {
      id: 'prg-domestic',
      code: 'DOMESTIC',
      name: 'Domestic',
      description: 'JA&D membership for applicants within the Philippines.',
    },
  ],
  meta: {},
};

const QUESTIONS = {
  data: [
    {
      id: 'qual-001',
      questionText: 'Are you at least 18 years old and able to enter into a contract?',
    },
  ],
  meta: {},
};

const APPLICATION = {
  application: {
    id: 'mem-005',
    email: 'ana.nueva@example.com',
    status: 'PENDING',
    emailVerified: false,
    createdAt: '2026-08-20T10:00:00.000Z',
  },
};

function VerifyEmailProbe() {
  const location = useLocation();
  const [params] = useSearchParams();
  const stateEmail = (location.state as { email?: string } | null)?.email;
  const queryEmail = params.get('email');
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem('jad:register:email');
  } catch {
    stored = null;
  }
  const email = stateEmail ?? queryEmail ?? stored;
  return <div>Check your email: {email}</div>;
}

function renderRegister() {
  mockFetchRoutes({
    '/config/public': CONFIG,
    '/programs': PROGRAMS,
    '/programs/prg-domestic/qualification-questions': QUESTIONS,
    ...LOCATIONS,
    '/registration/location-verify': {
      verifiedCountryCode: 'PH',
      programId: 'prg-domestic',
      method: 'IP',
      blocked: false,
    },
    '/auth/register': { body: APPLICATION, status: 201 },
  });
  return renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/verify-email" element={<VerifyEmailProbe />} />
    </Routes>,
    { route: '/register' },
  );
}

describe('RegisterPage', () => {
  it('renders the multi-step registration experience with all required controls', async () => {
    renderRegister();

    expect(await screen.findByRole('heading', { name: 'Join JA&D' })).toBeInTheDocument();
    expect(await screen.findByText('Program & profile')).toBeInTheDocument();
    expect(screen.getByText('Qualification')).toBeInTheDocument();
    expect(screen.getByText('Referral code')).toBeInTheDocument();
    expect(screen.getByText('Government ID')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();

    // Program and Country are read-only, populated from mocked location verification
    expect(screen.getByRole('textbox', { name: 'Program' })).toBeInTheDocument();
    expect(screen.getByText('Domestic')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Country' })).toBeInTheDocument();
    expect(screen.getByText('Philippines')).toBeInTheDocument();
    // Step 0 is split into visibly distinct Program and Personal sections.
    expect(screen.getByRole('heading', { name: 'Program' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Personal' })).toBeInTheDocument();
    // Cannot be manually changed - no selectOptions for Program/Country
    expect(screen.queryByRole('combobox', { name: 'Program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument();
    expect(screen.queryByText('Based on your detected location')).not.toBeInTheDocument();

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('validates required fields on the first step', async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Enter your first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your last name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter your date of birth.')).toBeInTheDocument();
    expect(screen.getByText('Select your gender.')).toBeInTheDocument();
    expect(screen.getByText('Select your province.')).toBeInTheDocument();
  });

  it('shapes name input as-typed and still validates phone numbers and birth dates inline', async () => {
    const user = userEvent.setup();
    renderRegister();
    const continueButton = await screen.findByRole('button', { name: 'Continue' });

    // Digits never enter the name fields while typing.
    await user.type(screen.getByLabelText('First name'), 'Ana3');
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    // Symbols and digits are stripped from pasted names the same way, and
    // casing formats to title case.
    await user.click(screen.getByLabelText('Last name'));
    await user.paste('John@Doe123');
    expect(screen.getByLabelText('Last name')).toHaveValue('Johndoe');
    await user.clear(screen.getByLabelText('Last name'));
    await user.type(screen.getByLabelText('Last name'), 'orlando dela cruz');
    expect(screen.getByLabelText('Last name')).toHaveValue('Orlando Dela Cruz');

    await user.type(screen.getByLabelText('Phone number'), '0918-CALL-ME');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2030-05-05' } });
    await user.selectOptions(screen.getByLabelText('Gender'), 'Male');
    await user.click(continueButton);

    expect(screen.queryByText('Enter a valid first name.')).not.toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid date of birth.')).toBeInTheDocument();

    // Pasted values validate the same way (normalization runs first).
    await user.clear(screen.getByLabelText('Phone number'));
    await user.click(screen.getByLabelText('Phone number'));
    await user.paste('  09185550101  ');
    await user.click(continueButton);
    expect(screen.queryByText('Enter a valid phone number.')).not.toBeInTheDocument();
  });

  it('shapes the middle initial to a single letter unless N/A is selected', async () => {
    const user = userEvent.setup();
    renderRegister();
    const continueButton = await screen.findByRole('button', { name: 'Continue' });

    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Nueva');
    // Extra letters never enter the field while typing.
    await user.type(screen.getByLabelText(/Middle initial/), 'AB');
    expect(screen.getByLabelText(/Middle initial/)).toHaveValue('A');
    // Digits are rejected outright.
    await user.clear(screen.getByLabelText(/Middle initial/));
    await user.type(screen.getByLabelText(/Middle initial/), '1');
    expect(screen.getByLabelText(/Middle initial/)).toHaveValue('');
    // Pasting keeps only the first valid letter.
    await user.click(screen.getByLabelText(/Middle initial/));
    await user.paste('A1');
    expect(screen.getByLabelText(/Middle initial/)).toHaveValue('A');
    // Lowercase input converts to uppercase.
    await user.clear(screen.getByLabelText(/Middle initial/));
    await user.type(screen.getByLabelText(/Middle initial/), 'b');
    expect(screen.getByLabelText(/Middle initial/)).toHaveValue('B');

    await user.type(screen.getByLabelText('Phone number'), '09185550101');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-01-15' } });
    await user.selectOptions(screen.getByLabelText('Gender'), 'Male');
    await user.click(continueButton);
    expect(
      screen.queryByText('Use one letter (A-Z) for your middle initial, or select N/A.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/I don't have a middle initial/));
    await user.click(continueButton);
    expect(
      screen.queryByText('Use one letter (A-Z) for your middle initial, or select N/A.'),
    ).not.toBeInTheDocument();
  });

  it('resets dependent locations when the parent changes', async () => {    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('button', { name: 'Continue' });

    await user.click(screen.getByRole('combobox', { name: 'Province' }));
    await user.click(await screen.findByRole('option', { name: 'Ilocos Norte' }));
    await user.click(screen.getByRole('combobox', { name: 'City / municipality' }));
    await user.click(await screen.findByRole('option', { name: 'Laoag City' }));
    await user.click(screen.getByRole('combobox', { name: 'Barangay' }));
    await user.click(await screen.findByRole('option', { name: 'Brgy 1' }));
    expect(screen.getByRole('combobox', { name: 'Barangay' })).toHaveValue('Brgy 1');

    // Switching province clears city and barangay (stale selections never submit).
    await user.click(screen.getByRole('combobox', { name: 'Province' }));
    await user.click(await screen.findByRole('option', { name: 'City of Manila' }));
    expect(screen.queryByRole('combobox', { name: 'City / municipality' })).not.toBeInTheDocument();
    // Barangay now follows the independent city directly.
    await user.click(screen.getByRole('combobox', { name: 'Barangay' }));
    await user.click(await screen.findByRole('option', { name: 'Brgy 2' }));
    expect(screen.getByRole('combobox', { name: 'Barangay' })).toHaveValue('Brgy 2');
  });

  it('never leaks a raw program id when the program catalog is empty', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      '/config/public': CONFIG,
      '/programs': { data: [], meta: {} },
      '/programs/prg-domestic/qualification-questions': QUESTIONS,
    });
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/verify-email" element={<VerifyEmailProbe />} />
      </Routes>,
      { route: '/register' },
    );

    expect(await screen.findByRole('heading', { name: 'Join JA&D' })).toBeInTheDocument();
    // Read-only field shows the unavailable state, never the internal id -
    // even though location verification resolved programId prg-domestic.
    expect(
      await screen.findByText('Program list unavailable - please try again shortly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('prg-domestic')).not.toBeInTheDocument();

    // Progression is blocked with a field-level message until programs load.
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText('Programs are unavailable right now. Please try again shortly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('prg-domestic')).not.toBeInTheDocument();
  });

  it('catches tampered persisted drafts at the next validation gate', async () => {    // Attacker-influenced storage (XSS/extensions can rewrite it): invalid
    // values restored into state must still hit field errors, never submit.
    sessionStorage.setItem(
      'jad:register:draft:v2',
      JSON.stringify({
        programId: 'prg-domestic',
        firstName: 'Juan3',
        lastName: 'Dela Cruz',
        countryCode: 'PH',
        phone: '0918-CALL-ME',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        unknownField: 'dropped',
        answers: { 'qual-001': 42 },
      }),
    );
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('button', { name: 'Continue' });

    // Tampered values surface in state (restored) but fail validation.
    expect(screen.getByLabelText('First name')).toHaveValue('Juan3');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a valid first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(screen.getByText('Select your province.')).toBeInTheDocument();
  });

  it('shows a retryable error when the province list fails to load', async () => {
    const fetchFn = mockFetchRoutes({
      '/config/public': CONFIG,
      '/programs': PROGRAMS,
      '/programs/prg-domestic/qualification-questions': QUESTIONS,
      '/locations/provinces': {
        body: { error: { code: 'INTERNAL', message: 'boom' } },
        status: 500,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
      </Routes>,
      { route: '/register' },
    );
    await screen.findByRole('button', { name: 'Continue' });

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      const calls = fetchFn.mock.calls.filter(([input]) =>
        String(input).includes('/locations/provinces'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows a distinct empty state when location data is not seeded', async () => {
    mockFetchRoutes({
      '/config/public': CONFIG,
      '/programs': PROGRAMS,
      '/programs/prg-domestic/qualification-questions': QUESTIONS,
      '/locations/provinces': { data: [], meta: {} },
    });
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
      </Routes>,
      { route: '/register' },
    );
    await screen.findByRole('button', { name: 'Continue' });

    expect(await screen.findByText(/has not been loaded into the database/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  it('submits the full application through every step and routes to email verification', async () => {
    const fetchFn = mockFetchRoutes({
      '/config/public': CONFIG,
      '/programs': PROGRAMS,
      '/programs/prg-domestic/qualification-questions': QUESTIONS,
      ...LOCATIONS,
      '/auth/register': { body: APPLICATION, status: 201 },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/verify-email" element={<VerifyEmailProbe />} />
      </Routes>,
      { route: '/register' },
    );

    const continueButton = await screen.findByRole('button', { name: 'Continue' });

    // Step 0 - program & profile - Program/Country are read-only from mocked location verification
    expect(await screen.findByText('Domestic')).toBeInTheDocument();
    expect(await screen.findByText('Philippines')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument();
    // Can continue once location verification is successful (mocked as immediate success)
    await waitFor(() => expect(continueButton).toBeEnabled());

    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Nueva');
    await user.click(screen.getByLabelText(/I don't have a middle initial/));
    await user.type(screen.getByLabelText('Phone number'), '+63 917 555 0999');
    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '1990-01-15' },
    });
    await user.selectOptions(screen.getByLabelText('Gender'), 'Male');
    // Philippine address hierarchy: province → city → barangay.
    await user.click(screen.getByRole('combobox', { name: 'Province' }));
    await user.click(await screen.findByRole('option', { name: 'Ilocos Norte' }));
    await user.click(screen.getByRole('combobox', { name: 'City / municipality' }));
    await user.click(await screen.findByRole('option', { name: 'Laoag City' }));
    await user.click(screen.getByRole('combobox', { name: 'Barangay' }));
    await user.click(await screen.findByRole('option', { name: 'Brgy 1' }));
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    // Step 1 - qualification questions (loaded once a program is chosen).
    expect(await screen.findByText(/Are you at least 18 years old/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Are you at least 18 years old/), 'Yes');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2 - optional referral code (left blank).
    expect(await screen.findByRole('heading', { name: 'Referral code' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 3 - government ID (metadata only).
    expect(await screen.findByRole('heading', { name: 'Government ID' })).toBeInTheDocument();
    const idFile = new File(['id-copy'], 'id-copy.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Government ID copy'), {
      target: { files: [idFile] },
    });
    // File bytes load async via FileReader - wait before continuing.
    expect(await screen.findByText('id-copy.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 4 - account.
    expect(await screen.findByText('Create your account')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'ana.nueva@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByLabelText(/I agree to the JA/));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 5 - review.
    expect(
      await screen.findByRole('heading', { name: 'Review your application' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create My Account' }));

    // Routes to email verification carrying the applicant's email (SCR-AUTH-003).
    expect(await screen.findByText('Check your email: ana.nueva@example.com')).toBeInTheDocument();

    const registerCall = fetchFn.mock.calls.find(([input]) =>
      String(input).endsWith('/auth/register'),
    );
    expect(registerCall).toBeDefined();
    const body = JSON.parse(String((registerCall as [RequestInfo, RequestInit])[1].body)) as Record<
      string,
      unknown
    >;
    expect(body.programId).toBe('prg-domestic');
    expect(body.firstName).toBe('Ana');
    expect(body.lastName).toBe('Nueva');
    // Split phone field composes canonical E.164 on submit.
    expect(body.phone).toBe('+639175550999');
    expect(body.middleInitial).toBeUndefined();
    expect(body.provinceCode).toBe('0128');
    expect(body.cityCode).toBe('012801');
    expect(body.barangayCode).toBe('012801001');
    expect(body.email).toBe('ana.nueva@example.com');
    expect(body.password).toBe('password123');
    expect(body.qualificationAnswers).toEqual([{ questionId: 'qual-001', answer: 'Yes' }]);
    expect(body.idDocument).toEqual({
      fileName: 'id-copy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: idFile.size,
      data: expect.stringMatching(/^data:application\/pdf;base64,/),
    });
    expect(body.referralCode).toBeUndefined();
    // verificationId is BE-authoritative and passed through registration (backward compat if absent, but present when location succeeded)
    expect(body.verificationId).toBe('550e8400-e29b-41d4-a716-446655440001');
  }, 30000);
});
