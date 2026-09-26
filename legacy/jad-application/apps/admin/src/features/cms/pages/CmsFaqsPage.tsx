import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  notifySuccess,
  PageHeader,
  Skeleton,
} from '@jad/ui';
import { faqContentSchema, type FaqItem, type FaqContent } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsCtaFields } from '../components/CmsCtaFields';
import { CmsTextField, CmsTextareaField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useFaqsCms, useUpdateFaqsCms } from '../hooks/useFaqsCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: FaqContent, b: FaqContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'page', label: 'Page Header' },
  { id: 'hero', label: 'Hero' },
  { id: 'intro', label: 'Intro' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'cta', label: 'CTA Band' },
] as const;

export function CmsFaqsPage() {
  const { data, isPending, isError, error, refetch } = useFaqsCms();
  const update = useUpdateFaqsCms();
  const [draft, setDraft] = useState<FaqContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<number | null>(null);
  const [faqSnapshot, setFaqSnapshot] = useState<FaqItem | null>(null);
  const [deletingFaqIdx, setDeletingFaqIdx] = useState<number | null>(null);
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
      {
        root: null,
        rootMargin: '-80px 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
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
    const parsed = faqContentSchema.safeParse(draft);
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
        <PageHeader title="FAQs CMS" description="Manage the public FAQs page content." />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader title="FAQs CMS" description="Manage the public FAQs page content." />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader title="FAQs CMS" description="Manage the public FAQs page content." />
        <ErrorState title="No content" message="FAQs content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'page':
        return (
          JSON.stringify(draft.eyebrow) !== JSON.stringify(data.eyebrow) ||
          JSON.stringify(draft.title) !== JSON.stringify(data.title)
        );
      case 'hero':
        return JSON.stringify(draft.hero) !== JSON.stringify(data.hero);
      case 'intro':
        return JSON.stringify(draft.intro) !== JSON.stringify(data.intro);
      case 'faqs':
        return JSON.stringify(draft.items) !== JSON.stringify(data.items);
      case 'cta':
        return JSON.stringify(draft.cta) !== JSON.stringify(data.cta);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const prefixMap: Record<string, string> = {
      page: 'eyebrow',
      hero: 'hero.',
      intro: 'intro.',
      faqs: 'items',
      cta: 'cta.',
    };
    // page eyebrow/title are top-level
    if (key === 'page') {
      return Object.keys(validation.errors).some((k) => k === 'eyebrow' || k === 'title');
    }
    const prefix = prefixMap[key];
    if (!prefix) return false;
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

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length) return;
    const next = [...draft.items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDraft({ ...draft, items: next });
  };

  return (
    <section>
      <PageHeader title="FAQs CMS" description="Manage the public FAQs page content." />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="FAQs sections">
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
          description="Top-level headings for the FAQ page."
          dirty={dirty && sectionDirty('page')}
          collapsible
          open={isOpen('page')}
          onToggle={() => toggleSection('page')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.eyebrow}
            onChange={(v) => setDraft({ ...draft, eyebrow: v })}
            maxLength={60}
            error={validation.errors['eyebrow']}
          />
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
          description="Hero banner for the FAQ page."
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
          <CmsTextareaField
            label="Lead"
            value={draft.hero.lead}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, lead: v } })}
            maxLength={400}
            rows={3}
            error={validation.errors['hero.lead']}
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

        {/* 3 Intro */}
        <CmsSectionCard
          id="intro"
          index={3}
          title="Intro"
          description="Introductory statement above the FAQ list."
          dirty={dirty && sectionDirty('intro')}
          collapsible
          open={isOpen('intro')}
          onToggle={() => toggleSection('intro')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.intro.eyebrow}
            onChange={(v) => setDraft({ ...draft, intro: { ...draft.intro, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['intro.eyebrow']}
          />
          <CmsTextField
            label="Statement"
            value={draft.intro.statement}
            onChange={(v) => setDraft({ ...draft, intro: { ...draft.intro, statement: v } })}
            maxLength={80}
            error={validation.errors['intro.statement']}
          />
          <CmsTextareaField
            label="Body"
            value={draft.intro.body}
            onChange={(v) => setDraft({ ...draft, intro: { ...draft.intro, body: v } })}
            maxLength={600}
            rows={3}
            error={validation.errors['intro.body']}
          />
        </CmsSectionCard>

        {/* 4 FAQs */}
        <CmsSectionCard
          id="faqs"
          index={4}
          title="FAQs"
          description={`${draft.items.length} FAQ items: order is array order (first is top).`}
          dirty={dirty && sectionDirty('faqs')}
          collapsible
          open={isOpen('faqs')}
          onToggle={() => toggleSection('faqs')}
        >
          <Button
            variant="secondary"
            onClick={() => {
              const newItem: FaqItem = { question: 'New question?', answer: 'New answer.' };
              setDraft({ ...draft, items: [...draft.items, newItem] });
              setFaqSnapshot(null);
              setEditingFaq(draft.items.length);
            }}
            disabled={draft.items.length >= 20}
          >
            Add FAQ item
          </Button>
          <div className={styles.listRows}>
            {draft.items.map((item, idx) => (
              <div key={`faq-${idx}`} className={styles.listRow}>
                <div className={styles.listRowActions}>
                  <Button
                    variant="ghost"
                    onClick={() => moveItem(idx, idx - 1)}
                    disabled={idx === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => moveItem(idx, idx + 1)}
                    disabled={idx === draft.items.length - 1}
                  >
                    ↓
                  </Button>
                </div>
                <div className={styles.listRowContent}>
                  <span className={styles.listRowTitle}>{item.question}</span>
                  <span className={styles.listRowMeta}>
                    {item.answer.length > 80 ? item.answer.slice(0, 80) + '...' : item.answer}
                  </span>
                </div>
                <div className={styles.listRowActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFaqSnapshot(structuredClone(item));
                      setEditingFaq(idx);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.items.length <= 1) return;
                      setDeletingFaqIdx(idx);
                    }}
                    disabled={draft.items.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CmsSectionCard>

        {/* 5 CTA */}
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

      {/* Delete FAQ confirm */}
      <ConfirmDialog
        open={deletingFaqIdx !== null}
        onCancel={() => setDeletingFaqIdx(null)}
        danger
        onConfirm={() => {
          if (deletingFaqIdx === null) return;
          setDraft({
            ...draft,
            items: draft.items.filter((_, i) => i !== deletingFaqIdx),
          });
          setDeletingFaqIdx(null);
        }}
        title="Delete FAQ item?"
        message="This FAQ will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Edit FAQ dialog */}
      {editingFaq !== null && draft.items[editingFaq] && (
        <Dialog
          open
          onClose={() => {
            if (faqSnapshot && editingFaq !== null) {
              const next = [...draft.items];
              next[editingFaq] = faqSnapshot;
              setDraft({ ...draft, items: next });
            }
            setEditingFaq(null);
            setFaqSnapshot(null);
          }}
          title={faqSnapshot ? 'Edit FAQ' : 'Add FAQ'}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (faqSnapshot && editingFaq !== null) {
                    const next = [...draft.items];
                    next[editingFaq] = faqSnapshot;
                    setDraft({ ...draft, items: next });
                  }
                  setEditingFaq(null);
                  setFaqSnapshot(null);
                }}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingFaq(null);
                  setFaqSnapshot(null);
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
            <CmsTextareaField
              label="Question"
              value={draft.items[editingFaq]!.question}
              onChange={(v) => {
                const next = [...draft.items];
                next[editingFaq] = { ...next[editingFaq]!, question: v };
                setDraft({ ...draft, items: next });
              }}
              maxLength={120}
              rows={2}
              error={validation.errors[`items.${editingFaq}.question`]}
            />
            <CmsTextareaField
              label="Answer"
              value={draft.items[editingFaq]!.answer}
              onChange={(v) => {
                const next = [...draft.items];
                next[editingFaq] = { ...next[editingFaq]!, answer: v };
                setDraft({ ...draft, items: next });
              }}
              maxLength={600}
              rows={4}
              error={validation.errors[`items.${editingFaq}.answer`]}
            />
          </div>
        </Dialog>
      )}
    </section>
  );
}
