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
import { globalContentSchema, type GlobalContent, type GlobalFooterContact } from '@jad/contracts';

import { CmsAccordionControls } from '../components/CmsAccordionControls';
import { CmsTextField, CmsTextareaField, CmsToggleField } from '../components/CmsFields';
import { CmsFormActions } from '../components/CmsFormActions';
import { CmsImageField } from '../components/CmsImageField';
import { CmsSectionCard } from '../components/CmsSectionCard';
import { useCmsAccordion } from '../hooks/useCmsAccordion';
import { useGlobalCms, useUpdateGlobalCms } from '../hooks/useGlobalCms';

import styles from './CmsHomepagePage.module.css';

function isDirty(a: GlobalContent, b: GlobalContent): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

const SECTION_DEFS = [
  { id: 'brand', label: 'Brand' },
  { id: 'logo', label: 'Logo & Favicon' },
  { id: 'authBrand', label: 'Auth Brand Mark' },
  { id: 'footer', label: 'Footer' },
  { id: 'messenger', label: 'Messenger FAB' },
  { id: 'seo', label: 'SEO' },
] as const;

const PAGE_SEO_KEYS: { key: keyof GlobalContent['seo']['pages']; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'about', label: 'About' },
  { key: 'properties', label: 'Properties' },
  { key: 'faqs', label: 'FAQs' },
  { key: 'contact', label: 'Contact' },
  { key: 'login', label: 'Login' },
  { key: 'register', label: 'Register' },
  { key: 'verify', label: 'Verify Email' },
  { key: 'status', label: 'Application Status' },
];

export function CmsGlobalPage() {
  const { data, isPending, isError, error, refetch } = useGlobalCms();
  const update = useUpdateGlobalCms();
  const [draft, setDraft] = useState<GlobalContent | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [contactSnapshot, setContactSnapshot] = useState<GlobalFooterContact | null>(null);
  const [deletingContactIdx, setDeletingContactIdx] = useState<number | null>(null);
  const { openId, toggle, open, expandAll, collapseAll, isOpen } = useCmsAccordion(SECTION_DEFS);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (SECTION_DEFS.some((s) => s.id === hash)) return hash;
    }
    return 'brand';
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
    const parsed = globalContentSchema.safeParse(draft);
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
          title="Global Content CMS"
          description="Manage site-wide brand, logo, footer, Messenger, and SEO."
        />
        <Skeleton style={{ height: 320 }} />
      </section>
    );
  }
  if (isError) {
    return (
      <section>
        <PageHeader
          title="Global Content CMS"
          description="Manage site-wide brand, logo, footer, Messenger, and SEO."
        />
        <ErrorState error={error} onRetry={() => refetch()} />
      </section>
    );
  }
  if (!data || !draft) {
    return (
      <section>
        <PageHeader
          title="Global Content CMS"
          description="Manage site-wide brand, logo, footer, Messenger, and SEO."
        />
        <ErrorState title="No content" message="Global content is unavailable." />
      </section>
    );
  }

  const dirty = isDirty(draft, data);
  const valid = validation.success;

  const sectionDirty = (key: string): boolean => {
    if (!draft || !data) return false;
    switch (key) {
      case 'brand':
        return JSON.stringify(draft.brand) !== JSON.stringify(data.brand);
      case 'logo':
        return JSON.stringify(draft.logo) !== JSON.stringify(data.logo);
      case 'authBrand':
        return (
          JSON.stringify(draft.brandMark) !== JSON.stringify(data.brandMark) ||
          JSON.stringify(draft.browserIcon) !== JSON.stringify(data.browserIcon)
        );
      case 'footer':
        return JSON.stringify(draft.footer) !== JSON.stringify(data.footer);
      case 'messenger':
        return JSON.stringify(draft.messenger) !== JSON.stringify(data.messenger);
      case 'seo':
        return JSON.stringify(draft.seo) !== JSON.stringify(data.seo);
      default:
        return false;
    }
  };

  const sectionHasError = (key: string): boolean => {
    const rootMap: Record<string, string> = {
      brand: 'brand',
      logo: 'logo',
      authBrand: 'brandMark',
      footer: 'footer',
      messenger: 'messenger',
      seo: 'seo',
    };
    const root = rootMap[key];
    if (!root) return false;
    if (key === 'authBrand') {
      return (
        Object.keys(validation.errors).some((k) => k.startsWith('brandMark.')) ||
        Object.keys(validation.errors).some((k) => k.startsWith('browserIcon.'))
      );
    }
    return Object.keys(validation.errors).some((k) => k.startsWith(`${root}.`));
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

  const moveContact = (from: number, to: number) => {
    if (to < 0 || to >= draft.footer.contacts.length) return;
    const next = [...draft.footer.contacts];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDraft({ ...draft, footer: { ...draft.footer, contacts: next } });
  };

  return (
    <section>
      <PageHeader
        title="Global Content CMS"
        description="Manage site-wide brand, logo, footer, Messenger, and SEO."
      />

      {saveMessage ? (
        <div className={styles.bannerError} role="alert">
          {saveMessage}
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="Global Content sections">
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
        {/* 1 Brand */}
        <CmsSectionCard
          id="brand"
          index={1}
          title="Brand"
          description="Site-wide name, tagline, and positioning shown in the header, footer, and metadata."
          dirty={dirty && sectionDirty('brand')}
          collapsible
          open={isOpen('brand')}
          onToggle={() => toggleSection('brand')}
        >
          <CmsTextField
            label="Brand name"
            value={draft.brand.name}
            onChange={(v) => setDraft({ ...draft, brand: { ...draft.brand, name: v } })}
            maxLength={60}
            error={validation.errors['brand.name']}
          />
          <CmsTextField
            label="Short name"
            hint="Used for compact UI and social shares."
            value={draft.brand.shortName}
            onChange={(v) => setDraft({ ...draft, brand: { ...draft.brand, shortName: v } })}
            maxLength={20}
            error={validation.errors['brand.shortName']}
          />
          <CmsTextareaField
            label="Tagline"
            value={draft.brand.tagline}
            onChange={(v) => setDraft({ ...draft, brand: { ...draft.brand, tagline: v } })}
            maxLength={200}
            rows={2}
            error={validation.errors['brand.tagline']}
          />
          <CmsTextareaField
            label="Positioning line"
            value={draft.brand.positioningLine}
            onChange={(v) => setDraft({ ...draft, brand: { ...draft.brand, positioningLine: v } })}
            maxLength={120}
            rows={2}
            error={validation.errors['brand.positioningLine']}
          />
        </CmsSectionCard>

        {/* 2 Site Logo */}
        <CmsSectionCard
          id="logo"
          index={2}
          title="Site Logo"
          description="Primary logo used in the header and footer."
          dirty={dirty && sectionDirty('logo')}
          collapsible
          open={isOpen('logo')}
          onToggle={() => toggleSection('logo')}
        >
          <CmsImageField
            label="Logo"
            value={draft.logo}
            onChange={(logo) => setDraft({ ...draft, logo })}
            errorId={validation.errors['logo.id']}
            errorAlt={validation.errors['logo.alt']}
          />
        </CmsSectionCard>

        {/* 3 Auth Brand Mark (global defaults) */}
        <CmsSectionCard
          id="authBrand"
          index={3}
          title="Auth Brand Mark"
          description="White logo for the auth brand panels and the site favicon. Used as the default for Login and Register - leave per-page empty to inherit."
          dirty={dirty && sectionDirty('authBrand')}
          collapsible
          open={isOpen('authBrand')}
          onToggle={() => toggleSection('authBrand')}
        >
          <CmsImageField
            label="Auth brand mark"
            value={draft.brandMark}
            onChange={(brandMark) => setDraft({ ...draft, brandMark })}
            note="White logo shown on dark auth brand panels. SVG or PNG recommended."
            errorId={validation.errors['brandMark.id']}
            errorAlt={validation.errors['brandMark.alt']}
          />
          <CmsImageField
            label="Browser icon (favicon)"
            value={draft.browserIcon}
            onChange={(browserIcon) => setDraft({ ...draft, browserIcon })}
            note="Square icon, ideally 32×32. Updates the site favicon."
            errorId={validation.errors['browserIcon.id']}
            errorAlt={validation.errors['browserIcon.alt']}
          />
        </CmsSectionCard>

        {/* 4 Footer */}
        <CmsSectionCard
          id="footer"
          index={4}
          title="Footer"
          description="Site footer columns, contact rows (also shown on the Contact page), and the legal bottom bar."
          dirty={dirty && sectionDirty('footer')}
          collapsible
          open={isOpen('footer')}
          onToggle={() => toggleSection('footer')}
        >
          <CmsTextareaField
            label="Brand line"
            value={draft.footer.brandLine}
            onChange={(v) => setDraft({ ...draft, footer: { ...draft.footer, brandLine: v } })}
            maxLength={300}
            rows={2}
            error={validation.errors['footer.brandLine']}
          />
          <div className={styles.ctaPair}>
            <CmsTextField
              label="Explore heading"
              value={draft.footer.exploreHeading}
              onChange={(v) =>
                setDraft({ ...draft, footer: { ...draft.footer, exploreHeading: v } })
              }
              maxLength={40}
              error={validation.errors['footer.exploreHeading']}
            />
            <CmsTextField
              label="Contact heading"
              hint="Shown above the footer contact column and the Contact page details."
              value={draft.footer.contactHeading}
              onChange={(v) =>
                setDraft({ ...draft, footer: { ...draft.footer, contactHeading: v } })
              }
              maxLength={60}
              error={validation.errors['footer.contactHeading']}
            />
          </div>
          <CmsTextField
            label="Legal suffix"
            hint="Appended after the copyright year and brand name."
            value={draft.footer.bottomBar.legalSuffix}
            onChange={(v) =>
              setDraft({
                ...draft,
                footer: {
                  ...draft.footer,
                  bottomBar: { ...draft.footer.bottomBar, legalSuffix: v },
                },
              })
            }
            maxLength={120}
            error={validation.errors['footer.bottomBar.legalSuffix']}
          />
          <CmsToggleField
            label="Show positioning tagline in bottom bar"
            value={draft.footer.bottomBar.showTagline ?? true}
            onChange={(v) =>
              setDraft({
                ...draft,
                footer: {
                  ...draft.footer,
                  bottomBar: { ...draft.footer.bottomBar, showTagline: v },
                },
              })
            }
          />
          <h4 className={styles.cardIndex}>Contact rows</h4>
          <Button
            variant="secondary"
            onClick={() => {
              const newItem: GlobalFooterContact = { label: 'New detail', value: 'New value' };
              setDraft({
                ...draft,
                footer: { ...draft.footer, contacts: [...draft.footer.contacts, newItem] },
              });
              setContactSnapshot(null);
              setEditingContact(draft.footer.contacts.length);
            }}
            disabled={draft.footer.contacts.length >= 6}
          >
            Add contact row
          </Button>
          <div className={styles.listRows}>
            {draft.footer.contacts.map((item, idx) => (
              <div key={`contact-${idx}`} className={styles.listRow}>
                <div className={styles.listRowActions}>
                  <Button
                    variant="ghost"
                    onClick={() => moveContact(idx, idx - 1)}
                    disabled={idx === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => moveContact(idx, idx + 1)}
                    disabled={idx === draft.footer.contacts.length - 1}
                  >
                    ↓
                  </Button>
                </div>
                <div className={styles.listRowContent}>
                  <span className={styles.listRowTitle}>{item.label}</span>
                  <span className={styles.listRowMeta}>{item.value}</span>
                </div>
                <div className={styles.listRowActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setContactSnapshot(structuredClone(item));
                      setEditingContact(idx);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDeletingContactIdx(idx)}
                    disabled={draft.footer.contacts.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CmsSectionCard>

        {/* 5 Messenger FAB */}
        <CmsSectionCard
          id="messenger"
          index={5}
          title="Messenger FAB"
          description="Floating 'Let's Talk' button shown on every public page and the property-detail 'Message Us' CTA."
          dirty={dirty && sectionDirty('messenger')}
          collapsible
          open={isOpen('messenger')}
          onToggle={() => toggleSection('messenger')}
        >
          <CmsTextField
            label="Messenger URL"
            hint="The destination for the floating button and property-detail CTA."
            value={draft.messenger.url}
            onChange={(v) => setDraft({ ...draft, messenger: { ...draft.messenger, url: v } })}
            maxLength={200}
            error={validation.errors['messenger.url']}
          />
          <div className={styles.ctaPair}>
            <CmsTextField
              label="Button label"
              value={draft.messenger.label}
              onChange={(v) => setDraft({ ...draft, messenger: { ...draft.messenger, label: v } })}
              maxLength={40}
              error={validation.errors['messenger.label']}
            />
            <CmsTextField
              label="Accessible label"
              value={draft.messenger.ariaLabel}
              onChange={(v) =>
                setDraft({ ...draft, messenger: { ...draft.messenger, ariaLabel: v } })
              }
              maxLength={120}
              error={validation.errors['messenger.ariaLabel']}
            />
          </div>
          <CmsToggleField
            label="Hide on auth pages (Login / Register)"
            value={draft.messenger.hideOnAuth ?? true}
            onChange={(v) =>
              setDraft({ ...draft, messenger: { ...draft.messenger, hideOnAuth: v } })
            }
          />
        </CmsSectionCard>

        {/* 6 SEO */}
        <CmsSectionCard
          id="seo"
          index={6}
          title="SEO"
          description="Site-wide fallback for all public pages (Home, About, Properties, FAQs, Contact, Login, Register). The theme palette drives the brand colors and browser header accent."
          dirty={dirty && sectionDirty('seo')}
          collapsible
          open={isOpen('seo')}
          onToggle={() => toggleSection('seo')}
        >
          <CmsTextareaField
            label="Default title"
            value={draft.seo.title}
            onChange={(v) => setDraft({ ...draft, seo: { ...draft.seo, title: v } })}
            maxLength={120}
            rows={2}
            error={validation.errors['seo.title']}
          />
          <CmsTextareaField
            label="Meta description"
            value={draft.seo.description}
            onChange={(v) => setDraft({ ...draft, seo: { ...draft.seo, description: v } })}
            maxLength={300}
            rows={3}
            error={validation.errors['seo.description']}
          />
          <h4 className={styles.cardIndex}>Theme palette</h4>
          <CmsTextField
            label="Primary"
            hint="Brand primary + browser theme-color (required), e.g. #2c6aa7"
            value={draft.seo.theme.primary}
            onChange={(v) =>
              setDraft({
                ...draft,
                seo: { ...draft.seo, theme: { ...draft.seo.theme, primary: v } },
              })
            }
            maxLength={7}
            error={validation.errors['seo.theme.primary']}
          />
          <CmsTextField
            label="Secondary"
            hint="Brand secondary (optional), e.g. #3477b8"
            value={draft.seo.theme.secondary ?? ''}
            onChange={(v) =>
              setDraft({
                ...draft,
                seo: { ...draft.seo, theme: { ...draft.seo.theme, secondary: v || undefined } },
              })
            }
            maxLength={7}
            error={validation.errors['seo.theme.secondary']}
          />
          <CmsTextField
            label="Accent"
            hint="Accent / gold (optional), e.g. #a9853a"
            value={draft.seo.theme.accent ?? ''}
            onChange={(v) =>
              setDraft({
                ...draft,
                seo: { ...draft.seo, theme: { ...draft.seo.theme, accent: v || undefined } },
              })
            }
            maxLength={7}
            error={validation.errors['seo.theme.accent']}
          />
          <CmsTextField
            label="Accent light"
            hint="Accent light (optional), e.g. #dac56a"
            value={draft.seo.theme.accentLight ?? ''}
            onChange={(v) =>
              setDraft({
                ...draft,
                seo: { ...draft.seo, theme: { ...draft.seo.theme, accentLight: v || undefined } },
              })
            }
            maxLength={7}
            error={validation.errors['seo.theme.accentLight']}
          />
          <CmsTextField
            label="Brand deep"
            hint="Dark brand surface / footer (optional), e.g. #142b47"
            value={draft.seo.theme.brandDeep ?? ''}
            onChange={(v) =>
              setDraft({
                ...draft,
                seo: { ...draft.seo, theme: { ...draft.seo.theme, brandDeep: v || undefined } },
              })
            }
            maxLength={7}
            error={validation.errors['seo.theme.brandDeep']}
          />
          <h4 className={styles.cardIndex}>Per-page SEO overrides</h4>
          <p className={styles.qualLegend}>
            Optional title/description for each public page. Leave a page blank to inherit the
            site-wide values above.
          </p>
          {PAGE_SEO_KEYS.map(({ key, label }) => {
            const page = draft.seo.pages[key] ?? {};
            return (
              <div key={key} className={styles.fieldGroup}>
                <span className={styles.qualLegend}>{label}</span>
                <CmsTextField
                  label="Title override"
                  value={page.title ?? ''}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      seo: {
                        ...draft.seo,
                        pages: {
                          ...draft.seo.pages,
                          [key]: { ...(draft.seo.pages[key] ?? {}), title: v || undefined },
                        },
                      },
                    })
                  }
                  maxLength={60}
                  error={validation.errors[`seo.pages.${key}.title`]}
                />
                <CmsTextareaField
                  label="Description override"
                  value={page.description ?? ''}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      seo: {
                        ...draft.seo,
                        pages: {
                          ...draft.seo.pages,
                          [key]: { ...(draft.seo.pages[key] ?? {}), description: v || undefined },
                        },
                      },
                    })
                  }
                  maxLength={160}
                  rows={2}
                  error={validation.errors[`seo.pages.${key}.description`]}
                />
              </div>
            );
          })}
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

      {/* Delete contact confirm */}
      <ConfirmDialog
        open={deletingContactIdx !== null}
        onCancel={() => setDeletingContactIdx(null)}
        danger
        onConfirm={() => {
          if (deletingContactIdx === null) return;
          setDraft({
            ...draft,
            footer: {
              ...draft.footer,
              contacts: draft.footer.contacts.filter((_, i) => i !== deletingContactIdx),
            },
          });
          setDeletingContactIdx(null);
        }}
        title="Delete contact row?"
        message="This footer contact row will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Edit contact dialog */}
      {editingContact !== null && draft.footer.contacts[editingContact] && (
        <Dialog
          open
          onClose={() => {
            if (contactSnapshot && editingContact !== null) {
              const next = [...draft.footer.contacts];
              next[editingContact] = contactSnapshot;
              setDraft({ ...draft, footer: { ...draft.footer, contacts: next } });
            }
            setEditingContact(null);
            setContactSnapshot(null);
          }}
          title={contactSnapshot ? 'Edit Contact Row' : 'Add Contact Row'}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (contactSnapshot && editingContact !== null) {
                    const next = [...draft.footer.contacts];
                    next[editingContact] = contactSnapshot;
                    setDraft({ ...draft, footer: { ...draft.footer, contacts: next } });
                  }
                  setEditingContact(null);
                  setContactSnapshot(null);
                }}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingContact(null);
                  setContactSnapshot(null);
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
              label="Label"
              value={draft.footer.contacts[editingContact]!.label}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  footer: {
                    ...draft.footer,
                    contacts: draft.footer.contacts.map((c, i) =>
                      i === editingContact ? { ...c, label: v } : c,
                    ),
                  },
                })
              }
              maxLength={40}
              error={validation.errors[`footer.contacts.${editingContact}.label`]}
            />
            <CmsTextField
              label="Value"
              value={draft.footer.contacts[editingContact]!.value}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  footer: {
                    ...draft.footer,
                    contacts: draft.footer.contacts.map((c, i) =>
                      i === editingContact ? { ...c, value: v } : c,
                    ),
                  },
                })
              }
              maxLength={200}
              error={validation.errors[`footer.contacts.${editingContact}.value`]}
            />
          </div>
        </Dialog>
      )}
    </section>
  );
}
