import { CustomerLoginScreen } from './CustomerLoginScreen';

/**
 * Standalone member sign-in: the shared `AuthLayout` shell (same layout as
 * the staff and admin entries) outside the marketing shell. Sessions created
 * here are ordinary customer sessions; post-login routing (staff notice, dual
 * chooser) lives in the shared form.
 */
export function CustomerLoginPage() {
  // The `main` landmark for the screen (`AuthLayout` renders plain divs).
  return (
    <main>
      <CustomerLoginScreen />
    </main>
  );
}
