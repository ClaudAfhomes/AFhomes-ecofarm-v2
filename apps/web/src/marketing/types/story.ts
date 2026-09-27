import type { ImageSpec } from "../lib/images";

export interface Story {
  id: string;
  slug: string;
  title: string;
  category: string;
  date: string;
  excerpt: string;
  content: string[];
  cover: ImageSpec;
  featured?: boolean;
  archived?: boolean;
}