import { useEffect, useRef, useState } from 'react';

export function useCmsUnsaved(dirty: boolean) {
  const [pending, setPending] = useState<HTMLAnchorElement | null>(null);
  const confirmed = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeLink = (event: MouseEvent) => {
      if (
        confirmed.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self'))
        return;
      const url = new URL(link.href);
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPending(link);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeLink, true);
    };
  }, [dirty]);
  return {
    open: dirty && pending !== null,
    onCancel: () => setPending(null),
    onConfirm: () => {
      setPending(null);
      confirmed.current = true;
      try {
        if (pending?.isConnected) pending.click();
      } finally {
        confirmed.current = false;
      }
    },
  };
}
