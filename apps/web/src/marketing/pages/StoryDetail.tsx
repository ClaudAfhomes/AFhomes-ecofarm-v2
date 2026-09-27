import { useParams } from "react-router";
import { Container } from "../components/ui/Container";
import { Reveal } from "../components/ui/Reveal";
import { StoryCard } from "../components/blog/StoryCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { LoadingState, ErrorState } from "../components/ui/Feedback";
import { SmartImage } from "../components/ui/SmartImage";
import { Seo } from "../lib/seo";
import { useAsync } from "../hooks/useAsync";
import { storyService } from "../services/storyService";
import { cn } from "../lib/cn";

export default function StoryDetail() {
  const { slug } = useParams<{ slug: string }>();
  const {
    data: story,
    loading,
    error,
    retry,
  } = useAsync(() => storyService.getStoryBySlug(slug ?? ""), [slug]);

  const relatedStories = useAsync(
    () =>
      storyService.getStories().then((stories) => {
        if (!story) return [];
        return stories.filter((item) => item.id !== story.id && item.category === story.category).slice(0, 3);
      }),
    [story?.id],
  );

  if (loading) {
    return (
      <>
        <Seo title="Story" path={`/stories/${slug}`} />
        <div className="h-20 bg-navy-950" aria-hidden="true" />
        <Container>
          <LoadingState label="Reading story…" />
        </Container>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="h-20 bg-navy-950" aria-hidden="true" />
        <Container>
          <ErrorState title="Couldn't load this story" message={error.message} onRetry={retry} />
        </Container>
      </>
    );
  }

  if (!story) {
    return (
      <>
        <div className="h-20 bg-navy-950" aria-hidden="true" />
        <Container className="py-32 text-center">
          <Seo title="Story not found" path="/stories" />
          <p className="font-display text-5xl font-medium text-navy-900">Story not found</p>
          <p className="mt-3 text-ink-500">This story may have been moved or removed.</p>
          <Button to="/stories" variant="primary" size="md" withArrow className="mt-8">
            Back to Stories
          </Button>
        </Container>
      </>
    );
  }

  return (
    <>
      <Seo title={story.title} description={story.excerpt} path={`/stories/${story.slug}`} />

      <article>
        {/* Hero */}
        <header className="relative flex min-h-[70svh] items-end overflow-hidden bg-navy-950 text-cream-50">
          <div className="absolute inset-0">
            <SmartImage
              spec={story.cover}
              priority
              className="h-full w-full object-cover opacity-55"
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-linear-to-t from-navy-950 via-navy-950/45 to-navy-950/20" />
          </div>
          <Container className="relative pb-16 pt-44">
            <Reveal>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="gold">{story.category}</Badge>
                <time className="text-sm font-medium text-cream-200/80" dateTime={story.date}>
                  {story.date}
                </time>
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="font-display mt-6 max-w-4xl text-5xl leading-[0.98] font-medium text-balance sm:text-6xl lg:text-7xl">
                {story.title}
              </h1>
            </Reveal>
          </Container>
        </header>

        {/* Content */}
        <div className="bg-cream-100 py-20 sm:py-28">
          <Container size="tight">
            <Reveal>
              <p className="font-display text-2xl leading-relaxed text-navy-800 italic sm:text-3xl">
                {story.excerpt}
              </p>
            </Reveal>
            <div className="mt-10 space-y-7">
              {story.content.map((paragraph, index) => (
                <Reveal key={index} delay={Math.min(index * 0.04, 0.2)}>
                  <p
                    className={cn(
                      "text-lg leading-relaxed text-ink-700 text-pretty",
                      index === 0 &&
                        "first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-display first-letter:text-6xl first-letter:leading-[0.8] first-letter:text-leaf-700",
                    )}
                  >
                    {paragraph}
                  </p>
                </Reveal>
              ))}
            </div>
            <Reveal>
              <div className="mt-12 border-t border-line pt-8">
                <Button to="/stories" variant="text" size="md" withArrow>
                  All stories
                </Button>
              </div>
            </Reveal>
          </Container>
        </div>
      </article>

      {/* Related */}
      {relatedStories.data && relatedStories.data.length > 0 && (
        <section className="border-t border-line bg-cream-200/70 py-20 sm:py-24">
          <Container>
            <Reveal>
              <h2 className="font-display text-3xl font-medium text-navy-900 sm:text-4xl">
                More from {story.category}
              </h2>
            </Reveal>
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {relatedStories.data.map((related) => (
                <Reveal key={related.id}>
                  <StoryCard story={related} />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* CTA */}
      <section className="bg-navy-950 py-20 text-cream-50">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] border border-white/10 bg-navy-900/60 p-10 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                Come experience it yourself.
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-200/75">
                The best stories are lived. Start yours with AFhomes.
              </p>
            </div>
            <Button to="/contact" variant="accent" size="lg" withArrow>
              Plan your visit
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}