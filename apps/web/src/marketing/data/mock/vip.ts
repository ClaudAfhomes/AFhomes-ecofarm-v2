import type { VipPlan } from "../../types/vip";

/**
 * VIP Privilege tiers. All benefits listed are taken directly from the
 * supplied AFhomes content — no additional benefits have been invented.
 */
export const vipPlans: VipPlan[] = [
  {
    id: "gold",
    name: "Gold",
    discountPercent: 25,
    validityYears: 22,
    pointsPerYear: 25000,
    totalPoints: 500000,
    cardholders: "Primary + optional secondary cardholder (2 maximum)",
    benefits: [
      "25% fixed VIP discounts",
      "22-year validity (20-year base + 2-year extension)",
      "Primary + optional secondary cardholder (2 maximum)",
      "No monthly or annual dues",
      "Priority reservation rights",
      "Annual welcome gift",
      "25K/year loyalty stay points",
      "500K loyalty stay points over 20 years",
    ],
    accentText: "text-[#8a6510]",
    accentBg: "bg-gold-500",
    featured: true,
  },
  {
    id: "silver",
    name: "Silver",
    discountPercent: 20,
    validityYears: 12,
    pointsPerYear: 20000,
    totalPoints: 200000,
    cardholders: "Single cardholder",
    benefits: [
      "20% fixed VIP discounts",
      "12-year validity (10-year base + 2-year extension)",
      "Single cardholder",
      "No monthly or annual dues",
      "Priority reservation rights",
      "Annual welcome gift",
      "20K/year loyalty stay points",
      "200K loyalty stay points over 10 years",
    ],
    accentText: "text-ink-500",
    accentBg: "bg-navy-300",
  },
  {
    id: "bronze",
    name: "Bronze",
    discountPercent: 15,
    validityYears: 7,
    pointsPerYear: 10000,
    totalPoints: 50000,
    cardholders: "Single cardholder",
    benefits: [
      "15% fixed VIP discounts",
      "7-year validity (5-year base + 2-year extension)",
      "Single cardholder",
      "No monthly or annual dues",
      "Priority reservation rights",
      "Annual welcome gift",
      "10K/year loyalty stay points",
      "50K loyalty stay points over 5 years",
    ],
    accentText: "text-coral-700",
    accentBg: "bg-coral-500",
  },
];
