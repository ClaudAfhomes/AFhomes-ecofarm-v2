import type { VipTierIdSchema, VipPlanSchema } from '@afhomes/contracts';
export type VipTierId = (typeof VipTierIdSchema)['_output'];
export type VipPlan = (typeof VipPlanSchema)['_output'];
