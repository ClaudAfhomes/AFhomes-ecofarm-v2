export type CmsMediaKind = "image" | "video";
export type CmsMediaPlacement = "page-background" | "before-page" | "after-page";
export type CmsMediaWidth = "content" | "wide" | "full";
export type CmsMediaPosition = "center" | "top" | "bottom";
export type CmsMediaOverlay = "light" | "medium" | "strong";

export interface CmsMediaBlock {
  id: string;
  page: string;
  placement: CmsMediaPlacement;
  kind: CmsMediaKind;
  src: string;
  alt: string;
  caption: string;
  width: CmsMediaWidth;
  fit: "cover" | "contain";
  position?: CmsMediaPosition;
  overlay?: CmsMediaOverlay;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export const cmsMediaPages = [
  { value: "/", label: "Home" },
  { value: "/about", label: "About" },
  { value: "/experiences", label: "Experiences" },
  { value: "/experiences/smart-wellness-hotel", label: "Smart Wellness Hotel" },
  { value: "/experiences/alm-japanese-restaurant", label: "ALM Japanese Restaurant" },
  { value: "/experiences/hotspring-ecofarm-resort", label: "Hotspring Ecofarm Resort" },
  { value: "/vip", label: "VIP Privilege" },
  { value: "/stories", label: "Stories" },
  { value: "/faq", label: "FAQ" },
  { value: "/compliance", label: "Compliance" },
  { value: "/contact", label: "Contact" },
] as const;
