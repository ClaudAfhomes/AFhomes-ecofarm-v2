import { useId } from 'react';
import { filterSections, type CmsSection } from './sections';
import styles from './cms.module.css';

/** Jump to a section of a long CMS form; open it if collapsed and focus its first field. */
function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const details = target.closest('details');
  if (details && !details.open) details.open = true;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  target
    .querySelector<HTMLElement>('input, textarea, select, button')
    ?.focus({ preventScroll: true });
}

export function CmsSectionNav({
  sections,
  query,
  onQuery,
}: {
  sections: CmsSection[];
  query: string;
  onQuery: (query: string) => void;
}) {
  const id = useId();
  const shown = filterSections(sections, query);
  return (
    <aside className={styles.sectionNav}>
      <label htmlFor={id} className={styles.sectionSearchLabel}>
        Find a field
      </label>
      <input
        id={id}
        type="search"
        className={styles.sectionSearch}
        placeholder="e.g. footer, phone, hero"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <nav aria-label="Sections">
        {shown.length ? (
          <ul>
            {shown.map((section) => (
              <li key={section.id}>
                <button type="button" onClick={() => jumpTo(section.id)}>
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>No field matches “{query.trim()}”.</p>
        )}
      </nav>
    </aside>
  );
}
