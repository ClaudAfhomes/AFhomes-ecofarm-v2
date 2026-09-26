import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog, ErrorState, notifySuccess, PageHeader, Skeleton } from '@jad/ui';
import {
  registerContentSchema,
  type RegisterQualificationQuestion,
  type RegisterContent,
} from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsAuthScreenCopyFields } from '../components/CmsAuthScreenCopyFields';
import { CmsTextField, CmsTextareaField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useRegisterCms, useUpdateRegisterCms } from '../hooks/useRegisterCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: RegisterContent, b: RegisterContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'register', label: 'Register Screen' },
  { id: 'steps', label: 'Wizard Step Titles' },
  { id: 'fields', label: 'Registration Form Fields' },
  { id: 'qualification', label: 'Qualification Questions' },
  { id: 'verify', label: 'Email Verification' },
  { id: 'status', label: 'Application Status' },
  { id: 'prompts', label: 'Submit & Links' },
] as const;

const QUAL_TRACKS = [
  { key: 'domestic' as const, label: 'Domestic' },
  { key: 'abroad' as const, label: 'Abroad' },
];

export function CmsRegisterPage() {
  const { data, isPending, isError, error, refetch } = useRegisterCms();
  const update = useUpdateRegisterCms();
  const [draft, setDraft] = useState<RegisterContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const { toggle, open, expandAll, collapseAll, isOpen } = useCmsAccordion(SECTION_DEFS);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (SECTION_DEFS.some((s) => s.id === hash)) return hash;
    }
    return 'register';
  });

  useEffect(() => {
    if (data && !draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate editable draft from fetched CMS data
      setDraft(structuredClone(data));
    }
  }, [data, draft]);

  useEffect(() => {
    if (!data || !draft) return;
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (hash && SECTION_DEFS.some((s) => s.id === hash)) {
      open(hash);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync hash to active nav state
      setActiveId(hash);
      setTimeout(() => {
        try {
          document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
          /* ignore scroll or history failure */
        }
      }, 100);
    }
  }, [data, draft, open]);

  useEffect(() => {
    if (!data || !draft) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = SECTION_DEFS.map((s) => s.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { root: null, rootMargin: '-80px 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [data, draft, isOpen]);

  useEffect(() => {
    if (!draft || !data) return;
    const dirty = isDirty(draft, data);
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draft, data]);

  const validation = useMemo(() => {
    if (!draft) return { success: false as const, errors: {} as Record<string, string> };
    const parsed = registerContentSchema.safeParse(draft);
    if (parsed.success) return { success: true as const, errors: {} as Record<string, string> };
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) errors[path] = issue.message;
    }
    return { success: false as const, errors };
  }, [draft]);

  if (isPending) {
    return (
      <section>
        <PageHeader
          title="Register CMS"
          description="Edit the member registration flow: brand, steps, form fields, qualification questions, verification, and status."
        />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader
          title="Register CMS"
          description="Edit the member registration flow: brand, steps, form fields, qualification questions, verification, and status."
        />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader
          title="Register CMS"
          description="Edit the member registration flow: brand, steps, form fields, qualification questions, verification, and status."
        />
        <ErrorState title="No content" message="Register content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'register':
        return (
          JSON.stringify(draft.copy) !== JSON.stringify(data.copy) ||
          JSON.stringify(draft.image) !== JSON.stringify(data.image)
        );
      case 'steps':
        return JSON.stringify(draft.stepTitles) !== JSON.stringify(data.stepTitles);
      case 'fields':
        return JSON.stringify(draft.fields) !== JSON.stringify(data.fields);
      case 'qualification':
        return JSON.stringify(draft.qualification) !== JSON.stringify(data.qualification);
      case 'verify':
        return JSON.stringify(draft.verifyEmail) !== JSON.stringify(data.verifyEmail);
      case 'status':
        return JSON.stringify(draft.status) !== JSON.stringify(data.status);
      case 'prompts':
        return (
          JSON.stringify(draft.submitLabel) !== JSON.stringify(data.submitLabel) ||
          JSON.stringify(draft.loginPrompt) !== JSON.stringify(data.loginPrompt)
        );
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const rootMap: Record<string, string> = {
      register: 'copy',
      steps: 'stepTitles',
      fields: 'fields',
      qualification: 'qualification',
      verify: 'verifyEmail',
      status: 'status',
    };
    const root = rootMap[key];
    if (!root) {
      if (key === 'prompts') {
        return Object.keys(validation.errors).some(
          (p) => p === 'submitLabel' || p.startsWith('loginPrompt'),
        );
      }
      return false;
    }
    if (!root) return false;
    return Object.keys(validation.errors).some(
      (path) => path === root || path.startsWith(`${root}.`),
    );
  };

  const setCopy = (patch: Partial<RegisterContent['copy']>) =>
    setDraft({ ...draft, copy: { ...draft.copy, ...patch } });
  const setRegField = <K extends keyof RegisterContent['fields']>(
    key: K,
    patch: Partial<RegisterContent['fields'][K]>,
  ) =>
    setDraft({
      ...draft,
      fields: { ...draft.fields, [key]: { ...draft.fields[key], ...patch } },
    });
  const setStep = (key: keyof RegisterContent['stepTitles'], value: string) =>
    setDraft({ ...draft, stepTitles: { ...draft.stepTitles, [key]: value } });

  const setQualTrack = (track: 'domestic' | 'abroad', value: RegisterQualificationQuestion[]) =>
    setDraft({ ...draft, qualification: { ...draft.qualification, [track]: value } });

  const addQuestion = (track: 'domestic' | 'abroad') => {
    const trackList = draft.qualification[track];
    const next: RegisterQualificationQuestion = {
      id: `qual-${track.slice(0, 2)}-${trackList.length + 1}`,
      question: '',
    };
    setQualTrack(track, [...trackList, next]);
  };

  const updateQuestion = (
    track: 'domestic' | 'abroad',
    index: number,
    patch: Partial<RegisterQualificationQuestion>,
  ) => {
    const trackList = draft.qualification[track].map((q, i) =>
      i === index ? { ...q, ...patch } : q,
    );
    setQualTrack(track, trackList);
  };

  const removeQuestion = (track: 'domestic' | 'abroad', index: number) => {
    const trackList = draft.qualification[track].filter((_, i) => i !== index);
    setQualTrack(track, trackList);
  };

  const onSave = () => {
    if (!draft || !valid) return;
    setSaveMessage(null);
    update.mutate(draft, {
      onSuccess: () => {
        notifySuccess({ title: 'Changes saved' });
        setLastSaved(new Date().toISOString());
      },
      onError: (err: unknown) => {
        setSaveMessage(err instanceof Error ? err.message : 'Failed to save changes');
      },
    });
  };

  const onCancel = () => {
    if (!dirty) {
      setDraft(structuredClone(data));
      return;
    }
    setShowCancelConfirm(true);
  };

  const confirmCancel = () => {
    setDraft(structuredClone(data));
    setShowCancelConfirm(false);
    setSaveMessage(null);
  };

  return (
    <section>
      <PageHeader
        title="Register CMS"
        description="Edit the member registration flow: brand, steps, form fields, qualification questions, verification, status, and page SEO."
      />
      <nav className={styles.anchorNav} aria-label="Register CMS sections">
        <h3 className={styles.anchorTitle}>Sections ({SECTION_DEFS.length})</h3>
        <ul className={styles.anchorList}>
          {SECTION_DEFS.map((s, idx) => {
            const isDirtySection = sectionDirty(s.id);
            const hasError = sectionHasError(s.id);
            const isActive = activeId === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`${styles.anchorLink} ${isActive ? styles.anchorLinkActive : ''} ${hasError ? styles.anchorLinkError : ''}`}
                  aria-label={`${s.label}${hasError ? ', has errors' : ''}${isDirtySection ? ', unsaved changes' : ''}${isActive ? ', current section' : ''}`}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(s.id);
                    if (el && typeof el.scrollIntoView === 'function') {
                      try {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      } catch {
                        /* ignore scroll or history failure */
                      }
                    }
                    toggleSection(s.id);
                    try {
                      history.pushState(null, '', `#${s.id}`);
                    } catch {
                      /* ignore scroll or history failure */
                    }
                  }}
                >
                  <span className={styles.stepBadge} aria-hidden="true">
                    {idx + 1}
                  </span>
                  {s.label}
                  {hasError ? (
                    <>
                      <span aria-hidden="true" className={styles.errorDot}>
                        !
                      </span>
                      <span className={styles.srOnly}> (has errors)</span>
                    </>
                  ) : null}
                  {isDirtySection ? (
                    <>
                      <span aria-hidden="true" className={styles.dirtyDot}>
                        •
                      </span>
                      <span className={styles.srOnly}> (unsaved changes)</span>
                    </>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
        <CmsAccordionControls
          sectionCount={SECTION_DEFS.length}
          expandAll={expandAll}
          collapseAll={collapseAll}
        />
      </nav>

      <div className={styles.stack}>
        {saveMessage ? (
          <p className={styles.saveNote} role="alert">
            {saveMessage}
          </p>
        ) : null}

        <CmsSectionCard
          id="register"
          index={1}
          title="Register Screen"
          description="Editorial image and copy for the member registration screen."
          dirty={dirty && sectionDirty('register')}
          collapsible
          open={isOpen('register')}
          onToggle={() => toggleSection('register')}
        >
          <CmsImageField
            label="Register brand image"
            value={draft.image}
            onChange={(next) => setDraft({ ...draft, image: next })}
            note="Editorial property image for the registration brand panel."
            errorId={validation.errors['image.id']}
            errorAlt={validation.errors['image.alt']}
          />
          <CmsAuthScreenCopyFields
            prefix="copy"
            value={draft.copy}
            onChange={setCopy}
            errors={validation.errors}
          />
        </CmsSectionCard>

        <CmsSectionCard
          id="steps"
          index={2}
          title="Wizard Step Titles"
          description="Headings for the five registration wizard steps."
          dirty={dirty && sectionDirty('steps')}
          collapsible
          open={isOpen('steps')}
          onToggle={() => toggleSection('steps')}
        >
          <CmsTextField
            label="Step 1: Program & Profile"
            value={draft.stepTitles.programProfile}
            onChange={(v) => setStep('programProfile', v)}
            maxLength={60}
            error={validation.errors['stepTitles.programProfile']}
          />
          <CmsTextField
            label="Step 2: Qualification"
            value={draft.stepTitles.qualification}
            onChange={(v) => setStep('qualification', v)}
            maxLength={60}
            error={validation.errors['stepTitles.qualification']}
          />
          <CmsTextField
            label="Step 3: Referral Code"
            value={draft.stepTitles.referral}
            onChange={(v) => setStep('referral', v)}
            maxLength={60}
            error={validation.errors['stepTitles.referral']}
          />
          <CmsTextField
            label="Step 4: Government ID"
            value={draft.stepTitles.governmentId}
            onChange={(v) => setStep('governmentId', v)}
            maxLength={60}
            error={validation.errors['stepTitles.governmentId']}
          />
          <CmsTextField
            label="Step 5: Account"
            value={draft.stepTitles.account}
            onChange={(v) => setStep('account', v)}
            maxLength={60}
            error={validation.errors['stepTitles.account']}
          />
        </CmsSectionCard>

        <CmsSectionCard
          id="fields"
          index={3}
          title="Registration Form Fields"
          description="Labels and hints for every registration form field."
          dirty={dirty && sectionDirty('fields')}
          collapsible
          open={isOpen('fields')}
          onToggle={() => toggleSection('fields')}
        >
          {(
            [
              ['programId', 'Program'],
              ['firstName', 'First Name'],
              ['middleInitial', 'Middle Initial'],
              ['lastName', 'Last Name'],
              ['nameSuffix', 'Name Suffix'],
              ['dateOfBirth', 'Date Of Birth'],
              ['gender', 'Gender'],
              ['countryCode', 'Country'],
              ['address', 'Address'],
              ['phone', 'Phone Number'],
              ['email', 'Email Address'],
              ['password', 'Password'],
              ['confirmPassword', 'Confirm Password'],
              ['referralCode', 'Sponsor / Referral Code'],
              ['idDocument', 'Government ID'],
              ['consent', 'Consent'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className={styles.fieldGroup}>
              <CmsTextField
                label={`${label} Label`}
                hint={`Public label for the ${label} field on the registration form.`}
                value={draft.fields[key].label}
                onChange={(v) => setRegField(key, { label: v })}
                maxLength={60}
                error={validation.errors[`fields.${key}.label`]}
              />
              <CmsTextareaField
                label={`${label} Hint`}
                hint={`Helper text shown under the ${label} field on the registration form.`}
                value={draft.fields[key].hint ?? ''}
                onChange={(v) => setRegField(key, { hint: v || undefined })}
                maxLength={200}
                rows={2}
                error={validation.errors[`fields.${key}.hint`]}
              />
            </div>
          ))}
        </CmsSectionCard>

        <CmsSectionCard
          id="qualification"
          index={4}
          title="Qualification Questions"
          description="Yes/No questions shown after the program step, split by program track (Domestic / Abroad). Content only - the public app decides which track to show."
          dirty={dirty && sectionDirty('qualification')}
          collapsible
          open={isOpen('qualification')}
          onToggle={() => toggleSection('qualification')}
        >
          {QUAL_TRACKS.map((track) => (
            <fieldset key={track.key} className={styles.qualTrack}>
              <legend className={styles.qualLegend}>{track.label}</legend>
              {draft.qualification[track.key].map((q, index) => (
                <div key={q.id} className={styles.qualItem}>
                  <CmsTextField
                    label="Question"
                    value={q.question}
                    onChange={(v) => updateQuestion(track.key, index, { question: v })}
                    maxLength={200}
                    error={validation.errors[`qualification.${track.key}.${index}.question`]}
                  />
                  <CmsTextareaField
                    label="Help (optional)"
                    value={q.help ?? ''}
                    onChange={(v) => updateQuestion(track.key, index, { help: v || undefined })}
                    maxLength={300}
                    rows={2}
                    error={validation.errors[`qualification.${track.key}.${index}.help`]}
                  />
                  <button
                    type="button"
                    className={styles.qualRemove}
                    aria-label={`Remove ${track.label} question ${index + 1}`}
                    onClick={() => removeQuestion(track.key, index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.qualAdd}
                onClick={() => addQuestion(track.key)}
              >
                Add {track.label} question
              </button>
            </fieldset>
          ))}
        </CmsSectionCard>

        <CmsSectionCard
          id="verify"
          index={5}
          title="Email Verification"
          description="Copy for the one-time-code email verification screen."
          dirty={dirty && sectionDirty('verify')}
          collapsible
          open={isOpen('verify')}
          onToggle={() => toggleSection('verify')}
        >
          <CmsAuthScreenCopyFields
            prefix="verifyEmail"
            value={draft.verifyEmail}
            onChange={(patch) =>
              setDraft({ ...draft, verifyEmail: { ...draft.verifyEmail, ...patch } })
            }
            errors={validation.errors}
          />
        </CmsSectionCard>

        <CmsSectionCard
          id="status"
          index={6}
          title="Application Status"
          description="Copy for the post-verification application status screen."
          dirty={dirty && sectionDirty('status')}
          collapsible
          open={isOpen('status')}
          onToggle={() => toggleSection('status')}
        >
          <CmsAuthScreenCopyFields
            prefix="status"
            value={draft.status}
            onChange={(patch) => setDraft({ ...draft, status: { ...draft.status, ...patch } })}
            errors={validation.errors}
          />
        </CmsSectionCard>

        <CmsSectionCard
          id="prompts"
          index={7}
          title="Submit & Links"
          description="Submit button and the link back to sign-in on the registration screen."
          dirty={dirty && sectionDirty('prompts')}
          collapsible
          open={isOpen('prompts')}
          onToggle={() => toggleSection('prompts')}
        >
          <CmsTextField
            label="Submit button"
            value={draft.submitLabel}
            onChange={(v) => setDraft({ ...draft, submitLabel: v })}
            maxLength={40}
            error={validation.errors['submitLabel']}
          />
          <CmsTextField
            label="Login prompt text"
            value={draft.loginPrompt.text}
            onChange={(v) => setDraft({ ...draft, loginPrompt: { ...draft.loginPrompt, text: v } })}
            maxLength={80}
            error={validation.errors['loginPrompt.text']}
          />
          <CmsTextField
            label="Login prompt link"
            value={draft.loginPrompt.linkLabel}
            onChange={(v) =>
              setDraft({ ...draft, loginPrompt: { ...draft.loginPrompt, linkLabel: v } })
            }
            maxLength={40}
            error={validation.errors['loginPrompt.linkLabel']}
          />
        </CmsSectionCard>

        <CmsFormActions
          dirty={dirty}
          valid={valid}
          saving={update.isPending}
          onSave={onSave}
          onCancel={onCancel}
          lastSaved={lastSaved}
        />
      </div>

      <ConfirmDialog
        open={showCancelConfirm}
        onCancel={() => setShowCancelConfirm(false)}
        onConfirm={confirmCancel}
        title="Discard changes?"
        message="You have unsaved edits to the registration content. Discard them and reload the saved version?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />
    </section>
  );

  function toggleSection(id: string) {
    toggle(id);
    setActiveId(id);
  }
}
