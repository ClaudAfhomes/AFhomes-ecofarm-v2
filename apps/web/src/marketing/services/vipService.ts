import { vipApi } from "../api/vip";
import type { VipPlan } from "../types/vip";

export const vipService = {
  getPlans(): Promise<VipPlan[]> {
    return vipApi.getPlans();
  },
};