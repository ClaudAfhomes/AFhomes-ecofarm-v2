import { useEffect, useMemo, useState } from 'react';

import { Button, ConfirmDialog, ErrorState, notifySuccess, PageHeader, Skeleton } from '@jad/ui';
import { homepageContentSchema, type HomepageContent } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsCtaFields } from '../components/CmsCtaFields';
import { CmsTextField, CmsTextareaField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useHomepageCms, useUpdateHomepageCms } from '../hooks/useHomepageCms';
import { usePropertiesCms } from '../hooks/usePropertiesCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: HomepageContent, b: HomepageContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'hero', label: 'Hero' },
  { id: 'value', label: 'Value' },
  { id: 'categories', label: 'Categories' },
  { id: 'featured', label: 'Featured' },
  { id: 'approach', label: 'Approach' },
  { id: 'trust', label: 'Trust' },
  { id: 'about', label: 'About Preview' },
  { id: 'ctaband', label: 'CTA Band' },
] as const;

export function CmsHomepagePage() {
  const { data, isPending, isError, error, refetch } = useHomepageCms();
  const update = useUpdateHomepageCms();
  const { data: propertiesData } = usePropertiesCms();
  const [draft, setDraft] = useState<HomepageContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const { openId, toggle, open, expandAll, collapseAll, isOpen } = useCmsAccordion(SECTION_DEFS);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (SECTION_DEFS.some((s) => s.id === hash)) return hash;
    }
    return 'hero';
  });

  useEffect(() => {
    if (data && !draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate editable draft from fetched CMS data
      setDraft(structuredClone(data));
    }
  }, [data, draft]);

  // Deep-link: expand and scroll to hash on initial load
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

  // Scrollspy: highlight nav link for section in viewport
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
    const parsed = homepageContentSchema.safeParse(draft);
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
        <PageHeader title="Homepage CMS" description="Manage the public homepage content." />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader title="Homepage CMS" description="Manage the public homepage content." />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader title="Homepage CMS" description="Manage the public homepage content." />
        <ErrorState title="No content" message="Homepage content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'hero':
        return JSON.stringify(draft.hero) !== JSON.stringify(data.hero);
      case 'value':
        return JSON.stringify(draft.value) !== JSON.stringify(data.value);
      case 'categories':
        return JSON.stringify(draft.categories) !== JSON.stringify(data.categories);
      case 'featured':
        return JSON.stringify(draft.featured) !== JSON.stringify(data.featured);
      case 'approach':
        return JSON.stringify(draft.approach) !== JSON.stringify(data.approach);
      case 'trust':
        return JSON.stringify(draft.trust) !== JSON.stringify(data.trust);
      case 'about':
        return JSON.stringify(draft.aboutPreview) !== JSON.stringify(data.aboutPreview);
      case 'ctaband':
        return JSON.stringify(draft.ctaBand) !== JSON.stringify(data.ctaBand);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const prefixMap: Record<string, string> = {
      hero: 'hero.',
      value: 'value.',
      categories: 'categories.',
      featured: 'featured.',
      approach: 'approach.',
      trust: 'trust.',
      about: 'aboutPreview.',
      ctaband: 'ctaBand.',
    };
    const prefix = prefixMap[key];
    if (!prefix) return false;
    return Object.keys(validation.errors).some(
      (k) => k.startsWith(prefix) || k === prefix.slice(0, -1),
    );
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

  return (
    <section>
      <PageHeader title="Homepage CMS" description="Manage the public homepage content." />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="Homepage sections">
        <h3 className={styles.anchorTitle}>Sections ({SECTION_DEFS.length})</h3>
        <ul className={styles.anchorList}>
          {SECTION_DEFS.map((s, idx) => {
            const dirty = sectionDirty(s.id);
            const hasError = sectionHasError(s.id);
            const isActive = activeId === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`${styles.anchorLink} ${isActive ? styles.anchorLinkActive : ''} ${hasError ? styles.anchorLinkError : ''}`}
                  aria-label={`${s.label}${hasError ? ', has errors' : ''}${dirty ? ', unsaved changes' : ''}${isActive ? ', current section' : ''}`}
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
                  {dirty ? (
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
        {/* 1 Hero */}
        <CmsSectionCard
          id="hero"
          index={1}
          title="Hero"
          description="Top of the homepage: headline, supporting copy, and hero image."
          dirty={dirty && JSON.stringify(draft.hero) !== JSON.stringify(data.hero)}
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
          <CmsTextField
            label="Title (H1)"
            value={draft.hero.title}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, title: v } })}
            maxLength={80}
            error={validation.errors['hero.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.hero.lead}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, lead: v } })}
            maxLength={300}
            rows={3}
            error={validation.errors['hero.lead']}
          />
          <div className={styles.ctaPair}>
            <CmsCtaFields
              label="Primary CTA"
              value={draft.hero.primaryCta}
              onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, primaryCta: v } })}
              error={
                validation.errors['hero.primaryCta.to'] ??
                validation.errors['hero.primaryCta.href'] ??
                validation.errors['hero.primaryCta.label']
              }
            />
            {draft.hero.secondaryCta ? (
              <div className={styles.ctaSecondaryWrap}>
                <CmsCtaFields
                  label="Secondary CTA"
                  value={draft.hero.secondaryCta}
                  onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, secondaryCta: v } })}
                  error={
                    validation.errors['hero.secondaryCta.to'] ??
                    validation.errors['hero.secondaryCta.href'] ??
                    validation.errors['hero.secondaryCta.label']
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft({ ...draft, hero: { ...draft.hero, secondaryCta: undefined } })
                  }
                >
                  Remove secondary CTA
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    hero: { ...draft.hero, secondaryCta: { label: 'Discover JA&D', to: '/about' } },
                  })
                }
              >
                Add secondary CTA
              </Button>
            )}
          </div>
          <CmsImageField
            label="Hero image"
            value={draft.hero.image}
            onChange={(image) => setDraft({ ...draft, hero: { ...draft.hero, image } })}
            errorId={validation.errors['hero.image.id']}
            errorAlt={validation.errors['hero.image.alt']}
          />
        </CmsSectionCard>

        {/* 2 Value */}
        <CmsSectionCard
          id="value"
          index={2}
          title="Value"
          dirty={dirty && JSON.stringify(draft.value) !== JSON.stringify(data.value)}
          collapsible
          open={isOpen('value')}
          onToggle={() => toggleSection('value')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.value.eyebrow ?? ''}
            onChange={(v) => setDraft({ ...draft, value: { ...draft.value, eyebrow: v } })}
            maxLength={60}
          />
          <CmsTextField
            label="Title"
            value={draft.value.title}
            onChange={(v) => setDraft({ ...draft, value: { ...draft.value, title: v } })}
            maxLength={80}
            error={validation.errors['value.title']}
          />
          {draft.value.paragraphs.map((p, idx) => (
            <CmsTextareaField
              key={`value-p-${idx}`}
              label={`Paragraph ${idx + 1}`}
              value={p}
              onChange={(v) => {
                const next = [...draft.value.paragraphs];
                next[idx] = v;
                setDraft({ ...draft, value: { ...draft.value, paragraphs: next } });
              }}
              maxLength={600}
              rows={3}
              error={validation.errors[`value.paragraphs.${idx}`]}
            />
          ))}
          <CmsImageField
            label="Value image"
            value={draft.value.image}
            onChange={(image) => setDraft({ ...draft, value: { ...draft.value, image } })}
            errorId={validation.errors['value.image.id']}
            errorAlt={validation.errors['value.image.alt']}
          />
        </CmsSectionCard>

        {/* 3 Categories Header */}
        <CmsSectionCard
          id="categories"
          index={3}
          title="Categories"
          description="Category cards themselves are rendered from Properties CMS."
          dirty={dirty && JSON.stringify(draft.categories) !== JSON.stringify(data.categories)}
          collapsible
          open={isOpen('categories')}
          onToggle={() => toggleSection('categories')}
        >
          <div className={styles.ssotChip}>
            <span>{propertiesData?.categories.length ?? 0} categories</span>
            <span className={styles.ssotDivider}>•</span>
            <span>{propertiesData?.properties.length ?? 0} listings</span>
            <a href="/admin/cms/properties" className={styles.ssotLink}>
              Properties CMS →
            </a>
          </div>
          <CmsTextField
            label="Eyebrow"
            value={draft.categories.eyebrow}
            onChange={(v) =>
              setDraft({ ...draft, categories: { ...draft.categories, eyebrow: v } })
            }
            maxLength={60}
            error={validation.errors['categories.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.categories.title}
            onChange={(v) => setDraft({ ...draft, categories: { ...draft.categories, title: v } })}
            maxLength={80}
            error={validation.errors['categories.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.categories.lead ?? ''}
            onChange={(v) => setDraft({ ...draft, categories: { ...draft.categories, lead: v } })}
            maxLength={300}
            rows={2}
          />
        </CmsSectionCard>

        {/* 4 Featured Header */}
        <CmsSectionCard
          id="featured"
          index={4}
          title="Featured"
          description="Property selection is system-controlled (1 per category). Only the header is editable here."
          dirty={dirty && JSON.stringify(draft.featured) !== JSON.stringify(data.featured)}
          collapsible
          open={isOpen('featured')}
          onToggle={() => toggleSection('featured')}
        >
          <div className={styles.ssotChip}>
            <span>derived featured: {propertiesData?.categories.length ?? 0} (1 per category)</span>
            <a href="/admin/cms/properties" className={styles.ssotLink}>
              Properties CMS →
            </a>
          </div>
          <CmsTextField
            label="Eyebrow"
            value={draft.featured.eyebrow}
            onChange={(v) => setDraft({ ...draft, featured: { ...draft.featured, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['featured.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.featured.title}
            onChange={(v) => setDraft({ ...draft, featured: { ...draft.featured, title: v } })}
            maxLength={80}
            error={validation.errors['featured.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.featured.lead}
            onChange={(v) => setDraft({ ...draft, featured: { ...draft.featured, lead: v } })}
            maxLength={300}
            rows={2}
            error={validation.errors['featured.lead']}
          />
          <CmsCtaFields
            label="CTA"
            value={draft.featured.cta}
            onChange={(v) => setDraft({ ...draft, featured: { ...draft.featured, cta: v } })}
            error={validation.errors['featured.cta.to'] ?? validation.errors['featured.cta.href']}
          />
        </CmsSectionCard>

        {/* 5 Approach */}
        <CmsSectionCard
          id="approach"
          index={5}
          title="Approach"
          dirty={dirty && JSON.stringify(draft.approach) !== JSON.stringify(data.approach)}
          collapsible
          open={isOpen('approach')}
          onToggle={() => toggleSection('approach')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.approach.eyebrow}
            onChange={(v) => setDraft({ ...draft, approach: { ...draft.approach, eyebrow: v } })}
            maxLength={60}
          />
          <CmsTextField
            label="Title"
            value={draft.approach.title}
            onChange={(v) => setDraft({ ...draft, approach: { ...draft.approach, title: v } })}
            maxLength={80}
            error={validation.errors['approach.title']}
          />
          <div className={styles.stepsGrid}>
            {draft.approach.steps.map((s, idx) => (
              <div key={`approach-${idx}`} className={styles.pillarCard}>
                <CmsTextField
                  label={`Step ${idx + 1}: Title`}
                  value={s.title}
                  onChange={(v) => {
                    const next = [...draft.approach.steps];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      approach: {
                        ...draft.approach,
                        steps: next as HomepageContent['approach']['steps'],
                      },
                    });
                  }}
                  maxLength={60}
                  error={validation.errors[`approach.steps.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={s.body}
                  onChange={(v) => {
                    const next = [...draft.approach.steps];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      approach: {
                        ...draft.approach,
                        steps: next as HomepageContent['approach']['steps'],
                      },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`approach.steps.${idx}.body`]}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.approach.steps];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          steps: next as HomepageContent['approach']['steps'],
                        },
                      });
                    }}
                    disabled={idx === 0}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === draft.approach.steps.length - 1) return;
                      const next = [...draft.approach.steps];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          steps: next as HomepageContent['approach']['steps'],
                        },
                      });
                    }}
                    disabled={idx === draft.approach.steps.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.approach.steps.length <= 1) return;
                      const next = draft.approach.steps.filter((_, i) => i !== idx);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          steps: next as HomepageContent['approach']['steps'],
                        },
                      });
                    }}
                    disabled={draft.approach.steps.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (draft.approach.steps.length >= 8) return;
              const next = [...draft.approach.steps, { title: 'New step', body: 'Step details.' }];
              setDraft({
                ...draft,
                approach: {
                  ...draft.approach,
                  steps: next as HomepageContent['approach']['steps'],
                },
              });
            }}
            disabled={draft.approach.steps.length >= 8}
          >
            Add step
          </Button>
        </CmsSectionCard>

        {/* 6 Trust */}
        <CmsSectionCard
          id="trust"
          index={6}
          title="Trust"
          description="Icons are system-controlled."
          dirty={dirty && JSON.stringify(draft.trust) !== JSON.stringify(data.trust)}
          collapsible
          open={isOpen('trust')}
          onToggle={() => toggleSection('trust')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.trust.eyebrow}
            onChange={(v) => setDraft({ ...draft, trust: { ...draft.trust, eyebrow: v } })}
            maxLength={60}
          />
          <CmsTextField
            label="Title"
            value={draft.trust.title}
            onChange={(v) => setDraft({ ...draft, trust: { ...draft.trust, title: v } })}
            maxLength={80}
            error={validation.errors['trust.title']}
          />
          <div className={styles.pillarGrid}>
            {draft.trust.items.map((it, idx) => (
              <div key={`trust-${idx}`} className={styles.pillarCard}>
                <CmsTextField
                  label={`Pillar ${idx + 1}: Title`}
                  value={it.title}
                  onChange={(v) => {
                    const next = [...draft.trust.items];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
                    });
                  }}
                  maxLength={40}
                  error={validation.errors[`trust.items.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={it.body}
                  onChange={(v) => {
                    const next = [...draft.trust.items];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`trust.items.${idx}.body`]}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.trust.items];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({
                        ...draft,
                        trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
                      });
                    }}
                    disabled={idx === 0}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === draft.trust.items.length - 1) return;
                      const next = [...draft.trust.items];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({
                        ...draft,
                        trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
                      });
                    }}
                    disabled={idx === draft.trust.items.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.trust.items.length <= 1) return;
                      const next = draft.trust.items.filter((_, i) => i !== idx);
                      setDraft({
                        ...draft,
                        trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
                      });
                    }}
                    disabled={draft.trust.items.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (draft.trust.items.length >= 8) return;
              const next = [...draft.trust.items, { title: 'New pillar', body: 'Pillar details.' }];
              setDraft({
                ...draft,
                trust: { ...draft.trust, items: next as HomepageContent['trust']['items'] },
              });
            }}
            disabled={draft.trust.items.length >= 8}
          >
            Add pillar
          </Button>
        </CmsSectionCard>

        {/* 7 About Preview */}
        <CmsSectionCard
          id="about"
          index={7}
          title="About Preview"
          dirty={dirty && JSON.stringify(draft.aboutPreview) !== JSON.stringify(data.aboutPreview)}
          collapsible
          open={isOpen('about')}
          onToggle={() => toggleSection('about')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.aboutPreview.eyebrow}
            onChange={(v) =>
              setDraft({ ...draft, aboutPreview: { ...draft.aboutPreview, eyebrow: v } })
            }
            maxLength={60}
          />
          <CmsTextField
            label="Title"
            value={draft.aboutPreview.title}
            onChange={(v) =>
              setDraft({ ...draft, aboutPreview: { ...draft.aboutPreview, title: v } })
            }
            maxLength={80}
            error={validation.errors['aboutPreview.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.aboutPreview.lead}
            onChange={(v) =>
              setDraft({ ...draft, aboutPreview: { ...draft.aboutPreview, lead: v } })
            }
            maxLength={300}
            rows={2}
            error={validation.errors['aboutPreview.lead']}
          />
          <CmsImageField
            label="Image"
            value={draft.aboutPreview.image}
            onChange={(image) =>
              setDraft({ ...draft, aboutPreview: { ...draft.aboutPreview, image } })
            }
            errorId={validation.errors['aboutPreview.image.id']}
            errorAlt={validation.errors['aboutPreview.image.alt']}
          />
          <CmsCtaFields
            label="CTA"
            value={draft.aboutPreview.cta}
            onChange={(v) =>
              setDraft({ ...draft, aboutPreview: { ...draft.aboutPreview, cta: v } })
            }
          />
        </CmsSectionCard>

        {/* 8 CTA Band */}
        <CmsSectionCard
          id="ctaband"
          index={8}
          title="CTA Band"
          dirty={dirty && JSON.stringify(draft.ctaBand) !== JSON.stringify(data.ctaBand)}
          collapsible
          open={isOpen('ctaband')}
          onToggle={() => toggleSection('ctaband')}
        >
          <CmsTextField
            label="Title"
            value={draft.ctaBand.title}
            onChange={(v) => setDraft({ ...draft, ctaBand: { ...draft.ctaBand, title: v } })}
            maxLength={80}
            error={validation.errors['ctaBand.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.ctaBand.lead ?? ''}
            onChange={(v) => setDraft({ ...draft, ctaBand: { ...draft.ctaBand, lead: v } })}
            maxLength={300}
            rows={2}
          />
          <div className={styles.ctaPair}>
            <CmsCtaFields
              label="Primary CTA"
              value={draft.ctaBand.primaryCta}
              onChange={(v) => setDraft({ ...draft, ctaBand: { ...draft.ctaBand, primaryCta: v } })}
              error={
                validation.errors['ctaBand.primaryCta.to'] ??
                validation.errors['ctaBand.primaryCta.href']
              }
            />
            {draft.ctaBand.secondaryCta ? (
              <div className={styles.ctaSecondaryWrap}>
                <CmsCtaFields
                  label="Secondary CTA"
                  value={draft.ctaBand.secondaryCta}
                  onChange={(v) =>
                    setDraft({ ...draft, ctaBand: { ...draft.ctaBand, secondaryCta: v } })
                  }
                  error={
                    validation.errors['ctaBand.secondaryCta.to'] ??
                    validation.errors['ctaBand.secondaryCta.href'] ??
                    validation.errors['ctaBand.secondaryCta.label']
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft({ ...draft, ctaBand: { ...draft.ctaBand, secondaryCta: undefined } })
                  }
                >
                  Remove secondary CTA
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    ctaBand: {
                      ...draft.ctaBand,
                      secondaryCta: { label: 'Read the FAQs', to: '/faqs' },
                    },
                  })
                }
              >
                Add secondary CTA
              </Button>
            )}
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
    </section>
  );
}
