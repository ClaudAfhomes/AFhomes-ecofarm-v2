import { useEffect, useMemo, useState } from 'react';

import { Button, ConfirmDialog, ErrorState, notifySuccess, PageHeader, Skeleton } from '@jad/ui';
import { aboutContentSchema, type AboutContent } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsCtaFields } from '../components/CmsCtaFields';
import { CmsTextField, CmsTextareaField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useAboutCms, useUpdateAboutCms } from '../hooks/useAboutCms';
import { useCmsAccordion } from '../hooks/useCmsAccordion';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: AboutContent, b: AboutContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'hero', label: 'Hero' },
  { id: 'intro', label: 'Who We Are' },
  { id: 'philosophy', label: 'Philosophy' },
  { id: 'approach', label: 'Approach' },
  { id: 'vision', label: 'Vision' },
  { id: 'mission', label: 'Mission' },
  { id: 'cta', label: 'CTA Band' },
] as const;

export function CmsAboutPage() {
  const { data, isPending, isError, error, refetch } = useAboutCms();
  const update = useUpdateAboutCms();
  const [draft, setDraft] = useState<AboutContent | null>(null);
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
    const parsed = aboutContentSchema.safeParse(draft);
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
        <PageHeader title="About CMS" description="Manage the public About page content." />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader title="About CMS" description="Manage the public About page content." />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader title="About CMS" description="Manage the public About page content." />
        <ErrorState title="No content" message="About content is unavailable." />
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
      case 'intro':
        return JSON.stringify(draft.intro) !== JSON.stringify(data.intro);
      case 'philosophy':
        return JSON.stringify(draft.philosophy) !== JSON.stringify(data.philosophy);
      case 'approach':
        return JSON.stringify(draft.approach) !== JSON.stringify(data.approach);
      case 'vision':
        return JSON.stringify(draft.vision) !== JSON.stringify(data.vision);
      case 'mission':
        return JSON.stringify(draft.mission) !== JSON.stringify(data.mission);
      case 'cta':
        return JSON.stringify(draft.cta) !== JSON.stringify(data.cta);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const prefixMap: Record<string, string> = {
      hero: 'hero.',
      intro: 'intro.',
      philosophy: 'philosophy.',
      approach: 'approach.',
      vision: 'vision.',
      mission: 'mission.',
      cta: 'cta.',
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
      <PageHeader title="About CMS" description="Manage the public About page content." />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="About sections">
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
          description="Top of the About page: headline, supporting copy, and hero image."
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
          <CmsTextField
            label="Title"
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
          <CmsCtaFields
            label="Primary CTA"
            value={draft.hero.primaryCta}
            onChange={(v) => setDraft({ ...draft, hero: { ...draft.hero, primaryCta: v } })}
            error={
              validation.errors['hero.primaryCta.to'] ?? validation.errors['hero.primaryCta.href']
            }
          />
          <CmsImageField
            label="Hero image"
            value={draft.hero.image}
            onChange={(image) => setDraft({ ...draft, hero: { ...draft.hero, image } })}
            errorId={validation.errors['hero.image.id']}
            errorAlt={validation.errors['hero.image.alt']}
          />
        </CmsSectionCard>

        {/* 2 Who We Are / Intro */}
        <CmsSectionCard
          id="intro"
          index={2}
          title="Who We Are"
          description="Intro split: label and paragraphs with portrait image."
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
            label="Title"
            value={draft.intro.title}
            onChange={(v) => setDraft({ ...draft, intro: { ...draft.intro, title: v } })}
            maxLength={80}
            error={validation.errors['intro.title']}
          />
          <CmsTextField
            label="Label: Title"
            value={draft.intro.label.title}
            onChange={(v) =>
              setDraft({
                ...draft,
                intro: { ...draft.intro, label: { ...draft.intro.label, title: v } },
              })
            }
            maxLength={60}
            error={validation.errors['intro.label.title']}
          />
          <CmsTextareaField
            label="Label: Body"
            value={draft.intro.label.body}
            onChange={(v) =>
              setDraft({
                ...draft,
                intro: { ...draft.intro, label: { ...draft.intro.label, body: v } },
              })
            }
            maxLength={200}
            rows={2}
            error={validation.errors['intro.label.body']}
          />
          {draft.intro.paragraphs.map((p, idx) => (
            <CmsTextareaField
              key={`intro-p-${idx}`}
              label={`Paragraph ${idx + 1}`}
              value={p}
              onChange={(v) => {
                const next = [...draft.intro.paragraphs];
                next[idx] = v;
                setDraft({
                  ...draft,
                  intro: {
                    ...draft.intro,
                    paragraphs: next as AboutContent['intro']['paragraphs'],
                  },
                });
              }}
              maxLength={600}
              rows={3}
              error={validation.errors[`intro.paragraphs.${idx}`]}
            />
          ))}
          <CmsImageField
            label="Intro image"
            value={draft.intro.image}
            onChange={(image) => setDraft({ ...draft, intro: { ...draft.intro, image } })}
            errorId={validation.errors['intro.image.id']}
            errorAlt={validation.errors['intro.image.alt']}
          />
        </CmsSectionCard>

        {/* 3 Philosophy */}
        <CmsSectionCard
          id="philosophy"
          index={3}
          title="Philosophy"
          dirty={dirty && sectionDirty('philosophy')}
          collapsible
          open={isOpen('philosophy')}
          onToggle={() => toggleSection('philosophy')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.philosophy.eyebrow}
            onChange={(v) =>
              setDraft({ ...draft, philosophy: { ...draft.philosophy, eyebrow: v } })
            }
            maxLength={60}
            error={validation.errors['philosophy.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.philosophy.title}
            onChange={(v) => setDraft({ ...draft, philosophy: { ...draft.philosophy, title: v } })}
            maxLength={80}
            error={validation.errors['philosophy.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.philosophy.lead}
            onChange={(v) => setDraft({ ...draft, philosophy: { ...draft.philosophy, lead: v } })}
            maxLength={300}
            rows={2}
            error={validation.errors['philosophy.lead']}
          />
          <div className={styles.stepsGrid}>
            {draft.philosophy.items.map((it, idx) => (
              <div key={`philo-${idx}`} className={styles.pillarCard}>
                <CmsTextField
                  label={`Item ${idx + 1}: Title`}
                  value={it.title}
                  onChange={(v) => {
                    const next = [...draft.philosophy.items];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      philosophy: {
                        ...draft.philosophy,
                        items: next as AboutContent['philosophy']['items'],
                      },
                    });
                  }}
                  maxLength={60}
                  error={validation.errors[`philosophy.items.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={it.body}
                  onChange={(v) => {
                    const next = [...draft.philosophy.items];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      philosophy: {
                        ...draft.philosophy,
                        items: next as AboutContent['philosophy']['items'],
                      },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`philosophy.items.${idx}.body`]}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.philosophy.items];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({
                        ...draft,
                        philosophy: {
                          ...draft.philosophy,
                          items: next as AboutContent['philosophy']['items'],
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
                      if (idx === draft.philosophy.items.length - 1) return;
                      const next = [...draft.philosophy.items];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({
                        ...draft,
                        philosophy: {
                          ...draft.philosophy,
                          items: next as AboutContent['philosophy']['items'],
                        },
                      });
                    }}
                    disabled={idx === draft.philosophy.items.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.philosophy.items.length <= 1) return;
                      const next = draft.philosophy.items.filter((_, i) => i !== idx);
                      setDraft({
                        ...draft,
                        philosophy: {
                          ...draft.philosophy,
                          items: next as AboutContent['philosophy']['items'],
                        },
                      });
                    }}
                    disabled={draft.philosophy.items.length <= 1}
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
              if (draft.philosophy.items.length >= 8) return;
              const next = [
                ...draft.philosophy.items,
                { title: 'New item', body: 'Item details.' },
              ];
              setDraft({
                ...draft,
                philosophy: {
                  ...draft.philosophy,
                  items: next as AboutContent['philosophy']['items'],
                },
              });
            }}
            disabled={draft.philosophy.items.length >= 8}
          >
            Add item
          </Button>
        </CmsSectionCard>

        {/* 4 Our Approach */}
        <CmsSectionCard
          id="approach"
          index={4}
          title="Our Approach"
          dirty={dirty && sectionDirty('approach')}
          collapsible
          open={isOpen('approach')}
          onToggle={() => toggleSection('approach')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.approach.eyebrow}
            onChange={(v) => setDraft({ ...draft, approach: { ...draft.approach, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['approach.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.approach.title}
            onChange={(v) => setDraft({ ...draft, approach: { ...draft.approach, title: v } })}
            maxLength={80}
            error={validation.errors['approach.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.approach.lead}
            onChange={(v) => setDraft({ ...draft, approach: { ...draft.approach, lead: v } })}
            maxLength={600}
            rows={3}
            error={validation.errors['approach.lead']}
          />
          <div className={styles.stepsGrid}>
            {draft.approach.points.map((pt, idx) => (
              <div key={`approach-${idx}`} className={styles.pillarCard}>
                <CmsTextField
                  label={`Point ${idx + 1}: Title`}
                  value={pt.title}
                  onChange={(v) => {
                    const next = [...draft.approach.points];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      approach: {
                        ...draft.approach,
                        points: next as AboutContent['approach']['points'],
                      },
                    });
                  }}
                  maxLength={60}
                  error={validation.errors[`approach.points.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={pt.body}
                  onChange={(v) => {
                    const next = [...draft.approach.points];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      approach: {
                        ...draft.approach,
                        points: next as AboutContent['approach']['points'],
                      },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`approach.points.${idx}.body`]}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.approach.points];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          points: next as AboutContent['approach']['points'],
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
                      if (idx === draft.approach.points.length - 1) return;
                      const next = [...draft.approach.points];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          points: next as AboutContent['approach']['points'],
                        },
                      });
                    }}
                    disabled={idx === draft.approach.points.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.approach.points.length <= 1) return;
                      const next = draft.approach.points.filter((_, i) => i !== idx);
                      setDraft({
                        ...draft,
                        approach: {
                          ...draft.approach,
                          points: next as AboutContent['approach']['points'],
                        },
                      });
                    }}
                    disabled={draft.approach.points.length <= 1}
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
              if (draft.approach.points.length >= 8) return;
              const next = [
                ...draft.approach.points,
                { title: 'New point', body: 'Point details.' },
              ];
              setDraft({
                ...draft,
                approach: { ...draft.approach, points: next as AboutContent['approach']['points'] },
              });
            }}
            disabled={draft.approach.points.length >= 8}
          >
            Add point
          </Button>
          <CmsImageField
            label="Approach image"
            value={draft.approach.image}
            onChange={(image) => setDraft({ ...draft, approach: { ...draft.approach, image } })}
            errorId={validation.errors['approach.image.id']}
            errorAlt={validation.errors['approach.image.alt']}
          />
        </CmsSectionCard>

        {/* 5 Vision */}
        <CmsSectionCard
          id="vision"
          index={5}
          title="Vision"
          dirty={dirty && sectionDirty('vision')}
          collapsible
          open={isOpen('vision')}
          onToggle={() => toggleSection('vision')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.vision.eyebrow}
            onChange={(v) => setDraft({ ...draft, vision: { ...draft.vision, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['vision.eyebrow']}
          />
          <CmsTextareaField
            label="Statement"
            value={draft.vision.statement}
            onChange={(v) => setDraft({ ...draft, vision: { ...draft.vision, statement: v } })}
            maxLength={300}
            rows={3}
            error={validation.errors['vision.statement']}
          />
        </CmsSectionCard>

        {/* 6 Mission */}
        <CmsSectionCard
          id="mission"
          index={6}
          title="Mission"
          dirty={dirty && sectionDirty('mission')}
          collapsible
          open={isOpen('mission')}
          onToggle={() => toggleSection('mission')}
        >
          <CmsTextField
            label="Eyebrow"
            value={draft.mission.eyebrow}
            onChange={(v) => setDraft({ ...draft, mission: { ...draft.mission, eyebrow: v } })}
            maxLength={60}
            error={validation.errors['mission.eyebrow']}
          />
          <CmsTextField
            label="Title"
            value={draft.mission.title}
            onChange={(v) => setDraft({ ...draft, mission: { ...draft.mission, title: v } })}
            maxLength={80}
            error={validation.errors['mission.title']}
          />
          <CmsTextareaField
            label="Lead"
            value={draft.mission.lead}
            onChange={(v) => setDraft({ ...draft, mission: { ...draft.mission, lead: v } })}
            maxLength={400}
            rows={3}
            error={validation.errors['mission.lead']}
          />
          <div className={styles.pillarGrid}>
            {draft.mission.points.map((pt, idx) => (
              <div key={`mission-${idx}`} className={styles.pillarCard}>
                <CmsTextField
                  label={`Point ${idx + 1}: Title`}
                  value={pt.title}
                  onChange={(v) => {
                    const next = [...draft.mission.points];
                    next[idx] = { ...next[idx]!, title: v, body: next[idx]!.body };
                    setDraft({
                      ...draft,
                      mission: {
                        ...draft.mission,
                        points: next as AboutContent['mission']['points'],
                      },
                    });
                  }}
                  maxLength={60}
                  error={validation.errors[`mission.points.${idx}.title`]}
                />
                <CmsTextareaField
                  label="Body"
                  value={pt.body}
                  onChange={(v) => {
                    const next = [...draft.mission.points];
                    next[idx] = { ...next[idx]!, title: next[idx]!.title, body: v };
                    setDraft({
                      ...draft,
                      mission: {
                        ...draft.mission,
                        points: next as AboutContent['mission']['points'],
                      },
                    });
                  }}
                  maxLength={300}
                  rows={2}
                  error={validation.errors[`mission.points.${idx}.body`]}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...draft.mission.points];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx - 1, 0, moved);
                      setDraft({
                        ...draft,
                        mission: {
                          ...draft.mission,
                          points: next as AboutContent['mission']['points'],
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
                      if (idx === draft.mission.points.length - 1) return;
                      const next = [...draft.mission.points];
                      const [moved] = next.splice(idx, 1);
                      if (!moved) return;
                      next.splice(idx + 1, 0, moved);
                      setDraft({
                        ...draft,
                        mission: {
                          ...draft.mission,
                          points: next as AboutContent['mission']['points'],
                        },
                      });
                    }}
                    disabled={idx === draft.mission.points.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (draft.mission.points.length <= 1) return;
                      const next = draft.mission.points.filter((_, i) => i !== idx);
                      setDraft({
                        ...draft,
                        mission: {
                          ...draft.mission,
                          points: next as AboutContent['mission']['points'],
                        },
                      });
                    }}
                    disabled={draft.mission.points.length <= 1}
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
              if (draft.mission.points.length >= 8) return;
              const next = [
                ...draft.mission.points,
                { title: 'New point', body: 'Point details.' },
              ];
              setDraft({
                ...draft,
                mission: { ...draft.mission, points: next as AboutContent['mission']['points'] },
              });
            }}
            disabled={draft.mission.points.length >= 8}
          >
            Add point
          </Button>
        </CmsSectionCard>

        {/* 7 CTA Band */}
        <CmsSectionCard
          id="cta"
          index={7}
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
            maxLength={300}
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
    </section>
  );
}
