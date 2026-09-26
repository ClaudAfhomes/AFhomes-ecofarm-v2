import {
  aboutContentSchema,
  contactContentSchema,
  faqContentSchema,
  globalContentSchema,
  homepageContentSchema,
  loginContentSchema,
  propertiesContentSchema,
  registerContentSchema,
} from '@jad/contracts';
import { ABOUT } from '../features/public/content/about';
import { CONTACT } from '../features/public/content/contact';
import { FAQS } from '../features/public/content/faqs';
import { HOME } from '../features/public/content/home';
import { PROPERTIES } from '../features/public/content/properties';
import { SITE } from '../features/public/content/site';
import { AUTH } from '../features/auth/content';
import type {
  AboutContent,
  ContactContent,
  FaqContent,
  GlobalContent,
  HomepageContent,
  LoginContent,
  PropertiesContent,
  RegisterContent,
} from '@jad/contracts';
import { request } from './api/client';

// Public CMS fetchers with static fallback per Q6.
// If API is unavailable or returns 404, the static site content is used so marketing pages never blank.

export async function getHomepageCms(): Promise<HomepageContent> {
  try {
    return await request('/cms/homepage', homepageContentSchema);
  } catch {
    return HOME as unknown as HomepageContent;
  }
}

export async function getAboutCms(): Promise<AboutContent> {
  try {
    return await request('/cms/about', aboutContentSchema);
  } catch {
    return ABOUT as unknown as AboutContent;
  }
}

export async function getPropertiesCmsPublic(): Promise<PropertiesContent> {
  try {
    return await request('/cms/properties', propertiesContentSchema);
  } catch {
    return PROPERTIES as unknown as PropertiesContent;
  }
}

export async function getFaqsCmsPublic(): Promise<FaqContent> {
  try {
    return await request('/cms/faqs', faqContentSchema);
  } catch {
    return FAQS as unknown as FaqContent;
  }
}

export async function getContactCmsPublic(): Promise<ContactContent> {
  try {
    return await request('/cms/contact', contactContentSchema);
  } catch {
    return CONTACT as unknown as ContactContent;
  }
}

export async function getGlobalCmsPublic(): Promise<GlobalContent> {
  // Global fallback is SITE + static; we construct a minimal GlobalContent from SITE if API fails
  try {
    return await request('/cms/global', globalContentSchema);
  } catch {
    // Fallback: build from SITE statics - mirrors MOCK_GLOBAL_SEED
    return {
      brand: {
        name: SITE.name,
        shortName: SITE.shortName,
        tagline: SITE.tagline,
        positioningLine: SITE.positioning.line,
      },
      logo: { id: '/ja-d-logo.png', alt: 'JA&D Realty Services' },
      brandMark: { id: '/ja-d-auth-logo.png', alt: 'JA&D Realty Services (white)' },
      browserIcon: { id: '/ja-d-favicon.png', alt: 'JA&D Realty Services favicon' },
      nav: SITE.nav,
      authNav: SITE.auth,
      footer: {
        brandLine: SITE.footer.brandLine,
        exploreHeading: 'Explore',
        contactHeading: 'Reach us directly',
        contacts: CONTACT.details.map((d) => ({ label: d.label, value: d.value })),
        bottomBar: { legalSuffix: 'All rights reserved.', showTagline: true },
      },
      messenger: {
        url: 'https://m.me/JADRealtyServices',
        label: "Let's Talk",
        ariaLabel: 'Message us on Messenger',
        hideOnAuth: true,
      },
      seo: {
        title: 'JA&D Realty Services',
        description: SITE.tagline,
        theme: {
          primary: '#2c6aa7',
          secondary: '#3477b8',
          accent: '#a9853a',
          accentLight: '#dac56a',
          brandDeep: '#142b47',
        },
        pages: {},
      },
    } as GlobalContent;
  }
}

export async function getLoginCmsPublic(): Promise<LoginContent> {
  try {
    return await request('/cms/login', loginContentSchema);
  } catch {
    // Fallback to AUTH.login shape adapted to LoginContent
    return {
      image: AUTH.images.login,
      copy: {
        eyebrow: AUTH.login.eyebrow,
        title: AUTH.login.title,
        lead: AUTH.login.lead,
        brandTitle: AUTH.login.brandTitle,
        brandLead: AUTH.login.brandLead,
      },
      fields: {
        identifier: {
          label: AUTH.login.fields.identifier.label,
          hint: AUTH.login.fields.identifier.hint,
        },
        password: { label: AUTH.login.fields.password.label },
      },
      submitLabel: AUTH.login.submitLabel,
      forgotPassword: { label: AUTH.login.forgotPassword.label },
      registerPrompt: {
        text: AUTH.login.registerPrompt.text,
        linkLabel: AUTH.login.registerPrompt.linkLabel,
      },
    } as LoginContent;
  }
}

export async function getRegisterCmsPublic(): Promise<RegisterContent> {
  try {
    return await request('/cms/register', registerContentSchema);
  } catch {
    // Fallback - shape matches MOCK_REGISTER_SEED minimal; keeps public functional without API
    return {
      image: AUTH.images.register,
      copy: {
        eyebrow: AUTH.register.eyebrow,
        title: AUTH.register.title,
        lead: AUTH.register.lead,
        brandTitle: AUTH.register.brandTitle,
        brandLead: AUTH.register.brandLead,
      },
      stepTitles: {
        programProfile: 'Program & profile',
        qualification: 'Qualification',
        referral: 'Referral code',
        governmentId: 'Government ID',
        account: 'Account',
      },
      fields: {
        programId: { label: 'Program' },
        firstName: { label: 'First name' },
        middleInitial: { label: 'Middle initial' },
        lastName: { label: 'Last name' },
        nameSuffix: { label: 'Name suffix' },
        dateOfBirth: { label: 'Date of birth' },
        gender: { label: 'Gender' },
        countryCode: { label: 'Country' },
        address: { label: 'Address' },
        phone: { label: 'Phone number' },
        email: { label: 'Email address' },
        password: { label: 'Password', hint: 'At least 8 characters.' },
        confirmPassword: { label: 'Confirm password' },
        referralCode: { label: 'Sponsor / referral code' },
        idDocument: { label: 'Government ID' },
        consent: { label: AUTH.register.fields.consent.label },
      },
      qualification: { domestic: [], abroad: [] },
      submitLabel: AUTH.register.submitLabel,
      loginPrompt: {
        text: AUTH.register.loginPrompt.text,
        linkLabel: AUTH.register.loginPrompt.linkLabel,
      },
      verifyEmail: {
        eyebrow: AUTH.verifyEmail.eyebrow,
        title: AUTH.verifyEmail.title,
        lead: AUTH.verifyEmail.lead,
        brandTitle: AUTH.verifyEmail.brandTitle,
        brandLead: AUTH.verifyEmail.brandLead,
      },
      status: {
        eyebrow: AUTH.status.eyebrow,
        title: AUTH.status.title,
        lead: AUTH.status.pending.message,
        brandTitle: AUTH.status.brandTitle,
        brandLead: AUTH.status.brandLead,
      },
    } as RegisterContent;
  }
}
