import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog, ErrorState, notifySuccess, PageHeader, Skeleton } from '@jad/ui';
import { loginContentSchema, type LoginContent } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsAuthScreenCopyFields } from '../components/CmsAuthScreenCopyFields';
import { CmsTextField, CmsTextareaField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useLoginCms, useUpdateLoginCms } from '../hooks/useLoginCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: LoginContent, b: LoginContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'login', label: 'Login Screen' },
  { id: 'fields', label: 'Login Form Fields' },
  { id: 'prompts', label: 'Submit & Links' },
] as const;

export function CmsLoginPage() {
  const { data, isPending, isError, error, refetch } = useLoginCms();
  const update = useUpdateLoginCms();
  const [draft, setDraft] = useState<LoginContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const { toggle, open, expandAll, collapseAll, isOpen } = useCmsAccordion(SECTION_DEFS);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (SECTION_DEFS.some((s) => s.id === hash)) return hash;
    }
    return 'login';
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
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
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
    const parsed = loginContentSchema.safeParse(draft);
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
          title="Login CMS"
          description="Edit the member sign-in screen: brand assets, copy, form field labels, and links."
        />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader
          title="Login CMS"
          description="Edit the member sign-in screen: brand assets, copy, form field labels, and links."
        />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader
          title="Login CMS"
          description="Edit the member sign-in screen: brand assets, copy, form field labels, and links."
        />
        <ErrorState title="No content" message="Login content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'login':
        return (
          JSON.stringify(draft.copy) !== JSON.stringify(data.copy) ||
          JSON.stringify(draft.image) !== JSON.stringify(data.image)
        );
      case 'fields':
        return JSON.stringify(draft.fields) !== JSON.stringify(data.fields);
      case 'prompts':
        return (
          JSON.stringify(draft.submitLabel) !== JSON.stringify(data.submitLabel) ||
          JSON.stringify(draft.forgotPassword) !== JSON.stringify(data.forgotPassword) ||
          JSON.stringify(draft.registerPrompt) !== JSON.stringify(data.registerPrompt)
        );
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const rootMap: Record<string, string> = {
      login: 'copy',
      fields: 'fields',
      prompts: 'submitLabel',
    };
    const root = rootMap[key];
    if (!root) return false;
    return Object.keys(validation.errors).some(
      (path) => path === root || path.startsWith(`${root}.`),
    );
  };

  const setCopy = (patch: Partial<LoginContent['copy']>) =>
    setDraft({ ...draft, copy: { ...draft.copy, ...patch } });
  const setField = <K extends keyof LoginContent['fields']>(
    key: K,
    patch: Partial<LoginContent['fields'][K]>,
  ) =>
    setDraft({ ...draft, fields: { ...draft.fields, [key]: { ...draft.fields[key], ...patch } } });
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
        title="Login CMS"
        description="Edit the member sign-in screen: brand assets, copy, form field labels, links, and page SEO."
      />
      <nav className={styles.anchorNav} aria-label="Login CMS sections">
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
          id="login"
          index={1}
          title="Login Screen"
          description="Editorial image and copy for the member sign-in screen."
          dirty={dirty && sectionDirty('login')}
          collapsible
          open={isOpen('login')}
          onToggle={() => toggleSection('login')}
        >
          <CmsImageField
            label="Login brand image"
            value={draft.image}
            onChange={(next) => setDraft({ ...draft, image: next })}
            note="Editorial property image for the login brand panel."
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
          id="fields"
          index={2}
          title="Login Form Fields"
          description="Labels and hints for the sign-in form fields."
          dirty={dirty && sectionDirty('fields')}
          collapsible
          open={isOpen('fields')}
          onToggle={() => toggleSection('fields')}
        >
          <CmsTextField
            label="Identifier label"
            hint="Public label for the member identifier (email or username) on the sign-in form."
            value={draft.fields.identifier.label}
            onChange={(v) => setField('identifier', { label: v })}
            maxLength={60}
            error={validation.errors['fields.identifier.label']}
          />
          <CmsTextareaField
            label="Identifier hint"
            hint="Helper text shown under the identifier field on the sign-in form."
            value={draft.fields.identifier.hint ?? ''}
            onChange={(v) => setField('identifier', { hint: v || undefined })}
            maxLength={200}
            rows={2}
            error={validation.errors['fields.identifier.hint']}
          />
          <CmsTextField
            label="Password label"
            hint="Public label for the password field on the sign-in form."
            value={draft.fields.password.label}
            onChange={(v) => setField('password', { label: v })}
            maxLength={60}
            error={validation.errors['fields.password.label']}
          />
          <CmsTextareaField
            label="Password hint"
            hint="Helper text shown under the password field on the sign-in form."
            value={draft.fields.password.hint ?? ''}
            onChange={(v) => setField('password', { hint: v || undefined })}
            maxLength={200}
            rows={2}
            error={validation.errors['fields.password.hint']}
          />
        </CmsSectionCard>

        <CmsSectionCard
          id="prompts"
          index={3}
          title="Submit & Links"
          description="Button and supporting link copy for the login screen."
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
            label="Forgot password link"
            value={draft.forgotPassword.label}
            onChange={(v) =>
              setDraft({ ...draft, forgotPassword: { ...draft.forgotPassword, label: v } })
            }
            maxLength={40}
            error={validation.errors['forgotPassword.label']}
          />
          <CmsTextField
            label="Register prompt text"
            value={draft.registerPrompt.text}
            onChange={(v) =>
              setDraft({ ...draft, registerPrompt: { ...draft.registerPrompt, text: v } })
            }
            maxLength={80}
            error={validation.errors['registerPrompt.text']}
          />
          <CmsTextField
            label="Register prompt link"
            value={draft.registerPrompt.linkLabel}
            onChange={(v) =>
              setDraft({ ...draft, registerPrompt: { ...draft.registerPrompt, linkLabel: v } })
            }
            maxLength={40}
            error={validation.errors['registerPrompt.linkLabel']}
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
        message="You have unsaved edits to the login content. Discard them and reload the saved version?"
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
