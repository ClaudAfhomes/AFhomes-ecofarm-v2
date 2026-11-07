import type { CmsMediaKindSchema, CmsMediaPlacementSchema, CmsMediaWidthSchema, CmsMediaPositionSchema, CmsMediaOverlaySchema, CmsMediaBlockSchema } from '@afhomes/contracts';
export type CmsMediaKind = (typeof CmsMediaKindSchema)['_output'];
export type CmsMediaPlacement = (typeof CmsMediaPlacementSchema)['_output'];
export type CmsMediaWidth = (typeof CmsMediaWidthSchema)['_output'];
export type CmsMediaPosition = (typeof CmsMediaPositionSchema)['_output'];
export type CmsMediaOverlay = (typeof CmsMediaOverlaySchema)['_output'];
export type CmsMediaBlock = (typeof CmsMediaBlockSchema)['_output'];
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
