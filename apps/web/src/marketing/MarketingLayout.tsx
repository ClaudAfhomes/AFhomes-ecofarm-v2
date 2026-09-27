import { Suspense } from 'react';
import { MotionConfig } from 'motion/react';

import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoadingState } from './components/ui/Feedback';
import { Layout } from './components/layout/Layout';
import './marketing.css';

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
  return (
    <div className="afh-public">
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
