import type { Experience } from "../../types/experience";
import { getPlaceholder } from "../../lib/images";

export const experiences: Experience[] = [
  {
    id: "smart-wellness-hotel",
    slug: "smart-wellness-hotel",
    name: "AFhomes Smart Wellness Hotel",
    shortName: "Smart Wellness Hotel",
    actionLabel: "Discover the Hotel",
    status: "opening-soon",
    statusLabel: "Grand Opening — November 2026",
    location: "Alaminos, Laguna",
    openingDate: "November 2026",
    headline: "Sleep isn't just rest. It's recovery.",
    summary:
      "An upscale wellness-oriented hotel designed around the way you sleep, breathe, and restore.",
    description:
      "18 rooms — including 1 Signature Suite and 17 Smart Wellness Rooms — supported by a wellness-oriented lounge and the AFhomes philosophy of homestyle hospitality.",
    highlights: [
      "18 rooms — 1 Signature Suite & 17 Smart Wellness Rooms",
      "Non-contact sleep intelligence",
      "Negative Ion Refreshers",
      "Adaptive environmental support",
      "Smart Sleep Reports",
      "Guest-centric wellness analytics",
      "Smart Wellness Hotel Lounge",
      "Alaminos, Laguna",
    ],
    theme: "wellness",
    accent: "cyan",
    image: getPlaceholder("hotel-hero"),
  },
  {
    id: "alm-japanese-restaurant",
    slug: "alm-japanese-restaurant",
    name: "AFhomes ALM Japanese Restaurant",
    shortName: "ALM Japanese Restaurant",
    actionLabel: "Discover ALM",
    status: "open",
    statusLabel: "Now Open",
    location: "Alaminos, Laguna",
    headline: "The art of Japanese dining.",
    summary:
      "A 600 sqm Japanese dining destination built around live culinary performance and homestyle warmth.",
    description:
      "Live Teppanyaki, an upscale lounge, a dedicated reception area, private family gatherings, and corporate events — all supported by a dedicated industrial-scale kitchen.",
    highlights: [
      "600 sqm Japanese restaurant",
      "Live Teppanyaki",
      "Upscale lounge & reception",
      "Private family gatherings",
      "Corporate events",
      "Dedicated industrial-scale kitchen",
      "Alaminos, Laguna",
    ],
    theme: "culinary",
    accent: "coral",
    image: getPlaceholder("alm-hero"),
  },
  {
    id: "hotspring-ecofarm-resort",
    slug: "hotspring-ecofarm-resort",
    name: "AFhomes Hotspring & Ecofarm Resort",
    shortName: "Hotspring & Ecofarm Resort",
    actionLabel: "Discover the Resort",
    status: "in-development",
    statusLabel: "In Development",
    location: "Calauan, Laguna",
    headline: "60 hectares of nature, wellness & possibility.",
    summary:
      "A master-planned destination woven around natural geothermal springs, an integrated ecofarm, and family experiences.",
    description:
      "Approximately 60 hectares in Calauan, Laguna — with 10+ natural geothermal spring sources, mountain and countryside views, and a vision for responsible, phase-by-phase development.",
    highlights: [
      "Approximately 60 hectares",
      "10+ natural geothermal spring sources",
      "Mountain & countryside views",
      "Integrated ecofarm",
      "Farming education",
      "Family & wellness experiences",
      "Calauan, Laguna",
    ],
    theme: "nature",
    accent: "leaf",
    image: getPlaceholder("resort-hero"),
  },
];

export function getExperienceBySlug(slug: string): Experience | undefined {
  return experiences.find((experience) => experience.slug === slug);
}