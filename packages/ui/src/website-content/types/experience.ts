import type { ExperienceStatusSchema, ExperienceSchema } from '@afhomes/contracts';
export type ExperienceStatus = (typeof ExperienceStatusSchema)['_output'];
export type Experience = (typeof ExperienceSchema)['_output'];
