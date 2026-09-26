import { LOGO, photoUrl } from '../public/content';
import type { Photo, ProcessStep } from '../public/content/types';

/**
 * Member auth content (SCR-AUTH-001 Login / SCR-AUTH-002 Registration).
 *
 * Copy stays within documented requirements: no earnings, approval, or
 * qualification promises. Passwords require at least 8 characters.
 */
export const AUTH = {
  /** Routes (registered in app/App.tsx). */
  loginPath: '/login',
  registerPath: '/register',
  forgotPasswordPath: '/auth/forgot-password',
  resetPasswordPath: '/auth/reset-password',
  /** Contact route - the documented public channel for support requests. */
  supportPath: '/contact',
  /** Brand images for the editorial split panels (centralized Unsplash catalog). */
  images: {
    login: {
      id: 'photo-1613490493576-7fde63acd811',
      alt: 'A contemporary villa exterior at golden hour',
    } satisfies Photo,
    register: {
      id: 'photo-1560448204-e02f11c3d0e2',
      alt: 'A bright apartment interior with modern finishes',
    } satisfies Photo,
  },
  login: {
    eyebrow: 'Member login',
    title: 'Welcome back',
    lead: 'Access your JA&D member account.',
    brandTitle: 'Where Big Dreams meet property that already earns',
    brandLead:
      'Sign in to manage your membership, property interests, and account details - in one secure place.',
    fields: {
      identifier: {
        label: 'Email or phone number',
        hint: 'Use the email address or phone number you registered with.',
        autocomplete: 'username',
      },
      password: { label: 'Password', autocomplete: 'current-password' },
    },
    submitLabel: 'Sign In',
    forgotPassword: {
      label: 'Forgot password?',
      to: '/auth/forgot-password',
    },
    registerPrompt: {
      text: "Don't have a JA&D account yet?",
      linkLabel: 'Create your account',
      to: '/register',
    },
    /** Generic authentication failure notice. */
    unavailable: {
      title: 'We could not sign you in',
      message:
        'Check your email or phone number and password, then try again. If the problem continues, contact support.',
    },
    /** Successful-authentication transition. */
    success: {
      title: 'Welcome back',
      message: 'You are signed in. Taking you to your member dashboard.',
    },
  },
  register: {
    eyebrow: 'Member registration',
    title: 'Join JA&D',
    lead: 'Create your member account and begin your journey with JA&D.',
    brandTitle: 'Begin your journey with JA&D',
    brandLead:
      'Membership has no purchase requirement. Registration is free and open - approval follows verification and review.',
    fields: {
      firstName: { label: 'First name', autocomplete: 'given-name' },
      lastName: { label: 'Last name', autocomplete: 'family-name' },
      email: { label: 'Email address', autocomplete: 'email' },
      phone: { label: 'Phone number', autocomplete: 'tel' },
      password: {
        label: 'Password',
        hint: 'At least 8 characters.',
        autocomplete: 'new-password',
      },
      confirmPassword: { label: 'Confirm password', autocomplete: 'new-password' },
      referralCode: {
        label: 'Sponsor / referral code',
        hint: 'Optional - leave blank if you were not referred by a member.',
        autocomplete: 'off',
      },
      consent: {
        label: 'I agree to the JA&D member terms and privacy policy.',
        error: 'Please accept the member terms and privacy policy to continue.',
      },
    },
    submitLabel: 'Create My Account',
    loginPrompt: {
      text: 'Already have a JA&D account?',
      linkLabel: 'Sign in',
      to: '/login',
    },
    /**
     * Expected process after registration, per the approved model:
     * application → Pending → email verified + JA&D review → active
     * (FEAT-007/009/011, BR-AUTH-001/002, BR-REG-007).
     */
    steps: [
      {
        title: 'Apply',
        body: 'Submit your member details - no purchase required.',
      },
      {
        title: 'Verify & review',
        body: 'Confirm your email; JA&D reviews your application.',
      },
      {
        title: 'Account active',
        body: 'Approved members get access to the member portal.',
      },
    ] satisfies ProcessStep[],
    /**
     * Pending/review state, shown after a submitted application.
     */
    pending: {
      title: 'Application under review',
      message:
        'Your application has been received. We will email you once verification and review are complete and your account becomes active.',
    },
    /** Generic registration error notice. */
    error: {
      title: 'We could not complete your registration',
      message: 'Please try again shortly, or contact us for assistance.',
    },
  },
  /** Email verification (SCR-AUTH-003, FEAT-009) - a one-time code verifies ownership (BR-AUTH-001). */
  verifyEmail: {
    eyebrow: 'Verify your email',
    title: 'Check your email',
    lead: 'We sent a one-time verification code to your email address.',
    brandTitle: 'Verification keeps your account secure',
    brandLead:
      'Confirm that the email address belongs to you. JA&D reviews your application after your email is verified.',
    fields: {
      email: { label: 'Email address', autocomplete: 'email' },
      code: { label: 'Verification code', hint: 'Enter the 6-digit code from the email.' },
    },
    submitLabel: 'Verify Email',
    resendLabel: 'Resend code',
    resendingLabel: 'Resending\u2026',
    codeSent: 'A new code was sent to your email address.',
  },
  /** Application status after verification (SCR-AUTH-004) - `Pending` review by JA&D. */
  status: {
    eyebrow: 'Application received',
    title: 'Application received',
    brandTitle: 'You\u2019re one step closer',
    brandLead:
      'Your application is being reviewed. There is no purchase requirement and no cost to apply.',
    pending: {
      title: 'Application under review',
      message:
        'Your application is now Pending. JA&D reviews each application after the email is verified. When a decision is made, you will be able to sign in and see your status.',
    },
    steps: [
      { title: 'Application received', body: 'Your details were submitted and are on file.' },
      { title: 'Email verified', body: 'Confirm your email to prove the address belongs to you.' },
      { title: 'JA&D review', body: 'JA&D reviews your application before approval.' },
    ],
    signInLabel: 'Sign in',
  },
  /** Forgot-password (password recovery via Supabase Auth email link). */
  forgotPasswordPage: {
    eyebrow: 'Reset your password',
    title: 'Forgot your password?',
    lead: "Enter the email address you registered with and we'll send you a link to set a new password.",
    brandTitle: 'Account recovery keeps your membership safe',
    brandLead: 'We will email a secure reset link to the address on your account.',
    fields: {
      email: { label: 'Email address', autocomplete: 'email' },
    },
    submitLabel: 'Send reset link',
    successTitle: 'Check your email',
    successMessage:
      'If an account exists for that address, a password reset link is on its way. Follow it to choose a new password.',
    backLabel: 'Back to login',
  },
  /** Reset-password - lands from the Supabase recovery link with a session. */
  resetPasswordPage: {
    eyebrow: 'Set a new password',
    title: 'Choose a new password',
    lead: 'Enter a new password for your account.',
    brandTitle: 'Your password keeps your membership secure',
    brandLead: 'Use at least 8 characters - a mix of letters and numbers is best.',
    fields: {
      password: {
        label: 'New password',
        hint: 'At least 8 characters.',
        autocomplete: 'new-password',
      },
      confirmPassword: { label: 'Confirm new password', autocomplete: 'new-password' },
    },
    submitLabel: 'Update password',
    successTitle: 'Password updated',
    successMessage: 'Your password has been changed. You can now sign in with it.',
    backLabel: 'Back to login',
    invalidTitle: 'Link invalid or expired',
    invalidMessage:
      'This password reset link is invalid or has expired. Request a new one from the login screen.',
  },
};

/** Web-optimized image URL for the auth brand panels. */
export function authPhoto(photo: Photo, width = 1400): string {
  return photoUrl(photo.id, width);
}

/** White JA&D logo (renders on dark brand surfaces only). */
export const AUTH_LOGO = LOGO;

/** True when `pathname` is a member auth screen (Login/Register/Verify/Status/Recovery). */
export function isAuthPath(pathname: string): boolean {
  return (
    pathname === AUTH.loginPath ||
    pathname === AUTH.registerPath ||
    pathname === AUTH.forgotPasswordPath ||
    pathname === AUTH.resetPasswordPath ||
    pathname === '/register/verify-email' ||
    pathname === '/register/status' ||
    pathname.startsWith('/register/verify-email') ||
    pathname.startsWith('/register/status')
  );
}
