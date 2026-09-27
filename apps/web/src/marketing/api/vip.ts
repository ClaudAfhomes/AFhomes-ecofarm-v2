import { apiClient, isApiEnabled } from "./client";
import { mockRead } from "../lib/mock";
import { cmsRepository } from "../lib/cms";
import type { VipPlan } from "../types/vip";

/**
 * VIP API — conceptual contract:
 *   GET /api/vip/plans
 */
export const vipApi = {
  getPlans(): Promise<VipPlan[]> {
    if (isApiEnabled) return apiClient.get<VipPlan[]>("/api/vip/plans");
    return mockRead(() => cmsRepository.getVipPlans());
  },
};