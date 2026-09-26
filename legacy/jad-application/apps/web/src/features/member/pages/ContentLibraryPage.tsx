import { useMemo, useState } from 'react';

import { Dialog, EmptyState, ErrorState, Icon, PageHeader, Skeleton } from '@jad/ui';
import type { ContentKind, ForwardableContent } from '@jad/contracts';

import { ButtonLink } from '@/components/ButtonLink';
import { useContentLibrary } from '../hooks/useMember';
import { contentKindLabel, formatDate } from '../lib/presentation';
import styles from './ContentLibraryPage.module.css';

type MarketingFilter = 'ALL' | 'FLYER' | 'IMAGE' | 'VIDEO' | 'BROCHURE';

const MARKETING_FILTERS: { value: MarketingFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'FLYER', label: 'Flyers' },
  { value: 'IMAGE', label: 'Images' },
  { value: 'VIDEO', label: 'Videos' },
  { value: 'BROCHURE', label: 'Brochures' },
];

const KIND_ICON: Record<ContentKind, 'file-text' | 'image' | 'video' | 'info'> = {
  DOCUMENT: 'file-text',
  IMAGE: 'image',
  VIDEO: 'video',
  PROMO: 'info',
};

function isPdfUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, 'http://mock.local');
    return u.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}

function decodeDataUrl(url?: string): string | null {
  if (!url || !url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  try {
    return decodeURIComponent(url.slice(comma + 1));
  } catch {
    return url.slice(comma + 1);
  }
}

interface CopyLinkButtonProps {
  url?: string;
}

/** Copies a server-provided share link; shows a transient confirmation. */
function CopyLinkButton({ url }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  if (!url) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" className={styles.linkButton} onClick={onCopy} aria-live="polite">
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

/**
 * Marketing Tools (SCR-MEM-022, FR-ADM-003). Admin-uploaded marketing assets
 * (BR-MKT-002) - posters, flyers, images, PDFs, and videos. Every item with a
 * downloadUrl is both viewable (View → Dialog) and downloadable (Download).
 * News/announcements live in Notifications, not here. All share/download URLs
 * are server-provided; external links use rel noopener. No raw HTML.
 */
export function ContentLibraryPage() {
  const contentQuery = useContentLibrary();
  const [filter, setFilter] = useState<MarketingFilter>('ALL');
  const [viewer, setViewer] = useState<ForwardableContent | null>(null);

  const items = contentQuery.data ?? [];
  const filtered = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'IMAGE') return items.filter((i) => i.kind === 'IMAGE');
    if (filter === 'VIDEO') return items.filter((i) => i.kind === 'VIDEO');
    if (filter === 'BROCHURE')
      return items.filter((i) => i.kind === 'DOCUMENT' && isPdfUrl(i.downloadUrl));
    if (filter === 'FLYER')
      return items.filter((i) => i.kind === 'DOCUMENT' && !isPdfUrl(i.downloadUrl));
    return items;
  }, [items, filter]);
  const total = items.length;
  const visibleCount = filtered.length;

  const filterLabel =
    filter === 'ALL' ? null : (MARKETING_FILTERS.find((f) => f.value === filter)?.label ?? filter);

  return (
    <section>
      <PageHeader
        title="Marketing Tools"
        description="Ready-to-share posters, flyers, images, PDFs, and videos - preview before you share or download."
        actions={
          <div className={styles.headerActions}>
            <ButtonLink to="/member/vouchers" variant="secondary">
              View Vouchers
            </ButtonLink>
          </div>
        }
      />

      <p className={styles.timeframe}>Featured · Download-ready</p>

      <div className={styles.filters} role="group" aria-label="Filter by category">
        {MARKETING_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? styles.filterActive : styles.filter}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className={styles.count} aria-live="polite">
        {contentQuery.isLoading
          ? 'Loading materials…'
          : `Showing ${visibleCount} of ${total} ${total === 1 ? 'item' : 'items'}${filterLabel ? ` · ${filterLabel}` : ''}`}
      </p>

      {contentQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : contentQuery.isError ? (
        <ErrorState
          error={contentQuery.error}
          title="Could not load marketing tools"
          onRetry={() => void contentQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No marketing tools yet"
          description="Approved JA&D marketing materials will appear here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`No ${filterLabel?.toLowerCase() ?? 'materials'} match this filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((item) => {
            const isViewable = Boolean(item.downloadUrl);
            const isImage = item.kind === 'IMAGE' && Boolean(item.downloadUrl);
            const isVideo = item.kind === 'VIDEO' && Boolean(item.downloadUrl);
            const isPdf = isPdfUrl(item.downloadUrl);

            return (
              <li key={item.id} className={styles.card}>
                <div className={styles.coverWrap}>
                  {isImage ? (
                    <img
                      src={item.downloadUrl}
                      alt=""
                      aria-hidden="true"
                      className={styles.cover}
                    />
                  ) : isVideo ? (
                    <div className={styles.coverVideo}>
                      <img
                        src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&h=450&fit=crop&auto=format"
                        alt=""
                        aria-hidden="true"
                        className={styles.cover}
                      />
                      <span className={styles.playBadge} aria-hidden="true">
                        <Icon name="video" size={18} />
                      </span>
                    </div>
                  ) : isPdf ? (
                    <div className={styles.coverPdf}>
                      <Icon name="file-text" size={28} aria-hidden="true" />
                      <span className={styles.coverLabel}>PDF</span>
                    </div>
                  ) : (
                    <div className={styles.coverDoc}>
                      <Icon name="file-text" size={28} aria-hidden="true" />
                      <span className={styles.coverLabel}>DOC</span>
                    </div>
                  )}
                  <span className={styles.coverBadge}>{contentKindLabel(item.kind)}</span>
                </div>

                <div className={styles.cardMain}>
                  <span className={styles.kind}>
                    <Icon
                      name={KIND_ICON[item.kind]}
                      size={14}
                      className={styles.kindIcon}
                      aria-hidden="true"
                    />
                    {contentKindLabel(item.kind)}
                  </span>
                  <span className={styles.title}>{item.title}</span>
                  {item.description ? (
                    <span className={styles.description}>{item.description}</span>
                  ) : null}
                  <span className={styles.meta}>Published {formatDate(item.createdAt)}</span>
                </div>
                <div className={styles.actions}>
                  {isViewable ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setViewer(item)}
                    >
                      View
                    </button>
                  ) : null}
                  {item.downloadUrl ? (
                    <a
                      className={styles.linkButton}
                      href={item.downloadUrl}
                      download={item.title}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  ) : null}
                  {item.share?.messengerUrl ? (
                    <a
                      className={styles.linkButton}
                      href={item.share.messengerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Share on Messenger
                    </a>
                  ) : null}
                  {item.share?.viberUrl ? (
                    <a
                      className={styles.linkButton}
                      href={item.share.viberUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Share on Viber
                    </a>
                  ) : null}
                  <CopyLinkButton url={item.share?.copyUrl} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.note}>Materials are for approved member use only.</p>

      <Dialog
        open={Boolean(viewer)}
        onClose={() => setViewer(null)}
        title={viewer ? `Preview: ${viewer.title}` : 'Preview'}
        footer={
          viewer?.downloadUrl ? (
            <a
              className={styles.linkButton}
              href={viewer.downloadUrl}
              download={viewer.title}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </a>
          ) : undefined
        }
      >
        {viewer ? (
          <div className={styles.viewerBody}>
            {viewer.kind === 'IMAGE' && viewer.downloadUrl ? (
              <img src={viewer.downloadUrl} alt={viewer.title} className={styles.viewerImage} />
            ) : viewer.kind === 'VIDEO' && viewer.downloadUrl ? (
              <video
                controls
                autoPlay
                src={viewer.downloadUrl}
                className={styles.viewerMedia}
                aria-label={viewer.title}
              />
            ) : isPdfUrl(viewer.downloadUrl) ? (
              <iframe src={viewer.downloadUrl} title={viewer.title} className={styles.viewerPdf} />
            ) : viewer.downloadUrl?.startsWith('data:') ? (
              <pre className={styles.viewerText}>{decodeDataUrl(viewer.downloadUrl) ?? ''}</pre>
            ) : viewer.downloadUrl ? (
              <iframe src={viewer.downloadUrl} title={viewer.title} className={styles.viewerPdf} />
            ) : null}
            {viewer.description ? (
              <p className={styles.viewerDescription}>{viewer.description}</p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
