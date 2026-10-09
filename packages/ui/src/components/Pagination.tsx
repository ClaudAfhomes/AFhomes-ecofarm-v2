import { IconButton } from './IconButton';
import { Button } from './Button';
import styles from './Pagination.module.css';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label?: string;
  disabled?: boolean;
}

function buildPageWindow(page: number, pageCount: number): (number | 'ellipsis')[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = Array.from(wanted)
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  const out: (number | 'ellipsis')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('ellipsis');
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Paged navigation (API-SPECIFICATION §4 - page-based admin lists). Prev/Next
 * plus windowed page numbers with `aria-current="page"`; disabled at bounds.
 */
export function Pagination({
  page,
  pageCount,
  onChange,
  label = 'Pagination',
  disabled = false,
}: PaginationProps) {
  const pages = buildPageWindow(page, pageCount);
  const atFirst = page <= 1;
  const atLast = page >= pageCount;

  return (
    <nav className={styles.pagination} aria-label={label}>
      <span className={styles.stepWrap}>
        <IconButton
          icon="chevron-left"
          label="Previous page"
          disabled={disabled || atFirst}
          onClick={() => onChange(page - 1)}
        />
      </span>
      <ol className={styles.pages}>
        {pages.map((p, index) =>
          p === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} aria-hidden="true">
              <span className={styles.ellipsis}>…</span>
            </li>
          ) : (
            <li key={p}>
              <Button
                variant="ghost"
                type="button"
                className={`${styles.page} ${p === page ? styles.active : ''}`}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                disabled={disabled || p === page}
                onClick={() => onChange(p)}
              >
                {p}
              </Button>
            </li>
          ),
        )}
      </ol>
      <span className={styles.stepWrap}>
        <IconButton
          icon="chevron-right"
          label="Next page"
          disabled={disabled || atLast}
          onClick={() => onChange(page + 1)}
        />
      </span>
    </nav>
  );
}
