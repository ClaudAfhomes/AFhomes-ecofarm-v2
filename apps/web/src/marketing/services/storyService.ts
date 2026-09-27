import { storiesApi } from "../api/stories";
import type { Story } from "../types/story";

export const storyService = {
  getStories(): Promise<Story[]> {
    return storiesApi.getStories();
  },
  getStoryBySlug(slug: string): Promise<Story | undefined> {
    return storiesApi.getStoryBySlug(slug);
  },
  getCategories(): Promise<string[]> {
    return storiesApi.getCategories();
  },
};