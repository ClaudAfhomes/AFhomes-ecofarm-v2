import { Suspense, useEffect } from 'react';
import { MotionConfig } from 'motion/react';

import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoadingState } from './components/ui/Feedback';
import { Layout } from './components/layout/Layout';
import './marketing.css';
import { cmsRepository, hydrateCms } from './lib/cms';
import { startCmsPreview } from './lib/cms-preview';
import { themeStyle } from './lib/theme';
import { env } from '../lib/env';
import { useCmsRevision } from './hooks/useCmsRevision';

/**
 * Public marketing shell (Phase 3 port of the source public site).
 *
 * Everything inside `.afh-public` is styled by `marketing.css` (scoped
 * Tailwind reset + theme + utilities). The customer portal and its styles
 * are outside this wrapper by construction, so marketing CSS can never
 * restyle portal screens.
 *
 * Lazy pages render through the `<Outlet/>` inside `Layout`, covered by the
 * inner `Suspense` so each public route splits into its own chunk (and the
 * Tailwind/motion payload never loads for portal-only visits).
 */
export function MarketingLayout() {
  useCmsRevision();
  useEffect(() => {
    void hydrateCms();
  }, []);
  // Admin "Preview saved draft": only inside an iframe opened with ?cmsPreview=<session>.
  useEffect(() => {
    const session = new URLSearchParams(window.location.search).get('cmsPreview');
    if (!session || window.parent === window) return;
    const admin = new URL(env.VITE_ADMIN_URL, window.location.href).origin;
    return startCmsPreview([...new Set([admin, window.location.origin])], session);
  }, []);
  // A published CMS theme recolours the palette; no theme leaves the stylesheet as-is.
  const style = themeStyle((cmsRepository.getSiteConfig() as { theme?: unknown }).theme);
  return (
    <div className="afh-public" style={style}>
      <MotionConfig reducedMotion="user">
        <ErrorBoundary>
          <Suspense fallback={<LoadingState />}>
            <Layout />
          </Suspense>
        </ErrorBoundary>
      </MotionConfig>
    </div>
  );
}
