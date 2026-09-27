import { apiClient, isApiEnabled } from "./client";
import { mockRead } from "../lib/mock";
import { cmsRepository } from "../lib/cms";
import type { Story } from "../types/story";

/**
 * Stories API — conceptual contract:
 *   GET /api/stories
 *   GET /api/stories/:slug
 * Search and category filtering are performed client-side in the UI.
 */
export const storiesApi = {
  getStories(): Promise<Story[]> {
    if (isApiEnabled) return apiClient.get<Story[]>("/api/stories");
    return mockRead(() => cmsRepository.getStories());
  },
  getStoryBySlug(slug: string): Promise<Story | undefined> {
    if (isApiEnabled) return apiClient.get<Story>(`/api/stories/${slug}`);
    return mockRead(() => cmsRepository.getStories().find((story) => story.slug === slug), 250);
  },
  getCategories(): Promise<string[]> {
    if (isApiEnabled) return apiClient.get<string[]>("/api/stories/categories");
    return mockRead(
      () => Array.from(new Set(cmsRepository.getStories().map((story) => story.category))),
      150,
    );
  },
};