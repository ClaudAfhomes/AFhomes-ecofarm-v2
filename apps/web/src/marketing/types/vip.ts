export type VipTierId = "gold" | "silver" | "bronze";

import type { ImageSpec } from "../lib/images";

export interface VipPlan {
  id: VipTierId;
  name: string;
  discountPercent: number;
  validityYears: number;
  pointsPerYear: number;
  totalPoints: number;
  cardholders: string;
  benefits: string[];
  accentText: string;
  accentBg: string;
  image?: ImageSpec;
  featured?: boolean;
  archived?: boolean;
}