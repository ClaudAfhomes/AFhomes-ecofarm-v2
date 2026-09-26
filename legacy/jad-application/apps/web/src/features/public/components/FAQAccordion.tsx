import { useId, useState } from 'react';

import type { FaqItem } from '../content';
import styles from './FAQAccordion.module.css';

export interface FAQAccordionProps {
  items: FaqItem[];
}

/**
 * Accessible accordion (WAI-ARIA disclosure pattern): each question is a real
 * `<button>` with `aria-expanded` / `aria-controls` pointing at a `region`
 * labelled by the button. Panels stay in the DOM and animate open/closed via
 * the grid-rows technique; `inert` keeps collapsed content out of tab order
 * and out of screen-reader output. Multiple items may be open at once.
 */
export function FAQAccordion({ items }: FAQAccordionProps) {
  const baseId = useId();

  return (
    <div className={styles.accordion}>
      {items.map((item, index) => {
        const triggerId = `${baseId}-trigger-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <FaqAccordionItem
            key={item.question}
            item={item}
            triggerId={triggerId}
            panelId={panelId}
          />
        );
      })}
    </div>
  );
}

function FaqAccordionItem({
  item,
  triggerId,
  panelId,
}: {
  item: FaqItem;
  triggerId: string;
  panelId: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);

  return (
    <div className={`${styles.item} ${open ? styles.itemOpen : ''}`}>
      <h3 className={styles.heading}>
        <button
          type="button"
          id={triggerId}
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span>{item.question}</span>
          <span className={`${styles.icon} ${open ? styles.iconOpen : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
        inert={!open}
      >
        <div className={styles.panelInner}>
          <div className={styles.answer}>
            <p>{item.answer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
