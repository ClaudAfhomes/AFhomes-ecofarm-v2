import type { SiteConfig } from "../../types/site";
import logo from "../../assets/logo.png";

export const siteConfig: SiteConfig = {
  siteUrl: "https://www.afhomes.com.ph",
  businessName: "AFhomes Hotspring & Ecofarm Resort Corp.",
  brand: {
    name: "AFhomes",
    tagline: "Amazing & Fun. Your Home Away From Home.",
    mantra: "A new way to experience hospitality.",
  },
  logo: { src: logo, alt: "AFhomes" },
  social: {
    facebookCorporate: "https://www.facebook.com/profile.php?id=61578604593811",
    facebookResort: "https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort",
    youtube: "https://www.youtube.com/@AFHomesHotspringEcofarmResort",
    instagram: "https://www.instagram.com/afhomeshotspringresort/",
  },
  socialLinks: [
    { id: "facebook-corporate", label: "Facebook", platform: "facebook", url: "https://www.facebook.com/profile.php?id=61578604593811", enabled: true, sortOrder: 0 },
    { id: "facebook-resort", label: "Hotspring & Ecofarm", platform: "facebook", url: "https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort", enabled: true, sortOrder: 1 },
    { id: "youtube", label: "YouTube", platform: "youtube", url: "https://www.youtube.com/@AFHomesHotspringEcofarmResort", enabled: true, sortOrder: 2 },
    { id: "instagram", label: "Instagram", platform: "instagram", url: "https://www.instagram.com/afhomeshotspringresort/", enabled: true, sortOrder: 3 },
  ],
  seo: {
    siteTitle: "AFhomes — Amazing & Fun. Your Home Away From Home.",
    titleTemplate: "%s — AFhomes",
    metaDescription: "Hospitality, wellness, dining, nature and experiences in Laguna, Philippines.",
    keywords: ["AFhomes", "Laguna resort", "wellness hotel", "hotspring resort", "Japanese restaurant"],
    canonicalSiteUrl: "https://www.afhomes.com.ph",
    defaultSocialImage: { src: "", alt: "AFhomes hospitality and wellness experiences in Laguna" },
    favicon: { src: "/logo.png?v=3", alt: "AFhomes logo" },
  },
  pageSeo: [],
  email: "claudmarsjimenez.afhomes@gmail.com",
  phone: "+639604316867",
  phoneDisplay: "+63 960-431-6867",
  footerEyebrow: "AFhomes",
  footerTitle: "Amazing & Fun.\nYour Home Away From Home.",
  footerNoticeTitle: "Important Notice",
  footerNoticeBody: "AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. Payments must be made directly to the AFhomes Finance Department through official and verified channels.",
  footerCopyright: "AFhomes Group of Companies. All rights reserved.",
  footerExploreLabel: "Explore",
  footerExperiencesLabel: "Experiences",
  footerContactLabel: "Contact",
  footerOfficesLabel: "Offices",
  offices: [
    {
      name: "AFhomes ALM Operations",
      role: "Satellite Office",
      lines: [
        "Alaminos Commercial Complex, Maharlika Road,",
        "Brgy. San Juan, Alaminos, Laguna.",
        "Units 106F and 201–207",
        "Landmark: Puregold, Alaminos",
      ],
      mapUrl: "https://maps.app.goo.gl/mJqoxkhNU1cMxu6LA",
    },
    {
      name: "AFhomes Hotspring & Ecofarm Resort Corp.",
      role: "Head Office",
      lines: ["Brgy. Perez, Calauan, Laguna", "4012"],
      mapUrl: "https://www.bing.com/maps/search?v=2&pc=FACEBK&mid=8100&mkt=en-US&fbclid=IwY2xjawUQkdZwZG9mAWV4dG4DYWVtAjEwAGJyaWQRMTY1WEt0Wm9nZG9YcFZiMXVzcnRjBmFwcF9pZBAyMjIwMzkxNzg4MjAwODkyAAEeovOOLJH9VPLIRq9T9Me6VE6IR73cW2iNQPSP3owo7aYUQ7L8UsCg8LL0Oas_aem_roy0cVpVjjHVt5U5ObZjrw&FORM=FBKPL1&style=r&q=AFhomes+Hotspring+%26+Ecofarm+Resort+Corp.+Brgy.+Perez%2C+Calauan%2C+Laguna+4012&cp=14.103134%7E121.256996&lvl=16",
    },
  ],
  nav: {
    main: [
      { label: "Home", path: "/" },
      { label: "Experiences", path: "/experiences" },
      { label: "VIP Privilege", path: "/vip" },
      { label: "About", path: "/about" },
      { label: "Stories & Insights", path: "/stories" },
      { label: "FAQ", path: "/faq" },
      { label: "Contact", path: "/contact" },
    ],
    experiences: [
      {
        label: "Smart Wellness Hotel",
        path: "/experiences/smart-wellness-hotel",
        description: "Grand Opening — November 2026",
      },
      {
        label: "ALM Japanese Restaurant",
        path: "/experiences/alm-japanese-restaurant",
        description: "Now Open",
      },
      {
        label: "Hotspring & Ecofarm Resort",
        path: "/experiences/hotspring-ecofarm-resort",
        description: "In Development",
      },
    ],
  },
};
