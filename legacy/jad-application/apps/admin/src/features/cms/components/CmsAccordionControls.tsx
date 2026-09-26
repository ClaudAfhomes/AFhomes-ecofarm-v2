import { Button, Icon } from '@jad/ui';

import styles from '../pages/CmsHomepagePage.module.css';

export function CmsAccordionControls({
  sectionCount,
  expandAll,
  collapseAll,
}: {
  sectionCount: number;
  expandAll: () => void;
  collapseAll: () => void;
}) {
  return (
    <div className={styles.anchorActions}>
      <Button variant="ghost" onClick={expandAll} aria-label="Expand all sections">
        <Icon name="chevron-down" size={16} /> Expand all ({sectionCount})
      </Button>
      <Button variant="ghost" onClick={collapseAll} aria-label="Collapse all sections">
        <Icon name="chevron-right" size={16} /> Collapse all
      </Button>
    </div>
  );
}
