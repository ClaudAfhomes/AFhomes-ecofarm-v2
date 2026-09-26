import { useCallback, useState } from 'react';

export type CmsAccordionSection = { id: string; label: string };

export function useCmsAccordion(sections: readonly CmsAccordionSection[]) {
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (sections.some((s) => s.id === hash)) return hash;
    }
    return sections[0]?.id ?? null;
  });

  const toggle = useCallback((id: string) => setOpenId((prev) => (prev === id ? null : id)), []);

  const open = useCallback((id: string) => setOpenId(id), []);

  const expandAll = useCallback(() => setOpenId('__all__'), []);

  const collapseAll = useCallback(() => setOpenId(null), []);

  const isOpen = useCallback((id: string) => openId === '__all__' || openId === id, [openId]);

  return { openId, toggle, open, expandAll, collapseAll, isOpen };
}
