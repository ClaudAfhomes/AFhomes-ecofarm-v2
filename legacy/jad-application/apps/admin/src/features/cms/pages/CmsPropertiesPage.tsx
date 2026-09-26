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
import { formatMoney } from '@jad/shared';
import {
  propertiesContentSchema,
  type CmsPropertyCategory,
  type CmsProperty,
  type PropertiesContent,
} from '@jad/contracts';

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
import { usePropertiesCms, useUpdatePropertiesCms } from '../hooks/usePropertiesCms';
// Catalog system-of-record for link-by-reference: CMS owns presentation,
// the catalog owns identity/price/status/counts. Reads only - CMS never
// writes catalog rows. Explicit links win; otherwise entries auto-match on
// id/slug equality (see services/catalogLinks).
import { useCategories as useCatalogCategories } from '../../catalog/hooks/useCategories';
import { useProperties as useCatalogListings } from '../../catalog/hooks/useProperties';
import { resolveCategoryLink, resolveListingLink } from '../services/catalogLinks';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: PropertiesContent, b: PropertiesContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'page', label: 'Page Header' },
  { id: 'hero', label: 'Hero' },
  { id: 'intro', label: 'Intro' },
  { id: 'featured', label: 'Featured' },
  { id: 'note', label: 'Note' },
  { id: 'cta', label: 'CTA Band' },
  { id: 'categories', label: 'Categories' },
  { id: 'properties', label: 'Properties' },
] as const;

export function CmsPropertiesPage() {
  const { data, isPending, isError, error, refetch } = usePropertiesCms();
  const update = useUpdatePropertiesCms();
  const { data: catalogListings } = useCatalogListings();
  const { data: catalogCategories } = useCatalogCategories();
  const [draft, setDraft] = useState<PropertiesContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<number | null>(null);
  const [categorySnapshot, setCategorySnapshot] = useState<CmsPropertyCategory | null>(null);
  const [deletingCategoryIdx, setDeletingCategoryIdx] = useState<number | null>(null);
  const [editingProperty, setEditingProperty] = useState<number | null>(null);
  const [propertySnapshot, setPropertySnapshot] = useState<CmsProperty | null>(null);
  const [deletingPropertyIdx, setDeletingPropertyIdx] = useState<number | null>(null);
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
    const parsed = propertiesContentSchema.safeParse(draft);
    if (parsed.success) return { success: true as const, errors: {} as Record<string, string> };
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) errors[path] = issue.message;
    }
    return { success: false as const, errors };
  }, [draft]);

  // Link-by-reference resolution against the catalog system-of-record:
  // explicit links win, otherwise entries auto-match on id/slug equality.
  // Dangling links (catalog item deleted) render as warnings - they never
  // block saving.
  const categoryLinkText = (cat: Pick<CmsPropertyCategory, 'slug' | 'catalogSlug'>): string => {
    const resolved = resolveCategoryLink(cat, catalogCategories);
    if (resolved.kind === 'explicit') return ` · Linked: ${resolved.target.title}`;
    if (resolved.kind === 'auto') return ` · Auto-linked: ${resolved.target.title}`;
    if (resolved.kind === 'dangling') return ` · Link missing: ${resolved.missing}`;
    return '';
  };
  const listingLinkText = (prop: Pick<CmsProperty, 'id' | 'catalogId'>): string => {
    const resolved = resolveListingLink(prop, catalogListings);
    if (resolved.kind === 'explicit') return ` · Linked: ${resolved.target.name}`;
    if (resolved.kind === 'auto') return ` · Auto-linked: ${resolved.target.name}`;
    if (resolved.kind === 'dangling') return ` · Link missing: ${resolved.missing}`;
    return '';
  };

  if (isPending) {
    return (
      <section>
        <PageHeader
          title="Properties CMS"
          description="Manage the public Properties page content."
        />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader
          title="Properties CMS"
          description="Manage the public Properties page content."
        />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader
          title="Properties CMS"
          description="Manage the public Properties page content."
        />
        <ErrorState title="No content" message="Properties content is unavailable." />
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
          JSON.stringify(draft.page.eyebrow) !== JSON.stringify(data.page.eyebrow) ||
          JSON.stringify(draft.page.title) !== JSON.stringify(data.page.title) ||
          JSON.stringify(draft.page.lead) !== JSON.stringify(data.page.lead)
        );
      case 'hero':
        return JSON.stringify(draft.page.hero) !== JSON.stringify(data.page.hero);
      case 'intro':
        return JSON.stringify(draft.page.intro) !== JSON.stringify(data.page.intro);
      case 'featured':
        return JSON.stringify(draft.page.featured) !== JSON.stringify(data.page.featured);
      case 'note':
        return JSON.stringify(draft.page.note) !== JSON.stringify(data.page.note);
      case 'cta':
        return JSON.stringify(draft.page.cta) !== JSON.stringify(data.page.cta);
      case 'categories':
        return JSON.stringify(draft.categories) !== JSON.stringify(data.categories);
      case 'properties':
        return JSON.stringify(draft.properties) !== JSON.stringify(data.properties);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const prefixMap: Record<string, string> = {
      page: 'page.',
      hero: 'page.hero.',
      intro: 'page.intro.',
      featured: 'page.featured.',
      note: 'page.note.',
      cta: 'page.cta.',
      categories: 'categories',
      properties: 'properties',
    };
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

  return (
    <section>
      <PageHeader title="Properties CMS" description="Manage the public Properties page content." />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="Properties sections">
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

      <div className={styles.entryCards}>
        <a
          href="#categories"
          className={styles.entryCard}
          onClick={(e) => {
            e.preventDefault();
            toggleSection('categories');
            document
              .getElementById('categories')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <span className={styles.entryCardTitle}>Property Categories</span>
          <span className={styles.entryCardMeta}>
            {draft.categories.length} categories
            {draft.categories.filter((c) => c.isFeatured).length > 0
              ? ` · ${draft.categories.filter((c) => c.isFeatured).length} featured`
              : ''}
          </span>
        </a>
        <a
          href="#properties"
          className={styles.entryCard}
          onClick={(e) => {
            e.preventDefault();
            toggleSection('properties');
            document
              .getElementById('properties')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <span className={styles.entryCardTitle}>Property Listings</span>
          <span className={styles.entryCardMeta}>
            {draft.properties.length} listings
            {draft.properties.filter((p) => p.isFeatured).length > 0
              ? ` · ${draft.properties.filter((p) => p.isFeatured).length} featured`
              : ''}
          </span>
        </a>
      </div>

      <div className={styles.stack}>
        {/* 1 Page Header */}
        <CmsSectionCard
          id="page"
          index={1}
          title="Page Header"
          description="Top-level page metadata for the properties listing."
          dirty={dirty && sectionDirty('page')}
          collapsible
          open={isOpen('page')}
          onToggle={() => toggleSection('page')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.page.eyebrow}
            onChange={(v) => setDraft({ ...draft, page: { ...draft.page, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['page.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.page.title}
            onChange={(v) => setDraft({ ...draft, page: { ...draft.page, title: v } })}
            maxLength={80}
            error={validation.errors['page.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.page.lead}
            onChange={(v) => setDraft({ ...draft, page: { ...draft.page, lead: v } })}
            maxLength={300}
            rows={3}
            error={validation.errors['page.lead']}
          />
        </CmsSectionCard>

        {/* 2 Hero */}
        <CmsSectionCard
          id="hero"
          index={2}
          title="Hero"
          description="Hero banner for the properties listing."
          dirty={dirty && sectionDirty('hero')}
          collapsible
          open={isOpen('hero')}
          onToggle={() => toggleSection('hero')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.page.hero.eyebrow}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, hero: { ...draft.page.hero, eyebrow: v } },
              })
            }
            maxLength={60}
            error={validation.errors['page.hero.eyebrow']}
          />
          <CmsImageField
            label="Hero image"
            value={draft.page.hero.image}
            onChange={(image) =>
              setDraft({ ...draft, page: { ...draft.page, hero: { ...draft.page.hero, image } } })
            }
            errorId={validation.errors['page.hero.image.id']}
            errorAlt={validation.errors['page.hero.image.alt']}
          />
          <CmsCtaFields
            label="Primary CTA"
            value={draft.page.hero.primaryCta}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, hero: { ...draft.page.hero, primaryCta: v } },
              })
            }
            error={
              validation.errors['page.hero.primaryCta.to'] ??
              validation.errors['page.hero.primaryCta.href']
            }
          />
        </CmsSectionCard>

        {/* 3 Intro */}
        <CmsSectionCard
          id="intro"
          index={3}
          title="Intro"
          description="Category browsing introduction."
          dirty={dirty && sectionDirty('intro')}
          collapsible
          open={isOpen('intro')}
          onToggle={() => toggleSection('intro')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.page.intro.eyebrow}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, intro: { ...draft.page.intro, eyebrow: v } },
              })
            }
            maxLength={60}
            error={validation.errors['page.intro.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.page.intro.title}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, intro: { ...draft.page.intro, title: v } },
              })
            }
            maxLength={80}
            error={validation.errors['page.intro.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.page.intro.lead}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, intro: { ...draft.page.intro, lead: v } },
              })
            }
            maxLength={300}
            rows={2}
            error={validation.errors['page.intro.lead']}
          />
        </CmsSectionCard>

        {/* 4 Featured */}
        <CmsSectionCard
          id="featured"
          index={4}
          title="Featured"
          description="Featured listings header (selection is first per category, system-derived)."
          dirty={dirty && sectionDirty('featured')}
          collapsible
          open={isOpen('featured')}
          onToggle={() => toggleSection('featured')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.page.featured.eyebrow}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, featured: { ...draft.page.featured, eyebrow: v } },
              })
            }
            maxLength={60}
            error={validation.errors['page.featured.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.page.featured.title}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, featured: { ...draft.page.featured, title: v } },
              })
            }
            maxLength={80}
            error={validation.errors['page.featured.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.page.featured.lead}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, featured: { ...draft.page.featured, lead: v } },
              })
            }
            maxLength={300}
            rows={2}
            error={validation.errors['page.featured.lead']}
          />
        </CmsSectionCard>

        {/* 5 Note */}
        <CmsSectionCard
          id="note"
          index={5}
          title="Note"
          description="Informational steps about browsing."
          dirty={dirty && sectionDirty('note')}
          collapsible
          open={isOpen('note')}
          onToggle={() => toggleSection('note')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.page.note.eyebrow}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, note: { ...draft.page.note, eyebrow: v } },
              })
            }
            maxLength={60}
            error={validation.errors['page.note.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.page.note.title}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, note: { ...draft.page.note, title: v } },
              })
            }
            maxLength={80}
            error={validation.errors['page.note.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.page.note.lead}
            onChange={(v) =>
              setDraft({ ...draft, page: { ...draft.page, note: { ...draft.page.note, lead: v } } })
            }
            maxLength={400}
            rows={2}
            error={validation.errors['page.note.lead']}
          />
          <div className={styles.stepsGrid}>
            {draft.page.note.steps.map((s, idx) => (
              <div key={`note-${idx}`} className={styles.pillarCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardIndex}>Step {idx + 1}</span>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--space-2)',
                      minWidth: 0,
                      maxWidth: '100%',
                    }}
                  >
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (idx === 0) return;
                        const next = [...draft.page.note.steps];
                        const [moved] = next.splice(idx, 1);
                        if (!moved) return;
                        next.splice(idx - 1, 0, moved);
                        setDraft({
                          ...draft,
                          page: {
                            ...draft.page,
                            note: {
                              ...draft.page.note,
                              steps: next as PropertiesContent['page']['note']['steps'],
                            },
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
                        if (idx === draft.page.note.steps.length - 1) return;
                        const next = [...draft.page.note.steps];
                        const [moved] = next.splice(idx, 1);
                        if (!moved) return;
                        next.splice(idx + 1, 0, moved);
                        setDraft({
                          ...draft,
                          page: {
                            ...draft.page,
                            note: {
                              ...draft.page.note,
                              steps: next as PropertiesContent['page']['note']['steps'],
                            },
                          },
                        });
                      }}
                      disabled={idx === draft.page.note.steps.length - 1}
                    >
                      Move down
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (draft.page.note.steps.length <= 1) return;
                        const next = draft.page.note.steps.filter((_, i) => i !== idx);
                        setDraft({
                          ...draft,
                          page: {
                            ...draft.page,
                            note: {
                              ...draft.page.note,
                              steps: next as PropertiesContent['page']['note']['steps'],
                            },
                          },
                        });
                      }}
                      disabled={draft.page.note.steps.length <= 1}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <CmsTextField
                  label={`Step ${idx + 1}: Title`}
                  value={s.title}
                  onChange={(v) => {
                    const next = [...draft.page.note.steps];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      page: {
                        ...draft.page,
                        note: {
                          ...draft.page.note,
                          steps: next as PropertiesContent['page']['note']['steps'],
                        },
                      },
                    });
                  }}
                  maxLength={60}
                  error={validation.errors[`page.note.steps.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={s.body}
                  onChange={(v) => {
                    const next = [...draft.page.note.steps];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      page: {
                        ...draft.page,
                        note: {
                          ...draft.page.note,
                          steps: next as PropertiesContent['page']['note']['steps'],
                        },
                      },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`page.note.steps.${idx}.body`]}
                />
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (draft.page.note.steps.length >= 5) return;
              const next = [...draft.page.note.steps, { title: 'New step', body: 'Step details.' }];
              setDraft({
                ...draft,
                page: {
                  ...draft.page,
                  note: {
                    ...draft.page.note,
                    steps: next as PropertiesContent['page']['note']['steps'],
                  },
                },
              });
            }}
            disabled={draft.page.note.steps.length >= 5}
          >
            Add step
          </Button>
        </CmsSectionCard>

        {/* 6 CTA */}
        <CmsSectionCard
          id="cta"
          index={6}
          title="CTA Band"
          dirty={dirty && sectionDirty('cta')}
          collapsible
          open={isOpen('cta')}
          onToggle={() => toggleSection('cta')}
        >
          <CmsTextField
            label="Title"
            value={draft.page.cta.title}
            onChange={(v) =>
              setDraft({ ...draft, page: { ...draft.page, cta: { ...draft.page.cta, title: v } } })
            }
            maxLength={80}
            error={validation.errors['page.cta.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.page.cta.lead}
            onChange={(v) =>
              setDraft({ ...draft, page: { ...draft.page, cta: { ...draft.page.cta, lead: v } } })
            }
            maxLength={300}
            rows={2}
            error={validation.errors['page.cta.lead']}
          />
          <CmsCtaFields
            label="Primary CTA"
            value={draft.page.cta.primaryCta}
            onChange={(v) =>
              setDraft({
                ...draft,
                page: { ...draft.page, cta: { ...draft.page.cta, primaryCta: v } },
              })
            }
            error={
              validation.errors['page.cta.primaryCta.to'] ??
              validation.errors['page.cta.primaryCta.href']
            }
          />
        </CmsSectionCard>

        {/* 7 Categories */}
        <CmsSectionCard
          id="categories"
          index={7}
          title="Categories"
          description={`${draft.categories.length} categories: toggle featured to highlight on the public site.`}
          dirty={dirty && sectionDirty('categories')}
          collapsible
          open={isOpen('categories')}
          onToggle={() => toggleSection('categories')}
        >
          <Button
            variant="secondary"
            onClick={() => {
              const slug = `new-category-${draft.categories.length}`;
              const newCat: CmsPropertyCategory = {
                slug,
                title: 'New Category',
                shortDescription: 'Short description.',
                description: 'Full description.',
                image: { id: 'photo-1460317442991-0ec209397118', alt: 'New category image' },
                isFeatured: false,
              };
              setDraft({ ...draft, categories: [...draft.categories, newCat] });
              setCategorySnapshot(null);
              setEditingCategory(draft.categories.length);
            }}
          >
            Add category
          </Button>
          <div className={styles.listRows}>
            {draft.categories.map((cat, idx) => (
              <div key={`cat-${idx}`} className={styles.listRow}>
                <div className={styles.listRowActions}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.categories];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({ ...draft, categories: next });
                    }}
                    disabled={idx === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (idx === draft.categories.length - 1) return;
                      const next = [...draft.categories];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({ ...draft, categories: next });
                    }}
                    disabled={idx === draft.categories.length - 1}
                  >
                    ↓
                  </Button>
                </div>
                <div className={styles.listRowContent}>
                  <span className={styles.listRowTitle}>{cat.title}</span>
                  <span className={styles.listRowMeta}>
                    {cat.slug}
                    {cat.isFeatured ? ' · Featured' : ''}
                    {categoryLinkText(cat)}
                  </span>
                </div>
                <div className={styles.listRowActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCategorySnapshot(structuredClone(cat));
                      setEditingCategory(idx);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.categories.length <= 1) return;
                      setDeletingCategoryIdx(idx);
                    }}
                    disabled={draft.categories.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CmsSectionCard>

        {/* 8 Properties */}
        <CmsSectionCard
          id="properties"
          index={8}
          title="Properties"
          description={`${draft.properties.length} properties: gallery first image is hero. Price is optional.`}
          dirty={dirty && sectionDirty('properties')}
          collapsible
          open={isOpen('properties')}
          onToggle={() => toggleSection('properties')}
        >
          <Button
            variant="secondary"
            onClick={() => {
              const id = `new-property-${draft.properties.length}`;
              const newProp: CmsProperty = {
                id,
                name: 'New Property',
                categoryId: draft.categories[0]?.slug ?? '',
                location: '',
                keyFacts: [],
                characteristics: [],
                overview: [],
                highlights: [],
                gallery: [{ id: 'photo-1570129477492-45c003edd2be', alt: 'New property image' }],
                isFeatured: false,
              };
              setDraft({ ...draft, properties: [...draft.properties, newProp] });
              setPropertySnapshot(null);
              setEditingProperty(draft.properties.length);
            }}
          >
            Add property
          </Button>
          <div className={styles.listRows}>
            {draft.properties.map((prop, idx) => {
              const catTitle = draft.categories.find((c) => c.slug === prop.categoryId)?.title;
              return (
                <div key={`prop-${idx}`} className={styles.listRow}>
                  <div className={styles.listRowActions}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (idx === 0) return;
                        const next = [...draft.properties];
                        const [moved] = next.splice(idx, 1);
                        if (!moved) return;
                        next.splice(idx - 1, 0, moved);
                        setDraft({ ...draft, properties: next });
                      }}
                      disabled={idx === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (idx === draft.properties.length - 1) return;
                        const next = [...draft.properties];
                        const [moved] = next.splice(idx, 1);
                        if (!moved) return;
                        next.splice(idx + 1, 0, moved);
                        setDraft({ ...draft, properties: next });
                      }}
                      disabled={idx === draft.properties.length - 1}
                    >
                      ↓
                    </Button>
                  </div>
                  <div className={styles.listRowContent}>
                    <span className={styles.listRowTitle}>{prop.name}</span>
                    <span className={styles.listRowMeta}>
                      {catTitle ?? prop.categoryId} · {prop.location}
                      {prop.price ? ` · ₱${prop.price}` : ''}
                      {prop.isFeatured ? ' · Featured' : ''}
                      {listingLinkText(prop)}
                    </span>
                  </div>
                  <div className={styles.listRowActions}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPropertySnapshot(structuredClone(prop));
                        setEditingProperty(idx);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => setDeletingPropertyIdx(idx)}>
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
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

      {/* Delete category confirm */}
      <ConfirmDialog
        open={deletingCategoryIdx !== null}
        onCancel={() => setDeletingCategoryIdx(null)}
        danger
        onConfirm={() => {
          if (deletingCategoryIdx === null) return;
          setDraft({
            ...draft,
            categories: draft.categories.filter((_, i) => i !== deletingCategoryIdx),
          });
          setDeletingCategoryIdx(null);
        }}
        title="Delete category?"
        message="This category will be permanently removed. Properties assigned to it will lose their category assignment."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Delete property confirm */}
      <ConfirmDialog
        open={deletingPropertyIdx !== null}
        onCancel={() => setDeletingPropertyIdx(null)}
        danger
        onConfirm={() => {
          if (deletingPropertyIdx === null) return;
          setDraft({
            ...draft,
            properties: draft.properties.filter((_, i) => i !== deletingPropertyIdx),
          });
          setDeletingPropertyIdx(null);
        }}
        title="Delete property?"
        message="This property will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Edit category dialog */}
      {editingCategory !== null && draft.categories[editingCategory] && (
        <Dialog
          open
          onClose={() => {
            if (categorySnapshot && editingCategory !== null) {
              const next = [...draft.categories];
              next[editingCategory] = categorySnapshot;
              setDraft({ ...draft, categories: next });
            }
            setEditingCategory(null);
            setCategorySnapshot(null);
          }}
          title={categorySnapshot ? 'Edit Category' : 'Add Category'}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (categorySnapshot && editingCategory !== null) {
                    const next = [...draft.categories];
                    next[editingCategory] = categorySnapshot;
                    setDraft({ ...draft, categories: next });
                  }
                  setEditingCategory(null);
                  setCategorySnapshot(null);
                }}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingCategory(null);
                  setCategorySnapshot(null);
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
            <CmsTextField
              label="Slug"
              hint={
                draft.categories.filter((c) => c.slug === draft.categories[editingCategory]!.slug)
                  .length > 1
                  ? 'Slug is not unique'
                  : undefined
              }
              value={draft.categories[editingCategory]!.slug}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, slug: v };
                setDraft({ ...draft, categories: next });
              }}
              maxLength={60}
              error={validation.errors[`categories.${editingCategory}.slug`]}
            />
            <CmsSelectField
              label="Linked catalog category"
              hint="Reads live title and listing count from the catalog. CMS keeps its own copy."
              value={draft.categories[editingCategory]!.catalogSlug ?? ''}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, catalogSlug: v || undefined };
                setDraft({ ...draft, categories: next });
              }}
              options={[
                { value: '', label: 'Not linked' },
                ...(catalogCategories ?? []).map((c) => ({
                  value: c.slug,
                  label: `${c.title} (${c.listingCount} listings)`,
                })),
              ]}
              error={validation.errors[`categories.${editingCategory}.catalogSlug`]}
            />
            {(() => {
              const resolved = resolveCategoryLink(
                draft.categories[editingCategory]!,
                catalogCategories,
              );
              if (resolved.kind === 'explicit' || resolved.kind === 'auto') {
                const linked = resolved.target;
                return (
                  <span
                    style={{
                      fontSize: 'var(--text-caption)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {resolved.kind === 'explicit' ? 'Linked' : 'Auto-linked'}: {linked.title} ·{' '}
                    {linked.listingCount} listings ·{' '}
                    <Link to="/admin/properties">Open catalog</Link>
                  </span>
                );
              }
              if (resolved.kind === 'dangling') {
                return (
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-danger)' }}>
                    Linked category “{resolved.missing}” no longer exists in the catalog.
                  </span>
                );
              }
              return null;
            })()}
            <CmsTextField
              label="Title"
              value={draft.categories[editingCategory]!.title}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, title: v };
                setDraft({ ...draft, categories: next });
              }}
              maxLength={80}
              error={validation.errors[`categories.${editingCategory}.title`]}
            />
            <CmsTextareaField
              label="Short description"
              value={draft.categories[editingCategory]!.shortDescription}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, shortDescription: v };
                setDraft({ ...draft, categories: next });
              }}
              maxLength={300}
              rows={2}
              error={validation.errors[`categories.${editingCategory}.shortDescription`]}
            />
            <CmsTextareaField
              label="Description"
              value={draft.categories[editingCategory]!.description}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, description: v };
                setDraft({ ...draft, categories: next });
              }}
              maxLength={600}
              rows={3}
              error={validation.errors[`categories.${editingCategory}.description`]}
            />
            <CmsImageField
              label="Category image"
              value={draft.categories[editingCategory]!.image}
              onChange={(image) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, image };
                setDraft({ ...draft, categories: next });
              }}
              errorId={validation.errors[`categories.${editingCategory}.image.id`]}
              errorAlt={validation.errors[`categories.${editingCategory}.image.alt`]}
            />
            <CmsToggleField
              label="Featured"
              hint="Show in featured section on public site"
              value={draft.categories[editingCategory]!.isFeatured ?? false}
              onChange={(v) => {
                const next = [...draft.categories];
                next[editingCategory] = { ...next[editingCategory]!, isFeatured: v };
                setDraft({ ...draft, categories: next });
              }}
            />
          </div>
        </Dialog>
      )}

      {/* Edit property dialog */}
      {editingProperty !== null &&
        draft.properties[editingProperty] &&
        (() => {
          const idx = editingProperty;
          const prop = draft.properties[idx];
          return (
            <Dialog
              open
              onClose={() => {
                if (propertySnapshot && editingProperty !== null) {
                  const next = [...draft.properties];
                  next[editingProperty] = propertySnapshot;
                  setDraft({ ...draft, properties: next });
                }
                setEditingProperty(null);
                setPropertySnapshot(null);
              }}
              title={propertySnapshot ? 'Edit Property' : 'Add Property'}
              footer={
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (propertySnapshot && editingProperty !== null) {
                        const next = [...draft.properties];
                        next[editingProperty] = propertySnapshot;
                        setDraft({ ...draft, properties: next });
                      }
                      setEditingProperty(null);
                      setPropertySnapshot(null);
                    }}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setEditingProperty(null);
                      setPropertySnapshot(null);
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
                <CmsTextField
                  label="ID (slug)"
                  value={prop!.id}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, id: v };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={60}
                  error={validation.errors[`properties.${idx}.id`]}
                />
                <CmsSelectField
                  label="Linked catalog listing"
                  hint="Reads live name, price, and status from the catalog. CMS keeps its own copy."
                  value={prop!.catalogId ?? ''}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, catalogId: v || undefined };
                    setDraft({ ...draft, properties: next });
                  }}
                  options={[
                    { value: '', label: 'Not linked' },
                    ...(catalogListings ?? []).map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.status})`,
                    })),
                  ]}
                  error={validation.errors[`properties.${idx}.catalogId`]}
                />
                {(() => {
                  const resolved = resolveListingLink(prop!, catalogListings);
                  if (resolved.kind === 'explicit' || resolved.kind === 'auto') {
                    const linked = resolved.target;
                    return (
                      <span
                        style={{
                          fontSize: 'var(--text-caption)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {resolved.kind === 'explicit' ? 'Linked' : 'Auto-linked'}: {linked.name} ·{' '}
                        {linked.price ? formatMoney(linked.price) : 'no price'} · {linked.status} ·{' '}
                        <Link to={`/admin/properties/${linked.id}`}>Open listing</Link>
                      </span>
                    );
                  }
                  if (resolved.kind === 'dangling') {
                    return (
                      <span
                        style={{ fontSize: 'var(--text-caption)', color: 'var(--color-danger)' }}
                      >
                        Linked listing “{resolved.missing}” no longer exists in the catalog.
                      </span>
                    );
                  }
                  return null;
                })()}
                <CmsTextField
                  label="Name"
                  value={prop!.name}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, name: v };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={120}
                  error={validation.errors[`properties.${idx}.name`]}
                />
                <CmsSelectField
                  label="Category"
                  value={prop!.categoryId}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, categoryId: v };
                    setDraft({ ...draft, properties: next });
                  }}
                  options={draft.categories.map((c) => ({ value: c.slug, label: c.title }))}
                  error={validation.errors[`properties.${idx}.categoryId`]}
                />
                <CmsTextField
                  label="Location"
                  value={prop!.location}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, location: v };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={120}
                  error={validation.errors[`properties.${idx}.location`]}
                />
                <CmsTextField
                  label="Price (optional, exact-decimal)"
                  hint="Leave empty if no published price"
                  value={prop!.price ?? ''}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, price: v || undefined };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={40}
                  error={validation.errors[`properties.${idx}.price`]}
                  placeholder="1200000.00"
                />
                <CmsToggleField
                  label="Featured"
                  hint="Highlight on public site"
                  value={prop!.isFeatured ?? false}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = { ...next[idx]!, isFeatured: v };
                    setDraft({ ...draft, properties: next });
                  }}
                />
                <div>
                  <span className={styles.formLabel}>Key Facts</span>
                  {prop!.keyFacts.map((fact, fIdx) => (
                    <div key={`fact-${fIdx}`} className={styles.stepsGrid}>
                      <CmsTextField
                        label={`Fact ${fIdx + 1}: Label`}
                        value={fact.label}
                        onChange={(v) => {
                          const next = [...draft.properties];
                          const nextFacts = [...next[idx]!.keyFacts];
                          nextFacts[fIdx] = { ...nextFacts[fIdx]!, label: v };
                          next[idx] = { ...next[idx]!, keyFacts: nextFacts };
                          setDraft({ ...draft, properties: next });
                        }}
                        maxLength={60}
                        error={validation.errors[`properties.${idx}.keyFacts.${fIdx}.label`]}
                      />
                      <CmsTextField
                        label="Value"
                        value={fact.value}
                        onChange={(v) => {
                          const next = [...draft.properties];
                          const nextFacts = [...next[idx]!.keyFacts];
                          nextFacts[fIdx] = { ...nextFacts[fIdx]!, value: v };
                          next[idx] = { ...next[idx]!, keyFacts: nextFacts };
                          setDraft({ ...draft, properties: next });
                        }}
                        maxLength={120}
                        error={validation.errors[`properties.${idx}.keyFacts.${fIdx}.value`]}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const next = [...draft.properties];
                          next[idx] = {
                            ...next[idx]!,
                            keyFacts: next[idx]!.keyFacts.filter((_, i) => i !== fIdx),
                          };
                          setDraft({ ...draft, properties: next });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const next = [...draft.properties];
                      next[idx] = {
                        ...next[idx]!,
                        keyFacts: [...next[idx]!.keyFacts, { label: 'New fact', value: 'Value' }],
                      };
                      setDraft({ ...draft, properties: next });
                    }}
                  >
                    Add key fact
                  </Button>
                </div>
                <CmsTextField
                  label="Characteristics (comma-separated)"
                  hint="Stored as array; edit as comma-separated"
                  value={prop!.characteristics.join(', ')}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = {
                      ...next[idx]!,
                      characteristics: v
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={500}
                  error={validation.errors[`properties.${idx}.characteristics`]}
                />
                <CmsTextareaField
                  label="Overview: Paragraph 1"
                  value={prop!.overview[0] ?? ''}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    const nextOverview = [...next[idx]!.overview];
                    nextOverview[0] = v;
                    next[idx] = { ...next[idx]!, overview: nextOverview };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={600}
                  rows={3}
                  error={validation.errors[`properties.${idx}.overview.0`]}
                />
                <CmsTextareaField
                  label="Overview: Paragraph 2"
                  value={prop!.overview[1] ?? ''}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    const nextOverview = [...next[idx]!.overview];
                    nextOverview[1] = v;
                    next[idx] = { ...next[idx]!, overview: nextOverview };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={600}
                  rows={3}
                  error={validation.errors[`properties.${idx}.overview.1`]}
                />
                <CmsTextareaField
                  label="Highlights (one per line)"
                  hint="Each line becomes a highlight"
                  value={prop!.highlights.join('\n')}
                  onChange={(v) => {
                    const next = [...draft.properties];
                    next[idx] = {
                      ...next[idx]!,
                      highlights: v
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    };
                    setDraft({ ...draft, properties: next });
                  }}
                  maxLength={2000}
                  rows={4}
                  error={validation.errors[`properties.${idx}.highlights`]}
                />
                <div>
                  <span className={styles.formLabel}>Gallery</span>
                  <div className={styles.stepsGrid}>
                    {prop!.gallery.map((photo, gIdx) => (
                      <CmsImageField
                        key={`gallery-${gIdx}`}
                        label={gIdx === 0 ? 'Hero image (gallery[0])' : `Gallery image ${gIdx + 1}`}
                        value={photo}
                        onChange={(image) => {
                          const next = [...draft.properties];
                          const nextGallery = [...next[idx]!.gallery];
                          nextGallery[gIdx] = image;
                          next[idx] = { ...next[idx]!, gallery: nextGallery };
                          setDraft({ ...draft, properties: next });
                        }}
                        errorId={validation.errors[`properties.${idx}.gallery.${gIdx}.id`]}
                        errorAlt={validation.errors[`properties.${idx}.gallery.${gIdx}.alt`]}
                      />
                    ))}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const next = [...draft.properties];
                        next[idx] = {
                          ...next[idx]!,
                          gallery: [
                            ...next[idx]!.gallery,
                            { id: 'photo-1570129477492-45c003edd2be', alt: 'New gallery image' },
                          ],
                        };
                        setDraft({ ...draft, properties: next });
                      }}
                    >
                      Add gallery image
                    </Button>
                    {prop!.gallery.length > 1 ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const next = [...draft.properties];
                          next[idx] = {
                            ...next[idx]!,
                            gallery: next[idx]!.gallery.slice(0, -1),
                          };
                          setDraft({ ...draft, properties: next });
                        }}
                      >
                        Remove last gallery image
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Dialog>
          );
        })()}
    </section>
  );
}
