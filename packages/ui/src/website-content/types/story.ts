import type { StorySchema } from '@afhomes/contracts';
export type Story = (typeof StorySchema)['_output'];
