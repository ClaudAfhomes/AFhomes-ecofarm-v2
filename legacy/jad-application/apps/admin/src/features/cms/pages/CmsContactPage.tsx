import { useEffect, useMemo, useState } from 'react';

import { Link } from 'react-router';

import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  notifySuccess,
  PageHeader,
  Skeleton,
} from '@jad/ui';
import { contactContentSchema, type ContactContent, type ContactMethod } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsCtaFields } from '../components/CmsCtaFields';
import {
  CmsSelectField,
  CmsTextField,
  CmsTextareaField,
  CmsToggleField,
} from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useGlobalCms } from '../hooks/useGlobalCms';
import { useContactCms, useUpdateContactCms } from '../hooks/useContactCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: ContactContent, b: ContactContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const METHOD_ICON_OPTIONS = [
  { value: 'messenger', label: 'Messenger' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'location', label: 'Location' },
];

const SECTION_DEFS = [
  { id: 'page', label: 'Page Header' },
  { id: 'hero', label: 'Hero' },
  { id: 'methods', label: 'Contact Methods' },
  { id: 'form', label: 'Message Form' },
  { id: 'cta', label: 'CTA Band' },
  { id: 'details', label: 'Footer Details' },
] as const;

export function CmsContactPage() {
  const { data, isPending, isError, error, refetch } = useContactCms();
  const update = useUpdateContactCms();
  const { data: globalData } = useGlobalCms();
  const [draft, setDraft] = useState<ContactContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [editingMethod, setEditingMethod] = useState<number | null>(null);
  const [methodSnapshot, setMethodSnapshot] = useState<ContactMethod | null>(null);
  const [deletingMethodIdx, setDeletingMethodIdx] = useState<number | null>(null);
  const { openId, toggle, open, expandAll, collapseAll, isOpen } = useCmsAccordion(SECTION_DEFS);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (SECTION_DEFS.some((s) => s.id === hash)) return hash;
    }
    return 'page';
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
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  }, [data, draft, openId]);

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
    const parsed = contactContentSchema.safeParse(draft);
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
        <PageHeader title="Contact CMS" description="Manage the public Contact page content." />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader title="Contact CMS" description="Manage the public Contact page content." />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader title="Contact CMS" description="Manage the public Contact page content." />
        <ErrorState title="No content" message="Contact content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'page':
        return JSON.stringify(draft.title) !== JSON.stringify(data.title);
      case 'hero':
        return JSON.stringify(draft.hero) !== JSON.stringify(data.hero);
      case 'methods':
        return JSON.stringify(draft.methods) !== JSON.stringify(data.methods);
      case 'form':
        return JSON.stringify(draft.form) !== JSON.stringify(data.form);
      case 'cta':
        return JSON.stringify(draft.cta) !== JSON.stringify(data.cta);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const prefixMap: Record<string, string> = {
      page: 'title',
      hero: 'hero.',
      methods: 'methods',
      form: 'form.',
      cta: 'cta.',
    };
    const prefix = prefixMap[key];
    if (!prefix) return false;
    if (key === 'page') {
      return Object.keys(validation.errors).some((k) => k === 'title');
    }
    return Object.keys(validation.errors).some((k) => k.startsWith(prefix) || k === prefix);
  };

  const toggleSection = (id: string) => {
    toggle(id);
    setActiveId(id);
  };

  const onSave = async () => {
    if (!valid) return;
    try {
      await update.mutateAsync(draft);
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSaved(`just now at ${now}`);
      notifySuccess({ title: 'Changes saved' });
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onCancel = () => {
    if (dirty) setShowCancelConfirm(true);
    else setDraft(structuredClone(data));
  };

  const confirmCancel = () => {
    setShowCancelConfirm(false);
    setDraft(structuredClone(data));
  };

  const moveMethod = (from: number, to: number) => {
    if (to < 0 || to >= draft.methods.length) return;
    const next = [...draft.methods];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDraft({ ...draft, methods: next });
  };

  return (
    <section>
      <PageHeader title="Contact CMS" description="Manage the public Contact page content." />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="Contact sections">
        <h3 className={styles.anchorTitle}>Sections ({SECTION_DEFS.length})</h3>
        <ul className={styles.anchorList}>
          {SECTION_DEFS.map((s, idx) => {
            const isDirty = sectionDirty(s.id);
            const hasError = sectionHasError(s.id);
            const isActive = activeId === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`${styles.anchorLink} ${isActive ? styles.anchorLinkActive : ''} ${hasError ? styles.anchorLinkError : ''}`}
                  aria-label={`${s.label}${hasError ? ', has errors' : ''}${isDirty ? ', unsaved changes' : ''}${isActive ? ', current section' : ''}`}
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
                  {isDirty ? (
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
        {/* 1 Page Header */}
        <CmsSectionCard
          id="page"
          index={1}
          title="Page Header"
          description="Top-level heading for the Contact page."
          dirty={dirty && sectionDirty('page')}
          collapsible
          open={isOpen('page')}
          onToggle={() => toggleSection('page')}
        >
          <CmsTextField
            label="Title"
            value={draft.title}
            onChange={(v) => setDraft({ ...draft, title: v })}
            maxLength={80}
            error={validation.errors['title']}
          />
        </CmsSectionCard>

        {/* 2 Hero */}
        <CmsSectionCard
          id="hero"
          index={2}
          title="Hero"
          description="Hero banner for the Contact page."
          dirty={dirty && sectionDirty('hero')}
          collapsible
          open={isOpen('hero')}
          onToggle={() => toggleSection('hero')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.hero.eyebrow}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['hero.eyebrow']}
          />
          <CmsImageField
            label="Hero image"
            value={draft.hero.image}
            onChange={(image) => setDraft({ ...draft, hero: { ...draft.hero, image } })}
            errorId={validation.errors['hero.image.id']}
            errorAlt={validation.errors['hero.image.alt']}
          />
          <CmsCtaFields
            label="Primary CTA"
            value={draft.hero.primaryCta}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, primaryCta: v } })}
            error={
              validation.errors['hero.primaryCta.to'] ?? validation.errors['hero.primaryCta.href']
            }
          />
        </CmsSectionCard>

        {/* 3 Contact Methods */}
        <CmsSectionCard
          id="methods"
          index={3}
          title="Contact Methods"
          description={`${draft.methods.length} contact method(s): order is display order (first is top).`}
          dirty={dirty && sectionDirty('methods')}
          collapsible
          open={isOpen('methods')}
          onToggle={() => toggleSection('methods')}
        >
          <Button
            variant="secondary"
            onClick={() => {
              const newMethod: ContactMethod = {
                label: 'New method',
                value: 'New value',
                icon: 'phone',
                external: false,
                featured: false,
              };
              setDraft({ ...draft, methods: [...draft.methods, newMethod] });
              setMethodSnapshot(null);
              setEditingMethod(draft.methods.length);
            }}
            disabled={draft.methods.length >= 8}
          >
            Add contact method
          </Button>
          <div className={styles.listRows}>
            {draft.methods.map((item, idx) => (
              <div key={`method-${idx}`} className={styles.listRow}>
                <div className={styles.listRowActions}>
                  <Button
                    variant="ghost"
                    onClick={() => moveMethod(idx, idx - 1)}
                    disabled={idx === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => moveMethod(idx, idx + 1)}
                    disabled={idx === draft.methods.length - 1}
                  >
                    ↓
                  </Button>
                </div>
                <div className={styles.listRowContent}>
                  <span className={styles.listRowTitle}>{item.label}</span>
                  <span className={styles.listRowMeta}>{item.value}</span>
                  {item.href ? <span className={styles.listRowMeta}>{item.href}</span> : null}
                  {item.featured ? <span className={styles.listRowMeta}>Featured</span> : null}
                </div>
                <div className={styles.listRowActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMethodSnapshot(structuredClone(item));
                      setEditingMethod(idx);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.methods.length <= 1) return;
                      setDeletingMethodIdx(idx);
                    }}
                    disabled={draft.methods.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CmsSectionCard>

        {/* 4 Message Form */}
        <CmsSectionCard
          id="form"
          index={4}
          title="Message Form"
          description="Copy for the presentational contact form. Field labels (Name / Email / Message) are fixed in the public site."
          dirty={dirty && sectionDirty('form')}
          collapsible
          open={isOpen('form')}
          onToggle={() => toggleSection('form')}
        >
          <CmsTextField
            label="Heading"
            value={draft.form.heading}
            onChange={(v) => setDraft({ ...draft, form: { ...draft.form, heading: v } })}
            maxLength={80}
            error={validation.errors['form.heading']}
          />
          <CmsTextareaField
            label="Note"
            value={draft.form.note}
            onChange={(v) => setDraft({ ...draft, form: { ...draft.form, note: v } })}
            maxLength={400}
            rows={2}
            error={validation.errors['form.note']}
          />
          <CmsTextField
            label="Submit label"
            value={draft.form.submitLabel}
            onChange={(v) => setDraft({ ...draft, form: { ...draft.form, submitLabel: v } })}
            maxLength={40}
            error={validation.errors['form.submitLabel']}
          />
        </CmsSectionCard>

        {/* 5 CTA Band */}
        <CmsSectionCard
          id="cta"
          index={5}
          title="CTA Band"
          dirty={dirty && sectionDirty('cta')}
          collapsible
          open={isOpen('cta')}
          onToggle={() => toggleSection('cta')}
        >
          <CmsTextField
            label="Title"
            value={draft.cta.title}
            onChange={(v) => setDraft({ ...draft, cta: { ...draft.cta, title: v } })}
            maxLength={80}
            error={validation.errors['cta.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.cta.lead}
            onChange={(v) => setDraft({ ...draft, cta: { ...draft.cta, lead: v } })}
            maxLength={400}
            rows={2}
            error={validation.errors['cta.lead']}
          />
          <div className={styles.ctaPair}>
            <CmsCtaFields
              label="Primary CTA"
              value={draft.cta.primaryCta}
              onChange={(v) => setDraft({ ...draft, cta: { ...draft.cta, primaryCta: v } })}
              error={
                validation.errors['cta.primaryCta.to'] ?? validation.errors['cta.primaryCta.href']
              }
            />
            <CmsCtaFields
              label="Secondary CTA"
              value={draft.cta.secondaryCta}
              onChange={(v) => setDraft({ ...draft, cta: { ...draft.cta, secondaryCta: v } })}
              error={
                validation.errors['cta.secondaryCta.to'] ??
                validation.errors['cta.secondaryCta.href']
              }
            />
          </div>
        </CmsSectionCard>

        {/* 6 Footer Details - read-only preview (canonical in Global CMS) */}
        <CmsSectionCard
          id="details"
          index={6}
          title="Footer Details"
          description="The site Footer is edited in Global Content. This is a live preview of the current footer rows."
          dirty={false}
          collapsible
          open={isOpen('details')}
          onToggle={() => toggleSection('details')}
        >
          <p className={styles.previewNote}>
            Managed in{' '}
            <Link to="/admin/cms/global#footer" className={styles.previewLink}>
              Global Content → Footer
            </Link>
            .
          </p>
          {globalData ? (
            <dl className={styles.readonlyList}>
              <div>
                <dt>Contact heading</dt>
                <dd>{globalData.footer.contactHeading}</dd>
              </div>
              <div>
                <dt>Brand line</dt>
                <dd>{globalData.footer.brandLine}</dd>
              </div>
              {globalData.footer.contacts.map((c, i) => (
                <div key={`footer-${i}`}>
                  <dt>{c.label}</dt>
                  <dd>{c.value}</dd>
                </div>
              ))}
              <div>
                <dt>Legal suffix</dt>
                <dd>{globalData.footer.bottomBar.legalSuffix}</dd>
              </div>
              <div>
                <dt>Show tagline</dt>
                <dd>{globalData.footer.bottomBar.showTagline ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          ) : (
            <Skeleton style={{ height: 140 }} />
          )}
        </CmsSectionCard>

        <CmsFormActions
          dirty={dirty}
          valid={valid}
          saving={update.isPending}
          onSave={onSave}
          onCancel={onCancel}
          saveLabel="Save"
          lastSaved={lastSaved}
        />
      </div>

      <ConfirmDialog
        open={showCancelConfirm}
        onCancel={() => setShowCancelConfirm(false)}
        onConfirm={confirmCancel}
        title="Discard changes?"
        message="You have unsaved changes. Discard and restore the last saved content?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />

      {/* Delete method confirm */}
      <ConfirmDialog
        open={deletingMethodIdx !== null}
        onCancel={() => setDeletingMethodIdx(null)}
        danger
        onConfirm={() => {
          if (deletingMethodIdx === null) return;
          setDraft({
            ...draft,
            methods: draft.methods.filter((_, i) => i !== deletingMethodIdx),
          });
          setDeletingMethodIdx(null);
        }}
        title="Delete contact method?"
        message="This contact method will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Edit method dialog */}
      {editingMethod !== null && draft.methods[editingMethod] && (
        <Dialog
          open
          onClose={() => {
            if (methodSnapshot && editingMethod !== null) {
              const next = [...draft.methods];
              next[editingMethod] = methodSnapshot;
              setDraft({ ...draft, methods: next });
            }
            setEditingMethod(null);
            setMethodSnapshot(null);
          }}
          title={methodSnapshot ? 'Edit Contact Method' : 'Add Contact Method'}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (methodSnapshot && editingMethod !== null) {
                    const next = [...draft.methods];
                    next[editingMethod] = methodSnapshot;
                    setDraft({ ...draft, methods: next });
                  }
                  setEditingMethod(null);
                  setMethodSnapshot(null);
                }}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingMethod(null);
                  setMethodSnapshot(null);
                }}
              >
                Save & close
              </Button>
            </>
          }
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              minWidth: 0,
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            <CmsSelectField
              label="Icon"
              value={draft.methods[editingMethod]!.icon}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  methods: draft.methods.map((m, i) =>
                    i === editingMethod ? { ...m, icon: v as ContactMethod['icon'] } : m,
                  ),
                })
              }
              options={METHOD_ICON_OPTIONS}
            />
            <CmsTextField
              label="Label"
              value={draft.methods[editingMethod]!.label}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  methods: draft.methods.map((m, i) =>
                    i === editingMethod ? { ...m, label: v } : m,
                  ),
                })
              }
              maxLength={40}
              error={validation.errors[`methods.${editingMethod}.label`]}
            />
            <CmsTextField
              label="Value"
              value={draft.methods[editingMethod]!.value}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  methods: draft.methods.map((m, i) =>
                    i === editingMethod ? { ...m, value: v } : m,
                  ),
                })
              }
              maxLength={120}
              error={validation.errors[`methods.${editingMethod}.value`]}
            />
            <CmsTextField
              label="Link (tel:, mailto:, https:// or /)"
              hint="Leave blank for the office address (no link)."
              value={draft.methods[editingMethod]!.href ?? ''}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  methods: draft.methods.map((m, i) =>
                    i === editingMethod ? { ...m, href: v === '' ? undefined : v } : m,
                  ),
                })
              }
              maxLength={200}
              error={validation.errors[`methods.${editingMethod}.href`]}
            />
            <div className={styles.ctaPair}>
              <CmsToggleField
                label="Open in new tab (external)"
                value={draft.methods[editingMethod]!.external ?? false}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    methods: draft.methods.map((m, i) =>
                      i === editingMethod ? { ...m, external: v } : m,
                    ),
                  })
                }
              />
              <CmsToggleField
                label="Featured"
                hint="Strongest contact action"
                value={draft.methods[editingMethod]!.featured ?? false}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    methods: draft.methods.map((m, i) =>
                      i === editingMethod ? { ...m, featured: v } : m,
                    ),
                  })
                }
              />
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
