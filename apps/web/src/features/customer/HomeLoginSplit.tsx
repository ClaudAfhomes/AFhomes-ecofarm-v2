import { Button } from '@jad/ui';
import { Suspense, lazy, useEffect } from 'react';
import { useLocation } from 'react-router';

import { CmsHeroMedia } from '../../marketing/components/ui/CmsHeroMedia';
import { Container } from '../../marketing/components/ui/Container';
import { getPlaceholder } from '../../marketing/lib/images';
import { cmsRepository } from '../../marketing/lib/cms';
import { useCustomerSession } from '../../lib/customer-session';
import { useQuery } from '@tanstack/react-query';
import { getAuthPortals } from '../../lib/portals';
import { portalDashboard } from '../../lib/portal-destination';
import { PortalRedirect } from '../../lib/PortalRedirect';

const CustomerLoginForm = lazy(() =>
  import('./CustomerLoginForm').then((module) => ({ default: module.CustomerLoginForm })),
);

/**
 * Homepage hero + member login split.
 *
 * The root URL stays a homepage: the same CMS hero copy and imagery as the
 * marketing hero on the left, the member sign-in on the right, and the rest
 * of the homepage sections below (rendered by the caller). Copy comes from
 * the same repository as `Hero`, so marketing edits flow through with no
 * second definition to drift.
 *
 * The form is route-split away from the marketing chunk: visitors who never
 * scroll to it never download the portal API code.
 */
export function HomeLoginSplit({ noIndex = false }: { noIndex?: boolean }) {
  const content = cmsRepository.getPageContent().home;
  const titleParts = content.heroTitle.split(/(?<=\.)\s+/, 2);
  const heroImage = getPlaceholder('resort-valley');
  const { status, signOut } = useCustomerSession();

  useEffect(() => {
    if (!noIndex) return;
    const head = document.head;
    let element = head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !element;
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute('name', 'robots');
      head.appendChild(element);
    }
    const previous = element.getAttribute('content');
    element.setAttribute('content', 'noindex, nofollow');
    return () => {
      if (created) element?.remove();
      else if (previous !== null) element?.setAttribute('content', previous);
    };
  }, [noIndex]);

  return (
    <section className="relative overflow-hidden bg-pine-950" aria-label="AF Homes homepage">
      <div className="absolute inset-0" aria-hidden="true">
        <CmsHeroMedia fallback={heroImage} />
      </div>
      <div className="relative z-10">
        <Container className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:py-24">
          <div>
            <p className="label-caps flex items-center gap-3 text-cream-200/80">
              <span className="h-px w-10 bg-leaf-400" aria-hidden="true" />
              {content.heroBadge}
            </p>
            <h1 className="mt-8">
              <span className="font-display block text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.95] font-medium text-cream-50 text-balance">
                {titleParts[0] ?? ''}
              </span>
              <span className="font-display mt-4 block text-[clamp(1.75rem,4vw,3.5rem)] leading-[1.05] font-light text-cream-100 text-balance">
                {titleParts[1] ?? ''}
              </span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-cream-200/85 text-pretty sm:text-xl">
              {content.heroLede}
            </p>
          </div>
          <div
            className="rounded-2xl bg-cream-50 p-6 shadow-2xl sm:p-8"
            aria-label="Member sign in"
          >
            {status === 'authenticated' ? (
              <SignedInPanel onSignOut={() => void signOut()} />
            ) : (
              <>
                <p className="label-caps text-pine-950/70">Member Login</p>
                <h2 className="font-display mt-2 text-3xl font-medium text-pine-950">
                  Sign in to your card
                </h2>
                <div className="mt-4">
                  <Suspense
                    fallback={
                      <p role="status" className="text-pine-950/70">
                        Loading sign in…
                      </p>
                    }
                  >
                    <CustomerLoginForm />
                  </Suspense>
                </div>
              </>
            )}
          </div>
        </Container>
      </div>
    </section>
  );
}

function SignedInPanel({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const { user } = useCustomerSession();
  const identity = useQuery({
    queryKey: ['auth-portals', user?.authUserId],
    queryFn: getAuthPortals,
    retry: false,
    staleTime: 0,
  });
  const to = identity.data ? portalDashboard(identity.data) : null;
  if (location.pathname === '/customer/login' && to) return <PortalRedirect to={to} />;
  return (
    <div>
      <p className="label-caps text-pine-950/70">Member Login</p>
      <h2 className="font-display mt-2 text-3xl font-medium text-pine-950">You are signed in</h2>
      <p className="mt-4 text-pine-950/80">
        {to ? (
          <a href={to} className="font-semibold underline">
            Go to your dashboard
          </a>
        ) : (
          <span role="status">
            {identity.isError
              ? 'Could not verify your account. Reload to retry.'
              : 'Checking your account…'}
          </span>
        )}
      </p>
      <p className="mt-2">
        <Button variant="ghost" type="button" onClick={onSignOut} className="">
          Sign out
        </Button>
      </p>
    </div>
  );
}
