import { Link } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { SmartImage } from "../../components/ui/SmartImage";
import { Card } from "../../components/ui/Card";
import { ArrowRight } from "../../components/ui/icons";
import type { Story } from "../../types/story";

interface StoryCardProps {
  story: Story;
}

export function StoryCard({ story }: StoryCardProps) {
  return (
    <Card
      as="article"
      padded={false}
      elevated
      interactive
      className="group flex h-full flex-col overflow-hidden"
    >
      <Link
        to={`/stories/${story.slug}`}
        className="relative block aspect-[16/10] overflow-hidden"
        data-cursor="view"
      >
        <SmartImage
          spec={story.cover}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      </Link>
      <div className="flex flex-1 flex-col p-7">
        <div className="flex items-center justify-between gap-3">
          <Badge tone="gold">{story.category}</Badge>
          <time className="text-xs font-medium text-ink-600" dateTime={story.date}>
            {story.date}
          </time>
        </div>
        <h3 className="mt-4">
          <Link
            to={`/stories/${story.slug}`}
            className="font-display text-2xl leading-snug font-medium text-navy-900 transition-colors group-hover:text-leaf-700"
          >
            {story.title}
          </Link>
        </h3>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-600">{story.excerpt}</p>
        <Link
          to={`/stories/${story.slug}`}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-navy-900 transition-colors group-hover:text-leaf-700"
        >
          Read the story
          <ArrowRight className="h-4 w-4 text-coral-500 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>
    </Card>
  );
}
