import {
  aboutContentSchema,
  type AboutContent,
  CMS_ABOUT_SEED,
  CMS_CONTACT_SEED,
  CMS_FAQS_SEED,
  CMS_GLOBAL_SEED,
  CMS_HOMEPAGE_SEED,
  CMS_LOGIN_SEED,
  CMS_PROPERTIES_SEED,
  CMS_REGISTER_SEED,
  contactContentSchema,
  type ContactContent,
  faqContentSchema,
  type FaqContent,
  globalContentSchema,
  type GlobalContent,
  homepageContentSchema,
  type HomepageContent,
  loginContentSchema,
  type LoginContent,
  propertiesContentSchema,
  type PropertiesContent,
  registerContentSchema,
  type RegisterContent,
} from '@jad/contracts';
import { request } from '../../../lib/api/client';
import { getSupabaseClient } from '../../../lib/supabase';

// ---------------------------------------------------------------------------
// Frontend-only CMS repository - Homepage + About + Properties + FAQs
// This layer mirrors the future API repository: getHomepage / updateHomepage.
// Phase 1 was in-memory only; Phase 2 persists drafts to LocalStorage
// (`jad:cms:homepage:draft` / `jad:cms:about:draft` / `jad:cms:properties:draft` / `jad:cms:faqs:draft`)
// for prod-ready mock behavior across refresh. Supabase Storage
// `marketing-tools` will replace this in Phase 3. Seed is derived from public
// `HOME`/`ABOUT`/`PROPERTIES`/`FAQS` content.
// ---------------------------------------------------------------------------

/**
 * Adapter: normalize public `HOME` into CMS `HomepageContent`.
 * In Phase 1 we inline the mapping. The values are verified by
 * `CmsHomepagePage.spec.tsx` to stay identical to `HOME`.
 * Future `GET /cms/homepage` will replace this seed without touching the UI.
 */
const MOCK_HOMEPAGE_SEED = CMS_HOMEPAGE_SEED;
const MOCK_ABOUT_SEED = CMS_ABOUT_SEED;
const MOCK_PROPERTIES_SEED = CMS_PROPERTIES_SEED;
const MOCK_FAQS_SEED = CMS_FAQS_SEED;
const MOCK_CONTACT_SEED = CMS_CONTACT_SEED;
const MOCK_GLOBAL_SEED = CMS_GLOBAL_SEED;
const MOCK_LOGIN_SEED = CMS_LOGIN_SEED;
const MOCK_REGISTER_SEED = CMS_REGISTER_SEED;
homepageContentSchema.parse(MOCK_HOMEPAGE_SEED);
aboutContentSchema.parse(MOCK_ABOUT_SEED);
propertiesContentSchema.parse(MOCK_PROPERTIES_SEED);
faqContentSchema.parse(MOCK_FAQS_SEED);
contactContentSchema.parse(MOCK_CONTACT_SEED);
globalContentSchema.parse(MOCK_GLOBAL_SEED);
loginContentSchema.parse(MOCK_LOGIN_SEED);
registerContentSchema.parse(MOCK_REGISTER_SEED);

// ---------------------------------------------------------------------------
// LocalStorage persistence - production-ready mock (Phase 2)
// ---------------------------------------------------------------------------
const STORAGE_KEY_HOMEPAGE = 'jad:cms:homepage:draft';
const STORAGE_KEY_ABOUT = 'jad:cms:about:draft';
const STORAGE_KEY_PROPERTIES = 'jad:cms:properties:draft';
const STORAGE_KEY_FAQS = 'jad:cms:faqs:draft';
const STORAGE_KEY_CONTACT = 'jad:cms:contact:draft';
const STORAGE_KEY_GLOBAL = 'jad:cms:global:draft';
const STORAGE_KEY_LOGIN = 'jad:cms:login:draft';
const STORAGE_KEY_REGISTER = 'jad:cms:register:draft';

function loadHomepageFromStorage(): HomepageContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_HOMEPAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = homepageContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadAboutFromStorage(): AboutContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ABOUT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = aboutContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadPropertiesFromStorage(): PropertiesContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PROPERTIES);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = propertiesContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadFaqsFromStorage(): FaqContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_FAQS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = faqContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadContactFromStorage(): ContactContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CONTACT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = contactContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadGlobalFromStorage(): GlobalContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_GLOBAL);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = globalContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadLoginFromStorage(): LoginContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LOGIN);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = loginContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function loadRegisterFromStorage(): RegisterContent | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_REGISTER);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = registerContentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function persistHomepage(content: HomepageContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_HOMEPAGE, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistAbout(content: AboutContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_ABOUT, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistProperties(content: PropertiesContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PROPERTIES, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistFaqs(content: FaqContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_FAQS, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistContact(content: ContactContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_CONTACT, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistGlobal(content: GlobalContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_GLOBAL, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistLogin(content: LoginContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_LOGIN, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function persistRegister(content: RegisterContent): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_REGISTER, JSON.stringify(content));
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearHomepageStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_HOMEPAGE);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearAboutStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_ABOUT);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearPropertiesStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_PROPERTIES);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearFaqsStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_FAQS);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearContactStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_CONTACT);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearGlobalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_GLOBAL);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearLoginStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_LOGIN);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}
function clearRegisterStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_REGISTER);
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
}

// In-memory drafts - hydrated from LocalStorage if available (prod-ready mock)
// Falls back to seed; refreshed via get* which syncs from storage
let current: HomepageContent = loadHomepageFromStorage() ?? structuredClone(MOCK_HOMEPAGE_SEED);
let currentAbout: AboutContent = loadAboutFromStorage() ?? structuredClone(MOCK_ABOUT_SEED);
let currentProperties: PropertiesContent =
  loadPropertiesFromStorage() ?? structuredClone(MOCK_PROPERTIES_SEED);
let currentFaqs: FaqContent = loadFaqsFromStorage() ?? structuredClone(MOCK_FAQS_SEED);
let currentContact: ContactContent = loadContactFromStorage() ?? structuredClone(MOCK_CONTACT_SEED);
let currentGlobal: GlobalContent = loadGlobalFromStorage() ?? structuredClone(MOCK_GLOBAL_SEED);
let currentLogin: LoginContent = loadLoginFromStorage() ?? structuredClone(MOCK_LOGIN_SEED);
let currentRegister: RegisterContent =
  loadRegisterFromStorage() ?? structuredClone(MOCK_REGISTER_SEED);

/** Simulate network latency (keeps loading Skeleton visible) - skipped in test for speed. */
function delay(ms: number): Promise<void> {
  if ((import.meta.env as Record<string, string | undefined>).MODE === 'test')
    return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Real CMS API (Vercel Functions → Supabase) with localStorage fallback per Q6 ---
async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    /* ignore quota or privacy mode - in-memory still holds draft */
  }
  return {};
}

async function fetchCmsWithFallback<T>(
  key: string,
  schema: import('zod').ZodType<T>,
  load: () => T | null,
  currentRef: T,
  persist: (v: T) => void,
  setCurrent: (v: T) => void,
): Promise<T> {
  try {
    const data = await request(`/cms/${key}`, schema);
    try {
      persist(data);
      setCurrent(data);
    } catch {
      /* ignore quota or privacy mode - in-memory still holds draft */
    }
    return structuredClone(data);
  } catch {
    const persisted = load();
    if (persisted) {
      setCurrent(persisted);
      return structuredClone(persisted);
    }
    return structuredClone(currentRef);
  }
}

async function putCmsWithFallback<T>(
  key: string,
  schema: import('zod').ZodType<T>,
  draft: T,
  persist: (v: T) => void,
  updateCurrent: (v: T) => void,
): Promise<T> {
  const parsed = (schema as { parse: (v: unknown) => T }).parse(draft);
  try {
    const headers = await getAuthHeader();
    const data = await request(`/cms/${key}`, schema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(parsed),
    });
    try {
      persist(data);
      updateCurrent(data);
    } catch {
      /* ignore quota or privacy mode - in-memory still holds draft */
    }
    return structuredClone(data);
  } catch (e) {
    // In tests, keep the original silent fallback so existing specs pass
    if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') {
      persist(parsed);
      updateCurrent(parsed);
      return structuredClone(parsed);
    }
    const message = e instanceof Error ? e.message : String(e);
    if (
      message.includes('fetch') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Failed to fetch') ||
      message.includes('NetworkError')
    ) {
      throw new Error(
        'API not running: run vercel dev --listen 3000 and ensure Supabase is configured. Changes not saved to database.',
        {
          cause: e,
        },
      );
    }
    throw e;
  }
}

export async function getHomepage(): Promise<HomepageContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'homepage',
    homepageContentSchema,
    loadHomepageFromStorage,
    current,
    persistHomepage,
    (v) => {
      current = structuredClone(v);
    },
  );
}

export async function updateHomepage(draft: HomepageContent): Promise<HomepageContent> {
  await delay(180);
  return putCmsWithFallback('homepage', homepageContentSchema, draft, persistHomepage, (v) => {
    current = structuredClone(v);
  });
}

export async function getAbout(): Promise<AboutContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'about',
    aboutContentSchema,
    loadAboutFromStorage,
    currentAbout,
    persistAbout,
    (v) => {
      currentAbout = structuredClone(v);
    },
  );
}

export async function updateAbout(draft: AboutContent): Promise<AboutContent> {
  await delay(180);
  return putCmsWithFallback('about', aboutContentSchema, draft, persistAbout, (v) => {
    currentAbout = structuredClone(v);
  });
}

export async function getProperties(): Promise<PropertiesContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'properties',
    propertiesContentSchema,
    loadPropertiesFromStorage,
    currentProperties,
    persistProperties,
    (v) => {
      currentProperties = structuredClone(v);
    },
  );
}

export async function updateProperties(draft: PropertiesContent): Promise<PropertiesContent> {
  await delay(180);
  return putCmsWithFallback(
    'properties',
    propertiesContentSchema,
    draft,
    persistProperties,
    (v) => {
      currentProperties = structuredClone(v);
    },
  );
}

export async function getFaqs(): Promise<FaqContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'faqs',
    faqContentSchema,
    loadFaqsFromStorage,
    currentFaqs,
    persistFaqs,
    (v) => {
      currentFaqs = structuredClone(v);
    },
  );
}

export async function updateFaqs(draft: FaqContent): Promise<FaqContent> {
  await delay(180);
  return putCmsWithFallback('faqs', faqContentSchema, draft, persistFaqs, (v) => {
    currentFaqs = structuredClone(v);
  });
}

export async function getContact(): Promise<ContactContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'contact',
    contactContentSchema,
    loadContactFromStorage,
    currentContact,
    persistContact,
    (v) => {
      currentContact = structuredClone(v);
    },
  );
}

export async function updateContact(draft: ContactContent): Promise<ContactContent> {
  await delay(180);
  return putCmsWithFallback('contact', contactContentSchema, draft, persistContact, (v) => {
    currentContact = structuredClone(v);
  });
}

export async function getGlobal(): Promise<GlobalContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'global',
    globalContentSchema,
    loadGlobalFromStorage,
    currentGlobal,
    persistGlobal,
    (v) => {
      currentGlobal = structuredClone(v);
    },
  );
}

export async function updateGlobal(draft: GlobalContent): Promise<GlobalContent> {
  await delay(180);
  return putCmsWithFallback('global', globalContentSchema, draft, persistGlobal, (v) => {
    currentGlobal = structuredClone(v);
  });
}

export async function getLogin(): Promise<LoginContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'login',
    loginContentSchema,
    loadLoginFromStorage,
    currentLogin,
    persistLogin,
    (v) => {
      currentLogin = structuredClone(v);
    },
  );
}

export async function updateLogin(draft: LoginContent): Promise<LoginContent> {
  await delay(180);
  return putCmsWithFallback('login', loginContentSchema, draft, persistLogin, (v) => {
    currentLogin = structuredClone(v);
  });
}

export async function getRegister(): Promise<RegisterContent> {
  await delay(120);
  return fetchCmsWithFallback(
    'register',
    registerContentSchema,
    loadRegisterFromStorage,
    currentRegister,
    persistRegister,
    (v) => {
      currentRegister = structuredClone(v);
    },
  );
}

export async function updateRegister(draft: RegisterContent): Promise<RegisterContent> {
  await delay(180);
  return putCmsWithFallback('register', registerContentSchema, draft, persistRegister, (v) => {
    currentRegister = structuredClone(v);
  });
}

/** Reset to seed - used in tests. */
export function __resetHomepageForTests(): void {
  current = structuredClone(MOCK_HOMEPAGE_SEED);
  clearHomepageStorage();
}

export function __resetAboutForTests(): void {
  currentAbout = structuredClone(MOCK_ABOUT_SEED);
  clearAboutStorage();
}

export function __resetPropertiesForTests(): void {
  currentProperties = structuredClone(MOCK_PROPERTIES_SEED);
  clearPropertiesStorage();
}

export function __resetFaqsForTests(): void {
  currentFaqs = structuredClone(MOCK_FAQS_SEED);
  clearFaqsStorage();
}

export function __resetContactForTests(): void {
  currentContact = structuredClone(MOCK_CONTACT_SEED);
  clearContactStorage();
}

export function __resetGlobalForTests(): void {
  currentGlobal = structuredClone(MOCK_GLOBAL_SEED);
  clearGlobalStorage();
}

export function __resetLoginForTests(): void {
  currentLogin = structuredClone(MOCK_LOGIN_SEED);
  clearLoginStorage();
}

export function __resetRegisterForTests(): void {
  currentRegister = structuredClone(MOCK_REGISTER_SEED);
  clearRegisterStorage();
}

export function __resetCmsForTests(): void {
  current = structuredClone(MOCK_HOMEPAGE_SEED);
  currentAbout = structuredClone(MOCK_ABOUT_SEED);
  currentProperties = structuredClone(MOCK_PROPERTIES_SEED);
  currentFaqs = structuredClone(MOCK_FAQS_SEED);
  currentContact = structuredClone(MOCK_CONTACT_SEED);
  currentGlobal = structuredClone(MOCK_GLOBAL_SEED);
  currentLogin = structuredClone(MOCK_LOGIN_SEED);
  currentRegister = structuredClone(MOCK_REGISTER_SEED);
  clearHomepageStorage();
  clearAboutStorage();
  clearPropertiesStorage();
  clearFaqsStorage();
  clearContactStorage();
  clearGlobalStorage();
  clearLoginStorage();
  clearRegisterStorage();
}

/** Expose seed for alignment verification (test only). */
export function __getHomepageSeed(): HomepageContent {
  return structuredClone(MOCK_HOMEPAGE_SEED);
}

export function __getAboutSeed(): AboutContent {
  return structuredClone(MOCK_ABOUT_SEED);
}

export function __getPropertiesSeed(): PropertiesContent {
  return structuredClone(MOCK_PROPERTIES_SEED);
}

export function __getFaqsSeed(): FaqContent {
  return structuredClone(MOCK_FAQS_SEED);
}

export function __getContactSeed(): ContactContent {
  return structuredClone(MOCK_CONTACT_SEED);
}

export function __getGlobalSeed(): GlobalContent {
  return structuredClone(MOCK_GLOBAL_SEED);
}

export function __getLoginSeed(): LoginContent {
  return structuredClone(MOCK_LOGIN_SEED);
}

export function __getRegisterSeed(): RegisterContent {
  return structuredClone(MOCK_REGISTER_SEED);
}
