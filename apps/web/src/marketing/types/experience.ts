import type { ImageSpec } from "../lib/images";

export type ExperienceStatus = "open" | "opening-soon" | "in-development";

export interface Experience {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  actionLabel: string;
  status: ExperienceStatus;
  statusLabel: string;
  location: string;
  openingDate?: string;
  headline: string;
  summary: string;
  description: string;
  highlights: string[];
  theme: "culinary" | "wellness" | "nature";
  accent: string;
  image: ImageSpec;
  featured?: boolean;
  archived?: boolean;
}