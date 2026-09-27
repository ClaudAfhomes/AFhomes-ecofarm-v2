/**
 * Centralized placeholder image registry.
 *
 * Placeholder imagery is served from Unsplash CDN. When official AFhomes
 * assets are available, replace the `src` values here — no component changes
 * are required.
 *
 * IMPORTANT: these are generic, unattributed stock placeholders. They must be
 * swapped for real AFhomes photography before production.
 */

import goldCard from "../assets/uploads/gold-card.webp";
import silverCard from "../assets/uploads/silver-card.webp";
import bronzeCard from "../assets/uploads/bronze-card.webp";
import logo from "../assets/logo.png";

export type ImageKey = string;

export interface ImageSpec {
  src: string;
  alt: string;
}

const CDN = "https://images.unsplash.com";

function unsplash(id: string, w = 1600): string {
  return `${CDN}/${id}?auto=format&fit=crop&w=${w}&q=80`;
}

function spec(src: string, alt: string): ImageSpec {
  return { src, alt };
}

export const PLACEHOLDER = {
  "alm-hero": spec(
    unsplash("photo-1517248135467-4c7edcad34c4"),
    "Intimate restaurant dining room lit by warm candlelight",
  ),
  "alm-sushi": spec(
    unsplash("photo-1526318896980-cf78c088247c"),
    "Chef-prepared sushi arranged on a wooden board",
  ),
  "alm-teppanyaki": spec(
    unsplash("photo-1555939594-58d7cb561ad1"),
    "Fresh ingredients grilling over an open cooking surface",
  ),
  "alm-plating": spec(
    unsplash("photo-1552566626-52f8b828add9"),
    "Chef carefully finishing a plate in a professional kitchen",
  ),
  "alm-interior": spec(
    unsplash("photo-1514933651103-005eec06c04b"),
    "Moody, refined restaurant interior with wooden seating",
  ),
  "alm-cuisine": spec(
    unsplash("photo-1579871494447-9811cf80d66c"),
    "Fresh Japanese cuisine served in elegant small plates",
  ),
  "hotel-hero": spec(
    unsplash("photo-1582719478250-c89cae4dc85b"),
    "Calm, naturally lit wellness guest room with a view",
  ),
  "hotel-room": spec(
    unsplash("photo-1611892440504-42a792e24d32"),
    "Comfortable, thoughtfully designed hotel bedroom",
  ),
  "hotel-spa": spec(
    unsplash("photo-1544161515-4ab6ce6db874"),
    "Serene wellness spa setting with soft towels and candles",
  ),
  "hotel-lounge": spec(
    unsplash("photo-1578683010236-d716f9a3f461"),
    "Relaxed lounge seating in a modern hospitality interior",
  ),
  "hotel-pool": spec(
    unsplash("photo-1520250497591-112f2f40a3f4"),
    "Resort pool with loungers at golden hour",
  ),
  "hotel-flatlay": spec(
    unsplash("photo-1600334129128-685c5582fd35"),
    "Minimal wellness flatlay with natural textures and light",
  ),
  "resort-hero": spec(
    unsplash("photo-1501785888041-af3ef285b470"),
    "Expansive mountain and lake landscape under soft light",
  ),
  "resort-valley": spec(
    unsplash("photo-1470071459604-3b5ec3a7fe05"),
    "Rolling green valley and forest in morning fog",
  ),
  "resort-forest": spec(
    unsplash("photo-1441974231531-c6227db76b6e"),
    "Sunlight streaming through lush forest canopy",
  ),
  "resort-farm": spec(
    unsplash("photo-1464226184884-fa280b87c399"),
    "Tending plants in a sunlit field on natural ground",
  ),
  "resort-spring": spec(
    unsplash("photo-1519824145371-296894a0daa9"),
    "Steaming geothermal water pooling among rocks",
  ),
  "brand-field": spec(
    unsplash("photo-1506744038136-46273834b3fb"),
    "Open countryside field beneath a wide sky",
  ),
  "story-gathering": spec(
    unsplash("photo-1517457373958-b7bdd4587205"),
    "People gathered together in a warm, festive setting",
  ),
  "story-landscape": spec(
    unsplash("photo-1469474968028-56623f02e42e"),
    "Mountain landscape in warm sunrise light",
  ),
  "story-wellness": spec(
    unsplash("photo-1506126613408-eca07ce68773"),
    "Quiet wellness moment in a peaceful natural setting",
  ),
  "story-food": spec(
    unsplash("photo-1493770348161-369560ae357d"),
    "Colorful fresh dishes served for a shared table",
  ),
  "story-tech": spec(
    unsplash("photo-1518770660439-4636190af475"),
    "Close detail of a small electronic sensor module",
  ),

  /* Official VIP membership card artwork (real brand assets) */
  "vip-card-gold": spec(goldCard, "Gold VIP membership card"),
  "vip-card-silver": spec(silverCard, "Silver VIP membership card"),
  "vip-card-bronze": spec(bronzeCard, "Bronze VIP membership card"),
} as const;

export type PlaceholderKey = keyof typeof PLACEHOLDER;

export interface SiteMediaAsset extends ImageSpec {
  id: string;
  name: string;
  category: string;
}

function categoryForImage(key: string) {
  if (key.startsWith("alm-")) return "rooms";
  if (key.startsWith("hotel-")) return "rooms";
  if (key.startsWith("resort-")) return "gallery";
  if (key.startsWith("story-")) return "general";
  if (key.startsWith("vip-")) return "offers";
  return "general";
}

/** Images bundled with the site and available for discovery in the CMS media library. */
export const siteMediaCatalog: SiteMediaAsset[] = [
  { id: "site-image-logo", name: "AFhomes logo", src: logo, alt: "AFhomes", category: "general" },
  ...Object.entries(PLACEHOLDER).map(([key, image]) => ({
    id: `site-image-${key}`,
    name: key.replace(/-/g, " "),
    src: image.src,
    alt: image.alt,
    category: categoryForImage(key),
  })),
];

export function getPlaceholder(key: PlaceholderKey): ImageSpec {
  return PLACEHOLDER[key];
}
