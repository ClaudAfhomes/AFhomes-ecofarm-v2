import type { Story } from "../../types/story";
import { getPlaceholder } from "../../lib/images";

/**
 * Stories & Insights — editorial mock content.
 *
 * These entries are placeholders built strictly from supplied AFhomes
 * information. They intentionally make no factual claims beyond what has been
 * officially provided. Copy will be replaced with real editorial content.
 */
export const stories: Story[] = [
  {
    id: "story-smart-wellness-vision",
    slug: "a-gentler-way-to-rest",
    title: "A gentler way to rest",
    category: "Wellness & Relaxation",
    date: "August 2026",
    excerpt:
      "An introduction to the thinking behind our upscale wellness-oriented hotel in Alaminos, Laguna — sleep, breath, and environment working together in a calm setting.",
    content: [
      "Rest is more than the quiet between busy days. For AFhomes, it is the foundation of hospitality — the way a guest leaves feeling different from the way they arrived.",
      "Our smart wellness hotel in Alaminos, Laguna, is planned around that idea. Its 18 rooms — including one Signature Suite and 17 Smart Wellness Rooms — are designed to support sleep and recovery in a calm, homestyle setting.",
      "A smart wellness lounge will sit at the heart of the stay, giving guests a comfortable space to settle, connect, and unwind.",
      "We look forward to welcoming the first guests when the hotel opens in November 2026.",
    ],
    cover: getPlaceholder("hotel-room"),
    featured: true,
  },
  {
    id: "story-alm-craft",
    slug: "the-live-fire-of-alm",
    title: "The live fire of ALM",
    category: "Behind the Scenes",
    date: "July 2026",
    excerpt:
      "A look at what makes our 600 sqm Japanese restaurant in Alaminos, Laguna a live culinary experience — from the teppanyaki counter to the upscale lounge.",
    content: [
      "Some dining is served. Some dining is performed.",
      "At AFhomes ALM Japanese Restaurant, our live Teppanyaki turns the table into a stage — ingredients, flame, and craft coming together in front of our guests.",
      "Beyond the cooking counter, the restaurant offers an upscale lounge, a dedicated reception area, and spaces suited to private family gatherings and corporate events.",
      "Behind it all, a dedicated industrial-scale kitchen keeps the operation steady, consistent, and ready for the fullest of rooms.",
    ],
    cover: getPlaceholder("alm-teppanyaki"),
  },
  {
    id: "story-hotspring-vision",
    slug: "dreaming-the-resort",
    title: "Dreaming the resort to life",
    category: "Resort Highlights",
    date: "June 2026",
    excerpt:
      "On approximately 60 hectares in Calauan, Laguna, a master-planned resort is taking shape — built around 10+ natural geothermal spring sources and an integrated ecofarm.",
    content: [
      "Some places are designed. Others are discovered.",
      "In Calauan, Laguna, more than 10 natural geothermal spring sources rise from a landscape of mountain and countryside views. It is around these springs that the AFhomes Hotspring & Ecofarm Resort is being planned.",
      "At approximately 60 hectares, the master-planned destination is envisioned as an integrated ecofarm — a place for farming education, nature-based activities, family experiences, and rest.",
      "The project is being developed phase by phase, with environmental and governmental compliance at the center of every step.",
    ],
    cover: getPlaceholder("resort-valley"),
  },
  {
    id: "story-ecofarm",
    slug: "learning-from-the-land",
    title: "Learning from the land",
    category: "Eco-Friendly Living",
    date: "May 2026",
    excerpt:
      "The Hotspring & Ecofarm Resort, in Calauan, Laguna, is being planned around a simple idea: that the land can teach, feed, and restore — while being cared for in return.",
    content: [
      "An ecofarm is not only a place that grows food. It is a place that grows understanding.",
      "At the AFhomes Hotspring & Ecofarm Resort, integrated farming is envisioned as part of the guest experience — a chance to connect with the land, learn where food comes from, and share that knowledge with family.",
      "Nature-based activities and farming education are planned as threads running through the resort experience.",
      "Cultivating a sense of care for the environment is as much a part of the vision as any amenity.",
    ],
    cover: getPlaceholder("resort-farm"),
  },
  {
    id: "story-forum",
    slug: "what-smart-wellness-could-feel-like",
    title: "What smart wellness could feel like",
    category: "News & Promos",
    date: "April 2026",
    excerpt:
      "Our hotel team is exploring how intelligent guest rooms might gently support sleep — monitoring, adapting, and reporting without changing the calm of a stay.",
    content: [
      "Technology at its best disappears into the background.",
      "For our planned smart wellness hotel, that principle guides the design. Non-contact sensing is being explored so the room can support restful sleep the way a guest might want it to — without intrusive devices.",
      "Concepts under exploration include sleep and breathing monitoring, air-quality monitoring, adaptive environmental support, and Smart Sleep Reports delivered to the guest.",
      "The goal is simple: technology that serves the rest, not the other way around.",
    ],
    cover: getPlaceholder("hotel-spa"),
  },
  {
    id: "story-family",
    slug: "more-together",
    title: "More together",
    category: "Blog",
    date: "March 2026",
    excerpt:
      "From family-dining nights at ALM to future days planned at the resort, the AFhomes point of view begins with time shared — first among family.",
    content: [
      "Hospitality is, at its heart, about people being together.",
      "At AFhomes, that means experiences designed for family. Private gatherings at ALM, wellness stays at the hotel, and future nature days at the resort are all imagined around shared moments.",
      "It is part of why we describe our approach as homestyle hospitality — the warmth of home, brought to every experience.",
    ],
    cover: getPlaceholder("story-gathering"),
  },
  {
    id: "story-journey",
    slug: "a-journey-in-three-chapters",
    title: "A journey in three chapters",
    category: "News & Promos",
    date: "February 2026",
    excerpt:
      "Dine, stay, escape — a look at how ALM, the Smart Wellness Hotel, and the Hotspring & Ecofarm Resort come together as one ecosystem.",
    content: [
      "AFhomes is not one destination. It is a family of experiences, connected by a single point of view.",
      "Chapter one is now open — AFhomes ALM Japanese Restaurant in Alaminos, Laguna.",
      "Chapter two arrives with the Smart Wellness Hotel grand opening in November 2026.",
      "Chapter three, the Hotspring & Ecofarm Resort, is in development — a masterpiece being built phase by phase.",
    ],
    cover: getPlaceholder("brand-field"),
  },
  {
    id: "story-springs",
    slug: "the-geothermal-blessing",
    title: "The geothermal blessing of Calauan",
    category: "Eco-Friendly Living",
    date: "January 2026",
    excerpt:
      "Ten-plus natural geothermal spring sources are a rare gift of the landscape. Here is how a responsible resort might honor them.",
    content: [
      "Geothermal springs are evidence that the earth beneath us is alive.",
      "The Calauan landscape holds more than 10 natural geothermal spring sources — a rare advantage we intend to treat with care and responsibility.",
      "Responsible, phase-by-phase development means understanding the land, planning with environmental compliance, and building only when the conditions are right.",
      "The hottest goal of all is to leave the springs as living, working parts of the landscape.",
    ],
    cover: getPlaceholder("resort-spring"),
  },
];

export function getStoryBySlug(slug: string): Story | undefined {
  return stories.find((story) => story.slug === slug);
}

export function getStoryCategories(): string[] {
  return Array.from(new Set(stories.map((story) => story.category)));
}