import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent, ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Link } from 'react-router';

import type { IdDocument, RegisterRequest } from '@jad/contracts';
import { capitalizePersonName, sanitizeMiddleInitial, sanitizePersonName } from '@jad/contracts';
import { Skeleton } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { usePrograms } from '../../public/hooks/usePrograms';
import { usePublicConfig } from '../../public/hooks/usePublicConfig';
import { usePolicyLinks } from '../../../hooks/usePolicyLinks';
import { getQualificationQuestions } from '../services/auth';
import { usePersistedDraft, clearPersistedDraft } from '../hooks/usePersistedDraft';
import { useLocationVerification } from '../hooks/useLocationVerification';
import { useBarangays, useCities, useProvinces } from '../hooks/useLocationOptions';
import {
  MAX_FILE_BYTES,
  STEP_FIELD_ORDER,
  answersToQualification,
  buildPhoneRuleForDial,
  composeE164Phone,
  cutoffDateForMinAge,
  firstInvalidField,
  maxNationalLength,
  sanitizeNationalInput,
  splitStoredPhone,
  stepForField,
  validateAccount,
  validateBirthDateField,
  validateFullDraft,
  validateIdDocument,
  validateProgramProfile,
  validateQualification,
  validateReferralCode,
} from '../registrationValidation';
import type { RegistrationDraft } from '../registrationValidation';
import { DateField } from './DateField';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';
import { SearchableSelect } from './SearchableSelect';
import { SelectField } from './SelectField';
import { TextField } from './TextField';
import { FieldError, FormField } from './FormField';
import { fieldStyles } from './fieldStyles';
import styles from './RegistrationForm.module.css';

export type RegistrationMode = 'create' | 'resubmit';

export interface RegistrationFormProps {
  submit: (payload: RegisterRequest | Partial<RegisterRequest>) => Promise<void>;
  mode?: RegistrationMode;
  /** Prefill (member resubmit) - profile + referral code from the member record. */
  initialDraft?: Partial<RegistrationDraft>;
}

const STEPS_CREATE: { title: string }[] = [
  { title: 'Program & profile' },
  { title: 'Qualification' },
  { title: 'Referral code' },
  { title: 'Government ID' },
  { title: 'Account' },
  { title: 'Review' },
];

const STEPS_RESUBMIT: { title: string }[] = [
  { title: 'Program & profile' },
  { title: 'Qualification' },
  { title: 'Referral code' },
  { title: 'Government ID' },
  { title: 'Review' },
];

const NAME_SUFFIX_OPTIONS: { value: string; label: string }[] = [
  { value: 'Jr.', label: 'Jr.' },
  { value: 'Sr.', label: 'Sr.' },
  { value: 'II', label: 'II' },
  { value: 'III', label: 'III' },
  { value: 'IV', label: 'IV' },
  { value: 'V', label: 'V' },
];

/** Inline retry affordance inside Alert bodies (matches the location alerts below). */
const RETRY_BUTTON_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  fontWeight: 600,
};

function Control(props: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={styles.controlLabel} htmlFor={props.id}>
        {props.label}
        {props.optional ? <span className={styles.optionalMark}>(Optional)</span> : null}
      </label>
      {props.children}
      {props.error ? (
        <FieldError id={`${props.id}-error`}>{props.error}</FieldError>
      ) : props.hint ? (
        <p id={`${props.id}-hint`} className={styles.hint}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Multi-step registration (SCR-AUTH-002) shared with the member resubmit screen
 * (SCR-AUTH-005). Program → profile → qualification → referral → government ID
 * → account (create mode only). Every step validates client-side (UX only) and
 * submits one contract-shaped payload through the caller's service function.
 * The ID file bytes ride along as base64 for the API upload (3 MB cap).
 */
function ConsentLinks() {
  const links = usePolicyLinks();
  const terms = links.terms;
  const privacy = links.privacy;
  return (
    <>
      {terms ? (
        <Link to={terms} className={styles.consentLink}>
          JA&amp;D member terms
        </Link>
      ) : (
        'JA&D member terms'
      )}{' '}
      and{' '}
      {privacy ? (
        <Link to={privacy} className={styles.consentLink}>
          privacy policy
        </Link>
      ) : (
        'privacy policy'
      )}
    </>
  );
}

export function RegistrationForm({ submit, mode = 'create', initialDraft }: RegistrationFormProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft, clearDraft, isDirty] = usePersistedDraft(mode, initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const idFileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [govDragOver, setGovDragOver] = useState(false);

  const shouldBlock = mode === 'create' && isDirty && !submitting;
  let blocker: unknown = null;
  try {
    // useBlocker requires a data router; fallback to null in tests/MemoryRouter
    blocker = useBlocker(shouldBlock);
  } catch {
    blocker = null;
  }

  useEffect(() => {
    if (!blocker) return;
    const state = (blocker as unknown as { state?: string }).state;
    if (state === 'blocked') {
      const confirmed = window.confirm(
        'You have unsaved registration progress. Leave this page and lose your progress?',
      );
      const b = blocker as unknown as { proceed?: () => void; reset?: () => void };
      if (confirmed) b.proceed?.();
      else b.reset?.();
    }
  }, [blocker]);

  const programs = usePrograms();
  const config = usePublicConfig();
  // Loaded-but-empty program list (e.g. reference data not yet seeded):
  // internal ids must never leak into visible copy - both display sites and
  // step-0 validation use this flag instead of falling back to the raw id.
  const programsUnavailable =
    !programs.isLoading && !programs.isError && (programs.data ?? []).length === 0;
  const questionsQuery = useQuery({
    queryKey: ['qualification-questions', draft.programId],
    queryFn: () => getQualificationQuestions(draft.programId),
    enabled: draft.programId.length > 0,
  });

  const steps = mode === 'resubmit' ? STEPS_RESUBMIT : STEPS_CREATE;
  const minAge = config.data?.minimumAge ?? 18;
  const genders = config.data?.genders ?? [];
  const countries = config.data?.countries ?? [];
  const questions = questionsQuery.data ?? [];
  const lastStep = steps.length - 1;
  const dobMax = cutoffDateForMinAge(minAge);
  // Verified country's dial - the dropdown default. The dial never mutates
  // `countryCode`: it only selects the phone rule (server re-validates
  // against the verified country authoritatively).
  const verifiedDial = countries.find((country) => country.code === draft.countryCode)?.dialCode;

  // Philippine address hierarchy - each level loads only when its parent is
  // selected (reference data pages from the server, never bundled).
  const provincesQuery = useProvinces(draft.countryCode);
  const citiesQuery = useCities(draft.provinceCode);
  const barangaysQuery = useBarangays(draft.cityCode);
  const provinceOptions = (provincesQuery.data ?? []).map((province) => ({
    value: province.code,
    label: province.name,
  }));
  const selectedTopKind = provincesQuery.data?.find(
    (province) => province.code === draft.provinceCode,
  )?.kind;
  // An independent city selected at the top level parents itself: the city
  // step is satisfied implicitly and only barangays load beneath it.
  const cityFixedToTop = selectedTopKind === 'city';
  const cityOptions = (citiesQuery.data ?? []).map((city) => ({
    value: city.code,
    label: city.name,
  }));
  const barangayOptions = (barangaysQuery.data ?? []).map((barangay) => ({
    value: barangay.code,
    label: barangay.name,
  }));

  // Handle legacy/custom gender values: if stored gender is not in the known list, treat as "Others" with detail
  useEffect(() => {
    if (!draft.gender || genders.length === 0) return;
    if (!genders.includes(draft.gender) && draft.gender !== 'Others') {
      const custom = draft.gender;
      setDraft((current) => ({
        ...current,
        gender: 'Others',
        genderOther: current.genderOther || custom,
      }));
    }
  }, [genders, draft.gender]);

  // Phone dial default + legacy migration: drafts stored before the split
  // (persisted v2 `phone` holding a trunk/E.164 string, resubmit prefills
  // from the canonical member phone) carry the full value in `phone` with an
  // empty `phoneDial`. Split once config metadata is available; defaults an
  // empty field to the verified country's dial. Never truncates overlong
  // values - those stay invalid so validation flags them.
  useEffect(() => {
    if (countries.length === 0 || draft.phoneDial) return;
    if (!draft.phone) {
      if (!verifiedDial) return;
      setDraft((current) => (current.phoneDial ? current : { ...current, phoneDial: verifiedDial }));
      return;
    }
    const split = splitStoredPhone(draft.phone, countries, draft.countryCode);
    setDraft((current) => {
      if (current.phoneDial) return current;
      const nextDial = split.dial || verifiedDial || '';
      if (nextDial === current.phoneDial && split.national === current.phone) return current;
      return { ...current, phoneDial: nextDial, phone: split.national };
    });
  }, [countries, draft.countryCode, draft.phone, draft.phoneDial, verifiedDial]);

  // Location verification - BE authoritative for Program/Country (read-only)
  const locationVerification = useLocationVerification(mode === 'create');

  // Sync verified program/country into draft when verification succeeds
  useEffect(() => {
    if (mode !== 'create') return;
    if (locationVerification.status === 'success' && locationVerification.data) {
      const { programId, verifiedCountryCode } = locationVerification.data;
      setDraft((current) => {
        const updates: Partial<RegistrationDraft> = {};
        if (programId && current.programId !== programId) updates.programId = programId;
        if (verifiedCountryCode && current.countryCode !== verifiedCountryCode)
          updates.countryCode = verifiedCountryCode;
        if (Object.keys(updates).length === 0) return current;
        return { ...current, ...updates };
      });
      // Clear any previous program/country errors once verified
      setErrors((current) => {
        if (!('programId' in current) && !('countryCode' in current)) return current;
        const next = { ...current };
        delete next['programId'];
        delete next['countryCode'];
        return next;
      });
    }
  }, [locationVerification.status, locationVerification.data, mode]);

  // Location reference failures are diagnosable states, not one opaque
  // message: log the underlying query error in dev consoles.
  useEffect(() => {
    if (provincesQuery.error && import.meta.env.DEV) {
      console.error('[register] provinces failed:', provincesQuery.error);
    }
  }, [provincesQuery.error]);

  // Always start at top of form when step changes (Continue / Back / Edit)
  useEffect(() => {
    // Defer to next frame so new step content is rendered - instant, no transition
    const id = requestAnimationFrame(() => {
      try {
        formRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        try {
          window.scrollTo(0, 0);
        } catch {}
      }
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  const update = <K extends keyof RegistrationDraft>(field: K, value: RegistrationDraft[K]) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      // Clear genderOther when gender changes away from Others
      if (field === 'gender' && value !== 'Others') {
        next.genderOther = '';
      }
      // The explicit N/A choice owns the middle-initial value
      if (field === 'noMiddleInitial' && value === true) {
        next.middleInitial = '';
      }
      return next;
    });
    setErrors((current) => {
      if (
        current[field] === undefined &&
        !(field === 'gender' && current['genderOther'] !== undefined) &&
        !(field === 'noMiddleInitial' && current['middleInitial'] !== undefined)
      )
        return current;
      const next = { ...current };
      delete next[field];
      if (field === 'gender') delete next['genderOther'];
      if (field === 'noMiddleInitial') delete next['middleInitial'];
      return next;
    });
  };

  /** Province change resets every dependent selection (never keep a stale city). */
  const updateProvince = (code: string) => {
    const topKind = provincesQuery.data?.find((province) => province.code === code)?.kind;
    setDraft((current) => ({
      ...current,
      provinceCode: code,
      cityCode: topKind === 'city' ? code : '',
      barangayCode: '',
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next['provinceCode'];
      delete next['cityCode'];
      delete next['barangayCode'];
      return next;
    });
  };

  /** City change resets the barangay selection. */
  const updateCity = (code: string) => {
    setDraft((current) => ({ ...current, cityCode: code, barangayCode: '' }));
    setErrors((current) => {
      const next = { ...current };
      delete next['cityCode'];
      delete next['barangayCode'];
      return next;
    });
  };

  /** Date of birth validates immediately (past-only, real calendar dates). */
  const updateDateOfBirth = (value: string) => {
    update('dateOfBirth', value);
    const message = value.trim() ? validateBirthDateField(value, minAge) : undefined;
    setErrors((current) => {
      const next = { ...current };
      if (message) next.dateOfBirth = message;
      else delete next.dateOfBirth;
      return next;
    });
  };

  /** Dial change re-caps the national input at the new country's limit. */
  const updatePhoneDial = (dial: string) => {
    const maxLen = maxNationalLength(buildPhoneRuleForDial(countries, dial));
    setDraft((current) => ({
      ...current,
      phoneDial: dial,
      phone: sanitizeNationalInput(current.phone, dial, maxLen),
    }));
    setErrors((current) => {
      if (current.phone === undefined) return current;
      const next = { ...current };
      delete next.phone;
      return next;
    });
  };

  /** National digits arrive sanitized + capped from PhoneField. */
  const updatePhoneNational = (value: string) => {
    update('phone', value);
  };

  /**
   * Person names shape input as-typed: digits, symbols, and control
   * characters never enter state, and casing formats to title case
   * (`orlando dela cruz` → `Orlando Dela Cruz`) while typing and pasting.
   * Format/length enforcement stays in the shared validators.
   */
  const updatePersonName = (field: 'firstName' | 'lastName', value: string) => {
    update(field, capitalizePersonName(sanitizePersonName(value)));
  };

  /**
   * Middle initial shapes input to a single letter as-typed: anything past
   * the first letter, digits, and symbols never enter state (typing and
   * paste both flow through onChange; `maxLength` backs it natively).
   * Single-letter/empty enforcement stays in the shared validators.
   */
  const updateMiddleInitial = (value: string) => {
    update('middleInitial', sanitizeMiddleInitial(value));
  };

  const stepErrors = (): Record<string, string> => {
    switch (step) {
      case 0: {
        const base = validateProgramProfile(draft, minAge, countries);
        // Without a program catalog the application cannot succeed
        // server-side - block here with a clear message instead of letting a
        // raw id through to submit.
        if (programsUnavailable) {
          return {
            ...base,
            programId: 'Programs are unavailable right now. Please try again shortly.',
          };
        }
        return base;
      }
      case 1:
        return validateQualification(draft.answers, questions);
      case 2:
        return validateReferralCode(draft.referralCode);
      case 3:
        return validateIdDocument(draft.idDocument);
      case 4:
        // In create mode step 4 is Account; in resubmit mode step 4 is Review (no validation)
        return mode === 'resubmit' ? {} : validateAccount(draft);
      default:
        // Review step - previously validated steps guarantee validity
        return {};
    }
  };

  const focusFirstError = (nextErrors: Record<string, string>) => {
    if (step === 1) {
      const unanswered = questions.find((question) => nextErrors[`answer_${question.id}`]);
      if (unanswered) document.getElementById(`reg-answer-${unanswered.id}`)?.focus();
      return;
    }
    const first = firstInvalidField(nextErrors, STEP_FIELD_ORDER[step] ?? []);
    if (first === 'idDocument') idFileRef.current?.focus();
    else document.getElementById(`reg-${first}`)?.focus();
  };

  /** Review-screen address line from server-shaped selections (codes resolve to names). */
  const formatReviewAddress = (): string => {
    const street = draft.address.trim();
    if (draft.countryCode === 'PH') {
      const provinceName = provinceOptions.find((o) => o.value === draft.provinceCode)?.label;
      const cityName =
        cityOptions.find((o) => o.value === draft.cityCode)?.label ??
        provinceOptions.find((o) => o.value === draft.cityCode)?.label;
      const barangayName = barangayOptions.find((o) => o.value === draft.barangayCode)?.label;
      return [street, barangayName, cityName, provinceName].filter(Boolean).join(', ') || '-';
    }
    if (draft.countryCode) {
      return [street, draft.city.trim(), draft.region.trim()].filter(Boolean).join(', ') || '-';
    }
    return street || '-';
  };

  const onNext = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = stepErrors();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(nextErrors);
      return;
    }
    setErrors({});
    if (step === lastStep) {
      void submitDraft();
      return;
    }
    setStep((current) => current + 1);
  };

  const onBack = () => {
    setErrors({});
    setServerError(undefined);
    setStep((current) => Math.max(0, current - 1));
  };

  const goToStep = (target: number) => {
    setErrors({});
    setServerError(undefined);
    setStep(target);
  };

  const submitDraft = async () => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      // Final gate: re-validate the whole draft. Step checks can be bypassed
      // through persisted-draft tampering or devtools edits; on failure jump
      // back to the earliest failing step instead of submitting.
      const fullErrors = validateFullDraft(
        draft,
        { minAge, countries, questions },
        mode === 'resubmit' ? { includeAccount: false } : undefined,
      );
      if (Object.keys(fullErrors).length > 0) {
        setErrors(fullErrors);
        setSubmitting(false);
        const target = Math.min(...Object.keys(fullErrors).map(stepForField));
        setStep(target);
        requestAnimationFrame(() => {
          if (target === 1) {
            const unanswered = questions.find((question) => fullErrors[`answer_${question.id}`]);
            if (unanswered) {
              document.getElementById(`reg-answer-${unanswered.id}`)?.focus();
              return;
            }
          }
          const order = STEP_FIELD_ORDER[target] ?? [];
          const first = firstInvalidField(fullErrors, order);
          if (first === 'idDocument') idFileRef.current?.focus();
          else if (first) document.getElementById(`reg-${first}`)?.focus();
        });
        return;
      }
      const effectiveGender = draft.gender === 'Others' ? draft.genderOther.trim() : draft.gender;
      const verificationId = locationVerification.data?.verificationId;
      const base = {
        programId: draft.programId,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        middleInitial: draft.noMiddleInitial ? undefined : draft.middleInitial.trim() || undefined,
        nameSuffix: draft.nameSuffix.trim() || undefined,
        dateOfBirth: draft.dateOfBirth,
        gender: effectiveGender,
        countryCode: draft.countryCode,
        address: draft.address.trim() || undefined,
        provinceCode: draft.provinceCode.trim() || undefined,
        cityCode: draft.cityCode.trim() || undefined,
        barangayCode: draft.barangayCode.trim() || undefined,
        region: draft.region.trim() || undefined,
        city: draft.city.trim() || undefined,
        phone: composeE164Phone(draft.phoneDial || verifiedDial || '', draft.phone),
        email: draft.email.trim(),
        password: draft.password,
        referralCode: draft.referralCode.trim() || undefined,
        qualificationAnswers: answersToQualification(draft.answers, questions),
        idDocument: draft.idDocument,
        ...(verificationId ? { verificationId } : {}),
      };
      if (mode === 'resubmit') {
        await submit({
          firstName: base.firstName,
          lastName: base.lastName,
          middleInitial: base.middleInitial,
          nameSuffix: base.nameSuffix,
          dateOfBirth: base.dateOfBirth,
          gender: base.gender,
          address: base.address,
          provinceCode: base.provinceCode,
          cityCode: base.cityCode,
          barangayCode: base.barangayCode,
          region: base.region,
          city: base.city,
          phone: base.phone,
          qualificationAnswers: base.qualificationAnswers,
          idDocument: base.idDocument,
        });
        clearDraft();
        clearPersistedDraft();
        return;
      }
      await submit(base as RegisterRequest);
      clearDraft();
      clearPersistedDraft();
    } catch (error) {
      setServerError(
        apiErrorMessage(error, 'We could not complete your application. Please try again shortly.'),
      );
      setSubmitting(false);
    }
  };

  if (programs.isLoading || config.isLoading) {
    return (
      <div className={styles.loading} role="status">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (programs.isError || config.isError) {
    return (
      <Alert variant="danger" title="We could not load the registration form">
        Please try again shortly, or contact us for assistance.
      </Alert>
    );
  }

  const programOptions = (programs.data ?? []).map((program) => ({
    value: program.id,
    label: program.name,
  }));

  // Resolved program label for the two read-only display sites below. Never
  // falls back to the raw program id - an unresolved id renders as an
  // explicit unavailable/unknown state instead of leaking internals.
  const programDisplayName = (() => {
    const match = programOptions.find((p) => p.value === draft.programId)?.label;
    if (match) return match;
    if (programsUnavailable) return 'Program list unavailable - please try again shortly.';
    return '-';
  })();

  return (
    <form ref={formRef} className={styles.form} noValidate onSubmit={onNext}>
      <ol className={styles.steps} aria-label="Registration progress">
        {steps.map((item, index) => (
          <li
            key={item.title}
            className={`${styles.step} ${index === step ? styles.stepCurrent : ''} ${index < step ? styles.stepDone : ''}`}
            aria-current={index === step ? 'step' : undefined}
            aria-label={`${index + 1}. ${item.title}`}
            title={item.title}
          >
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <span className={styles.srOnly}>{item.title}</span>
          </li>
        ))}
      </ol>

      {serverError ? (
        <Alert variant="danger" title="We could not complete your application">
          {serverError}
        </Alert>
      ) : null}

      <div className={styles.panel}>
        {step === 0 ? (
          <>
            <section className={styles.section} aria-labelledby="reg-section-program">
              <h2 id="reg-section-program" className={styles.stepTitle}>
                Program
              </h2>
            {/* Program & Country: read-only, derived from BE-verified location (GPS → IP fallback) */}
            {locationVerification.status === 'detecting' ||
            locationVerification.status === 'verifying' ? (
              <Alert variant="info" title="Detecting your location">
                Please allow location access when prompted. Your program and country will be set
                automatically based on verified location.
              </Alert>
            ) : null}
            {locationVerification.status === 'permission-denied' ? (
              <Alert variant="info" title="Location permission denied - using IP fallback">
                Your location permission was denied. We are verifying your location via IP address
                as an approved fallback.
              </Alert>
            ) : null}
            {locationVerification.status === 'unavailable' ||
            locationVerification.status === 'timeout' ? (
              <Alert variant="info" title="GPS unavailable - using IP fallback">
                Your device location is unavailable. Verifying via IP address instead.
              </Alert>
            ) : null}
            {locationVerification.status === 'failed' ? (
              <Alert variant="danger" title="Location verification failed">
                <span>{locationVerification.error ?? 'Could not verify your location.'} </span>
                <button
                  type="button"
                  onClick={locationVerification.retry}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                    fontWeight: 600,
                  }}
                >
                  Retry
                </button>
              </Alert>
            ) : null}
            {locationVerification.status === 'blocked' ? (
              <Alert variant="danger" title="Location requires exception">
                Your detected location is blocked for the selected program. Please request a
                location exception or contact support. Your program and country remain as detected
                and cannot be changed manually.
              </Alert>
            ) : null}
            {locationVerification.status === 'accuracy-fail' ? (
              <Alert variant="warning" title="Location could not be verified accurately">
                {locationVerification.error ??
                  'Your location accuracy could not be verified. Please try again or request an exception.'}{' '}
                <button
                  type="button"
                  onClick={locationVerification.retry}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                    fontWeight: 600,
                  }}
                >
                  Retry
                </button>
              </Alert>
            ) : null}
            <FormField id="reg-programId" label="Program" error={errors.programId}>
              {locationVerification.status === 'detecting' ||
              locationVerification.status === 'verifying' ? (
                <Skeleton style={{ height: 48 }} />
              ) : (
                <div
                  className={`${fieldStyles.input} ${fieldStyles.readOnlyInput}`}
                  id="reg-programId"
                  aria-readonly="true"
                  role="textbox"
                  aria-label="Program"
                >
                  {programDisplayName}
                </div>
              )}
            </FormField>
            </section>
            <hr className={styles.sectionDivider} aria-hidden="true" />
            <section className={styles.section} aria-labelledby="reg-section-personal">
              <h2 id="reg-section-personal" className={styles.stepTitle}>
                Personal
              </h2>
              <div className={styles.gridTwo}>
                <TextField
                  id="reg-firstName"
                name="firstName"
                label="First name"
                value={draft.firstName}
                onChange={(value) => updatePersonName('firstName', value)}
                error={errors.firstName}
                autoComplete="given-name"
                inputRef={undefined}
              />
              <TextField
                id="reg-lastName"
                name="lastName"
                label="Last name"
                value={draft.lastName}
                onChange={(value) => updatePersonName('lastName', value)}
                error={errors.lastName}
                autoComplete="family-name"
                inputRef={undefined}
              />
            </div>
            <div>
              <TextField
                id="reg-middleInitial"
                name="middleInitial"
                label="Middle initial"
                optional
                  hint="One letter, or select N/A below."
                  value={draft.middleInitial}
                  onChange={updateMiddleInitial}
                  error={errors.middleInitial}
                  autoComplete="off"
                  inputRef={undefined}
                  maxLength={1}
                  disabled={draft.noMiddleInitial}
              />
              <label className={styles.naRow} htmlFor="reg-noMiddleInitial">
                <input
                  id="reg-noMiddleInitial"
                  type="checkbox"
                  className={styles.naCheckbox}
                  checked={draft.noMiddleInitial}
                  onChange={(event) => update('noMiddleInitial', event.target.checked)}
                />
                <span>I don&apos;t have a middle initial (N/A)</span>
              </label>
            </div>
            <SelectField
              id="reg-nameSuffix"
              name="nameSuffix"
              label="Name suffix"
              optional
              value={draft.nameSuffix}
              onChange={(value) => update('nameSuffix', value)}
              options={NAME_SUFFIX_OPTIONS}
              error={errors.nameSuffix}
              hint="Optional"
            />
            <PhoneField
              dial={draft.phoneDial || verifiedDial || ''}
              national={draft.phone}
              countries={countries}
              error={errors.phone}
              onDialChange={updatePhoneDial}
              onNationalChange={updatePhoneNational}
            />
            <div className={styles.gridTwo}>
              <DateField
                id="reg-dateOfBirth"
                name="dateOfBirth"
                label="Date of birth"
                value={draft.dateOfBirth}
                onChange={updateDateOfBirth}
                error={errors.dateOfBirth}
                max={dobMax}
              />
              <SelectField
                id="reg-gender"
                name="gender"
                label="Gender"
                value={draft.gender}
                onChange={(value) => update('gender', value)}
                options={genders.map((gender) => ({ value: gender, label: gender }))}
                error={errors.gender}
              />
            </div>
            <FormField id="reg-countryCode" label="Country" error={errors.countryCode}>
              {locationVerification.status === 'detecting' ||
              locationVerification.status === 'verifying' ? (
                <Skeleton style={{ height: 48 }} />
              ) : (
                <div
                  className={`${fieldStyles.input} ${fieldStyles.readOnlyInput}`}
                  id="reg-countryCode"
                  aria-readonly="true"
                  role="textbox"
                  aria-label="Country"
                >
                  {(() => {
                    const name = countries.find((c) => c.code === draft.countryCode)?.name;
                    return name ?? (draft.countryCode ? draft.countryCode : '-');
                  })()}
                </div>
              )}
            </FormField>
            {draft.gender === 'Others' ? (
              <TextField
                id="reg-genderOther"
                name="genderOther"
                label="Please specify"
                value={draft.genderOther}
                onChange={(value) => update('genderOther', value)}
                error={errors.genderOther}
                autoComplete="off"
                placeholder="Enter your gender identity"
              />
            ) : null}
            <TextField
              id="reg-address"
              name="address"
              label="Street / building / unit"
              optional
              hint="Optional - house number, street, subdivision or village."
              value={draft.address}
              onChange={(value) => update('address', value)}
              error={errors.address}
              autoComplete="street-address"
              inputRef={undefined}
            />
            {draft.countryCode === 'PH' ? (
              <>
                {provincesQuery.isPending ? (
                  <Skeleton style={{ height: 48 }} />
                ) : provincesQuery.isError ? (
                  <Alert variant="danger" title="Location list unavailable">
                    <span>
                      Province options could not be loaded. Check your connection and{' '}
                    </span>
                    <button
                      type="button"
                      onClick={() => provincesQuery.refetch()}
                      style={RETRY_BUTTON_STYLE}
                    >
                      Retry
                    </button>
                  </Alert>
                ) : provinceOptions.length === 0 ? (
                  <Alert variant="warning" title="Location data not loaded">
                    <span>
                      No provinces are available yet - the location reference data has not
                      been loaded into the database.{' '}
                    </span>
                    <button
                      type="button"
                      onClick={() => provincesQuery.refetch()}
                      style={RETRY_BUTTON_STYLE}
                    >
                      Retry
                    </button>
                  </Alert>
                ) : (
                  <SearchableSelect
                    id="reg-provinceCode"
                    name="provinceCode"
                    label="Province"
                    value={draft.provinceCode}
                    options={provinceOptions}
                    onChange={updateProvince}
                    error={errors.provinceCode}
                    hint="Search and select your province."
                  />
                )}
                {!cityFixedToTop && draft.provinceCode ? (
                  citiesQuery.isPending ? (
                    <Skeleton style={{ height: 48 }} />
                  ) : citiesQuery.isError ? (
                    <Alert variant="danger" title="Location list unavailable">
                      <span>City options could not be loaded. </span>
                      <button
                        type="button"
                        onClick={() => citiesQuery.refetch()}
                        style={RETRY_BUTTON_STYLE}
                      >
                        Retry
                      </button>
                    </Alert>
                  ) : (
                    <SearchableSelect
                      id="reg-cityCode"
                      name="cityCode"
                      label="City / municipality"
                      value={draft.cityCode}
                      options={cityOptions}
                      onChange={updateCity}
                      error={errors.cityCode}
                      hint="Search and select your city or municipality."
                    />
                  )
                ) : null}
                {cityFixedToTop ? (
                  <FormField id="reg-cityFixed" label="City / municipality">
                    <div
                      className={`${fieldStyles.input} ${fieldStyles.readOnlyInput}`}
                      id="reg-cityFixed"
                      aria-readonly="true"
                      role="textbox"
                      aria-label="City / municipality"
                    >
                      {provinceOptions.find((option) => option.value === draft.provinceCode)
                        ?.label ?? draft.provinceCode}
                    </div>
                  </FormField>
                ) : null}
                {draft.cityCode ? (
                  barangaysQuery.isPending ? (
                    <Skeleton style={{ height: 48 }} />
                  ) : barangaysQuery.isError ? (
                    <Alert variant="danger" title="Location list unavailable">
                      <span>Barangay options could not be loaded. </span>
                      <button
                        type="button"
                        onClick={() => barangaysQuery.refetch()}
                        style={RETRY_BUTTON_STYLE}
                      >
                        Retry
                      </button>
                    </Alert>
                  ) : (
                    <SearchableSelect
                      id="reg-barangayCode"
                      name="barangayCode"
                      label="Barangay"
                      value={draft.barangayCode}
                      options={barangayOptions}
                      onChange={(value) => update('barangayCode', value)}
                      error={errors.barangayCode}
                      hint="Search and select your barangay."
                    />
                  )
                ) : null}
              </>
            ) : draft.countryCode ? (
              <div className={styles.gridTwo}>
                <TextField
                  id="reg-region"
                  name="region"
                  label="Region / state"
                  value={draft.region}
                  onChange={(value) => update('region', value)}
                  error={errors.region}
                  autoComplete="address-level1"
                  inputRef={undefined}
                />
                <TextField
                  id="reg-city"
                  name="city"
                  label="City"
                  value={draft.city}
                  onChange={(value) => update('city', value)}
                  error={errors.city}
                  autoComplete="address-level2"
                  inputRef={undefined}
                />
              </div>
            ) : null}
            </section>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2 className={styles.stepTitle}>Qualification</h2>
            <p className={styles.stepLead}>
              Confirm you meet the membership qualification requirements. (Question content is
              provisional - awaiting final JA&amp;D approval.)
            </p>
            {questionsQuery.isLoading ? (
              <div
                className={styles.loading}
                role="status"
                aria-label="Loading qualification questions"
              >
                <Skeleton />
                <Skeleton />
              </div>
            ) : questions.length === 0 ? (
              <p className={styles.reviewEmpty}>
                No additional questions for this program - you may continue.
              </p>
            ) : (
              <fieldset className={styles.questions}>
                {questions.map((question, index) => (
                  <div key={question.id}>
                    <label className={styles.questionLabel} htmlFor={`reg-answer-${question.id}`}>
                      {index + 1}. {question.questionText}
                    </label>
                    <select
                      id={`reg-answer-${question.id}`}
                      className={`${fieldStyles.input} ${errors[`answer_${question.id}`] ? fieldStyles.inputError : ''}`}
                      name={`answer_${question.id}`}
                      value={draft.answers[question.id] ?? ''}
                      onChange={(event) =>
                        update('answers', { ...draft.answers, [question.id]: event.target.value })
                      }
                      aria-invalid={errors[`answer_${question.id}`] ? true : undefined}
                      aria-describedby={`reg-answer-${question.id}-error`}
                      required
                    >
                      <option value="">{'Select an answer\u2026'}</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                    {errors[`answer_${question.id}`] ? (
                      <FieldError id={`reg-answer-${question.id}-error`}>
                        {errors[`answer_${question.id}`]}
                      </FieldError>
                    ) : null}
                  </div>
                ))}
              </fieldset>
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className={styles.stepTitle}>Referral code</h2>
            <TextField
              id="reg-referralCode"
              name="referralCode"
              label="Sponsor / referral code"
              optional
              hint="Optional - leave blank if you were not referred by a member. The code is validated against active members."
              value={draft.referralCode}
              onChange={(value) => update('referralCode', value)}
              error={errors.referralCode}
              autoComplete="off"
              inputRef={undefined}
            />
            {mode === 'resubmit' ? (
              <p className={styles.note}>Your referral code stays the same when you resubmit.</p>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className={styles.stepTitle}>Government ID</h2>
            <p className={styles.stepLead}>
              Attach a clear copy of a valid government-issued ID. JA&amp;D reviews documents
              manually, and your file is uploaded securely and used only to verify your identity.
            </p>
            <Control
              id="reg-idDocument"
              label="Government ID copy"
              hint={`JPG, PNG, WebP or PDF - max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB`}
              error={errors.idDocument}
            >
              <div
                role="button"
                tabIndex={0}
                className={`${styles.fileDropzone} ${govDragOver ? styles.fileDropzoneOver : ''} ${errors.idDocument ? styles.fileDropzoneError : ''}`}
                onClick={() => idFileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    idFileRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setGovDragOver(true);
                }}
                onDragLeave={() => setGovDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setGovDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const doc: IdDocument = {
                      fileName: file.name,
                      mimeType: file.type || 'application/octet-stream',
                      sizeBytes: file.size,
                    };
                    update('idDocument', doc);
                  }
                }}
                aria-label="Upload Government ID"
                aria-invalid={errors.idDocument ? true : undefined}
                aria-describedby={
                  errors.idDocument ? 'reg-idDocument-error' : 'reg-idDocument-hint'
                }
              >
                {draft.idDocument ? (
                  <div className={styles.fileCard}>
                    <span className={styles.fileName}>{draft.idDocument.fileName}</span>
                    <span className={styles.fileSize}>
                      {(draft.idDocument.sizeBytes / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <button
                      type="button"
                      className={styles.fileRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        update('idDocument', undefined);
                      }}
                      aria-label="Remove selected file"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className={styles.filePlaceholder}>
                    <span className={styles.fileIcon} aria-hidden>
                      ⤓
                    </span>
                    <span className={styles.fileText}>
                      <strong>Drop file or click to browse</strong>
                    </span>
                    <span className={styles.fileHint}>
                      JPG, PNG, WebP or PDF - max {(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={idFileRef}
                id="reg-idDocument"
                type="file"
                accept="image/*,.pdf"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    update('idDocument', undefined);
                    return;
                  }
                  // Capture bytes for the API upload alongside metadata.
                  const reader = new FileReader();
                  reader.onload = () => {
                    const idDocument: IdDocument = {
                      fileName: file.name,
                      mimeType: file.type || 'application/octet-stream',
                      sizeBytes: file.size,
                      data: typeof reader.result === 'string' ? reader.result : undefined,
                    };
                    update('idDocument', idDocument);
                  };
                  reader.onerror = () => {
                    update('idDocument', undefined);
                  };
                  reader.readAsDataURL(file);
                }}
                tabIndex={-1}
                aria-hidden="true"
                style={{ display: 'none' }}
                required
              />
            </Control>
          </>
        ) : null}

        {step === 4 && mode === 'create' ? (
          <>
            <h2 className={styles.stepTitle}>Create your account</h2>
            <TextField
              id="reg-email"
              name="email"
              type="email"
              label="Email address"
              value={draft.email}
              onChange={(value) => update('email', value)}
              error={errors.email}
              autoComplete="email"
              inputMode="email"
              inputRef={undefined}
            />
            <PasswordField
              id="reg-password"
              label="Password"
              hint="At least 8 characters."
              value={draft.password}
              onChange={(value) => update('password', value)}
              autoComplete="new-password"
              error={errors.password}
            />
            <PasswordField
              id="reg-confirmPassword"
              label="Confirm password"
              value={draft.confirmPassword}
              onChange={(value) => update('confirmPassword', value)}
              autoComplete="new-password"
              error={errors.confirmPassword}
            />
            <div className={styles.consent}>
              <label className={styles.consentLabel} htmlFor="reg-consent">
                <input
                  id="reg-consent"
                  className={styles.consentInput}
                  type="checkbox"
                  name="consent"
                  checked={draft.consent}
                  onChange={(event) => update('consent', event.target.checked)}
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? 'reg-consent-error' : undefined}
                  required
                />
                <span>
                  I agree to the <ConsentLinks />.
                </span>
              </label>
              {errors.consent ? (
                <FieldError id="reg-consent-error">{errors.consent}</FieldError>
              ) : null}
            </div>
          </>
        ) : null}

        {(mode === 'create' && step === 5) || (mode === 'resubmit' && step === 4) ? (
          <>
            <h2 className={styles.stepTitle}>Review your application</h2>
            <p className={styles.stepLead}>
              Please review your details before submitting. You can edit any section.
            </p>

            <div className={styles.reviewGrid}>
              <section className={styles.reviewSection}>
                <div className={styles.reviewHeader}>
                  <h3 className={styles.reviewTitle}>Personal information</h3>
                  <button type="button" className={styles.reviewEdit} onClick={() => goToStep(0)}>
                    Edit
                  </button>
                </div>
                <dl className={styles.reviewList}>
                  <div className={styles.reviewRow}>
                    <dt>Name</dt>
                    <dd>
                      {[
                        draft.firstName,
                        draft.noMiddleInitial ? 'N/A' : draft.middleInitial,
                        draft.lastName,
                        draft.nameSuffix,
                      ]
                        .filter(Boolean)
                        .join(' ') || '-'}
                    </dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Date of birth</dt>
                    <dd>{draft.dateOfBirth || '-'}</dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Gender</dt>
                    <dd>
                      {draft.gender === 'Others'
                        ? draft.genderOther?.trim() || 'Others'
                        : draft.gender || '-'}
                    </dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Country</dt>
                    <dd>
                      {countries.find((c) => c.code === draft.countryCode)?.name ??
                        draft.countryCode ??
                        '-'}
                    </dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Phone</dt>
                    <dd>
                      {draft.phone
                        ? composeE164Phone(draft.phoneDial || verifiedDial || '', draft.phone)
                        : '-'}
                    </dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Address</dt>
                    <dd>{formatReviewAddress()}</dd>
                  </div>
                  <div className={styles.reviewRow}>
                    <dt>Program</dt>
                    <dd>{programDisplayName}</dd>
                  </div>
                </dl>
              </section>

              <section className={styles.reviewSection}>
                <div className={styles.reviewHeader}>
                  <h3 className={styles.reviewTitle}>Qualification</h3>
                  <button type="button" className={styles.reviewEdit} onClick={() => goToStep(1)}>
                    Edit
                  </button>
                </div>
                {questions.length === 0 ? (
                  <p className={styles.reviewEmpty}>No additional questions for this program.</p>
                ) : (
                  <dl className={styles.reviewList}>
                    {questions.map((q) => (
                      <div key={q.id} className={styles.reviewRow}>
                        <dt>{q.questionText}</dt>
                        <dd>{draft.answers[q.id]?.trim() || '-'}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              <section className={styles.reviewSection}>
                <div className={styles.reviewHeader}>
                  <h3 className={styles.reviewTitle}>Referral</h3>
                  <button type="button" className={styles.reviewEdit} onClick={() => goToStep(2)}>
                    Edit
                  </button>
                </div>
                <dl className={styles.reviewList}>
                  <div className={styles.reviewRow}>
                    <dt>Referral code</dt>
                    <dd>{draft.referralCode.trim() || 'None (no code provided)'}</dd>
                  </div>
                </dl>
              </section>

              <section className={styles.reviewSection}>
                <div className={styles.reviewHeader}>
                  <h3 className={styles.reviewTitle}>Government ID</h3>
                  <button type="button" className={styles.reviewEdit} onClick={() => goToStep(3)}>
                    Edit
                  </button>
                </div>
                <dl className={styles.reviewList}>
                  <div className={styles.reviewRow}>
                    <dt>File</dt>
                    <dd className={styles.reviewFile}>
                      {draft.idDocument
                        ? `${draft.idDocument.fileName} · ${(draft.idDocument.sizeBytes / 1024 / 1024).toFixed(2)} MB`
                        : '-'}
                    </dd>
                  </div>
                </dl>
              </section>

              {mode === 'create' ? (
                <section className={styles.reviewSection}>
                  <div className={styles.reviewHeader}>
                    <h3 className={styles.reviewTitle}>Account</h3>
                    <button type="button" className={styles.reviewEdit} onClick={() => goToStep(4)}>
                      Edit
                    </button>
                  </div>
                  <dl className={styles.reviewList}>
                    <div className={styles.reviewRow}>
                      <dt>Email</dt>
                      <dd>{draft.email || '-'}</dd>
                    </div>
                    <div className={styles.reviewRow}>
                      <dt>Password</dt>
                      <dd>••••••••</dd>
                    </div>
                    <div className={styles.reviewRow}>
                      <dt>Terms</dt>
                      <dd>{draft.consent ? 'Accepted' : 'Not accepted'}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}
            </div>

            <Alert variant="info" title="What happens next?">
              Your application will be reviewed by JA&amp;D after email verification. Your
              membership becomes active after verification and approval. You will see your status on
              the status screen and can sign in once approved.
            </Alert>
          </>
        ) : null}
      </div>

      <div className={styles.nav}>
        {step > 0 ? (
          <button
            type="button"
            className={styles.backButton}
            onClick={onBack}
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            Back
          </button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={
            submitting ||
            questionsQuery.isLoading ||
            (mode === 'create' && step === 0 && locationVerification.status !== 'success')
          }
          className={styles.primaryButton}
          aria-label={
            questionsQuery.isLoading
              ? 'Loading qualification questions'
              : locationVerification.status === 'detecting' ||
                  locationVerification.status === 'verifying'
                ? 'Verifying location'
                : undefined
          }
        >
          {questionsQuery.isLoading
            ? 'Loading…'
            : step === lastStep
              ? mode === 'resubmit'
                ? 'Resubmit Application'
                : 'Create My Account'
              : 'Continue'}
        </Button>
      </div>
    </form>
  );
}
