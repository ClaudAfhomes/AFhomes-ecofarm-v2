export interface NavItem {
  label: string;
  path: string;
  description?: string;
}

export interface ContactLink {
  label: string;
  href: string;
}

export type SocialPlatform = "facebook" | "instagram" | "youtube" | "other";

export interface SocialLink {
  id: string;
  label: string;
  platform: SocialPlatform;
  url: string;
  enabled: boolean;
  sortOrder: number;
}

export interface OfficeAddress {
  name: string;
  role: string;
  lines: string[];
  mapUrl?: string;
}

export interface SiteBrand {
  name: string;
  tagline: string;
  mantra: string;
}

export interface PageSeoSettings {
  path: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  openGraphTitle: string;
  openGraphDescription: string;
  openGraphImage: import("../lib/images").ImageSpec;
}

export interface GlobalSeoSettings {
  siteTitle: string;
  titleTemplate: string;
  metaDescription: string;
  keywords: string[];
  canonicalSiteUrl: string;
  defaultSocialImage: import("../lib/images").ImageSpec;
  favicon: import("../lib/images").ImageSpec;
}

export interface SiteConfig {
  siteUrl: string;
  businessName: string;
  brand: SiteBrand;
  logo?: import("../lib/images").ImageSpec;
  social: {
    facebookCorporate: string;
    facebookResort: string;
    youtube: string;
    instagram: string;
  };
  socialLinks: SocialLink[];
  seo: GlobalSeoSettings;
  pageSeo: PageSeoSettings[];
  email: string;
  phone: string;
  phoneDisplay: string;
  footerEyebrow: string;
  footerTitle: string;
  footerNoticeTitle: string;
  footerNoticeBody: string;
  footerCopyright: string;
  footerExploreLabel: string;
  footerExperiencesLabel: string;
  footerContactLabel: string;
  footerOfficesLabel: string;
  offices: OfficeAddress[];
  nav: {
    main: NavItem[];
    experiences: NavItem[];
  };
}
