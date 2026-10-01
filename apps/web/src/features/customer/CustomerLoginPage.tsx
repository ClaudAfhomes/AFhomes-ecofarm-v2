import { HomeLoginSplit } from './HomeLoginSplit';

/**
 * Standalone member sign-in: the same homepage hero + login split as `/`,
 * without the marketing sections below. Sessions created here are ordinary
 * customer sessions; post-login routing (staff notice, dual chooser) lives
 * in the shared form.
 */
export function CustomerLoginPage() {
  return (
    <main>
      <HomeLoginSplit noIndex />
    </main>
  );
}
