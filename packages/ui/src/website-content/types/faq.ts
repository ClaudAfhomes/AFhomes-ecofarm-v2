import type { FaqItemSchema, FaqCategorySchema } from '@afhomes/contracts';
export type FaqItem = (typeof FaqItemSchema)['_output'];
export type FaqCategory = (typeof FaqCategorySchema)['_output'];
