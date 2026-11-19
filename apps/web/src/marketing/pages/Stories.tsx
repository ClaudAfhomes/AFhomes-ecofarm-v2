import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Container } from '../components/ui/Container';
import { PageHeader } from '../components/ui/PageHeader';
import { Reveal } from '../components/ui/Reveal';
import { StoryCard } from '../components/blog/StoryCard';
import { Badge } from '../components/ui/Badge';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { SmartImage } from '../components/ui/SmartImage';
import { Seo } from '../lib/seo';
import { useAsync } from '../hooks/useAsync';
import { storyService } from '../services/storyService';
import { cn } from '../lib/cn';
import { getPlaceholder } from '../lib/images';
import { cmsRepository } from '../lib/cms';

const PAGE_SIZE = 6;

export default function Stories() {
  const { data: stories, loading, error, retry } = useAsync(() => storyService.getStories());
  const content = cmsRepository.getPageContent().stories;
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const categories = useMemo(() => {
    if (!stories) return ['All'];
    return ['All', ...Array.from(new Set(stories.map((story) => story.category)))];
  }, [stories]);

  const filtered = useMemo(() => {
    if (!stories) return [];
    const needle = query.trim().toLowerCase();
    return stories.filter((story) => {
      const matchesCategory = category === 'All' || story.category === category;
      const matchesQuery =
        needle.length === 0 ||
        story.title.toLowerCase().includes(needle) ||
        story.excerpt.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [stories, category, query]);

  const featured = stories?.find((story) => story.featured);
  const gridStories = filtered.filter((story) => story.id !== featured?.id);
  const visibleStories = gridStories.slice(0, visible);
  const hasMore = visible < gridStories.length;

  const resetVisible = (nextCategory: string, nextQuery: string) => {
    setCategory(nextCategory);
    setQuery(nextQuery);
    setVisible(PAGE_SIZE);
  };

  return (
    <>
      <Seo
        title="Stories & Insights"
        description="Stories, ideas, and insights from the AFhomes world — wellness, dining, nature, and the journey behind every experience."
        path="/stories"
      />

      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
        imageSpec={content.image.src ? content.image : getPlaceholder('resort-valley')}
      />

      <section className="bg-cream-100 py-20 sm:py-28">
        <Container>
          {loading && <LoadingState label="Loading stories…" />}
          {error && (
            <ErrorState title="Couldn't load stories" message={error.message} onRetry={retry} />
          )}

          {stories && (
            <>
              {/* Featured */}
              {featured && (
                <Reveal y={30}>
                  <article className="group grid grid-cols-1 overflow-hidden rounded-[1.25rem] border border-line bg-cream-50 shadow-lift lg:grid-cols-2">
                    <Link
                      to={`/stories/${featured.slug}`}
                      className="relative block aspect-[16/10] overflow-hidden lg:aspect-auto"
                      data-cursor="view"
                    >
                      <SmartImage
                        spec={featured.cover}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        sizes="(max-width: 1024px) 100vw, 50vw"
                      />
                      <span className="label-caps absolute top-5 left-5 rounded-full bg-gold-500 px-4 py-2 text-pine-950">
                        Featured story
                      </span>
                    </Link>
                    <div className="flex flex-col justify-center p-8 sm:p-12">
                      <div className="flex items-center gap-3">
                        <Badge tone="gold">{featured.category}</Badge>
                        <time className="text-xs font-medium text-ink-600" dateTime={featured.date}>
                          {featured.date}
                        </time>
                      </div>
                      <h2 className="font-display mt-5 text-3xl leading-tight font-medium text-navy-900 text-balance sm:text-4xl lg:text-5xl">
                        <Link
                          to={`/stories/${featured.slug}`}
                          className="transition-colors group-hover:text-leaf-700"
                        >
                          {featured.title}
                        </Link>
                      </h2>
                      <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
                        {featured.excerpt}
                      </p>
                      <Button
                        to={`/stories/${featured.slug}`}
                        variant="text"
                        size="md"
                        withArrow
                        className="mt-8 self-start"
                      >
                        Read the story
                      </Button>
                    </div>
                  </article>
                </Reveal>
              )}

              {/* Filters */}
              <div className="mt-16 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Filter stories by category"
                >
                  {categories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={category === item}
                      onClick={() => resetVisible(item, query)}
                      className={cn(
                        'label-caps min-h-10 rounded-lg border px-4 py-2 transition-colors',
                        category === item
                          ? 'border-navy-800 bg-navy-800 text-cream-50'
                          : 'border-line bg-cream-50 text-ink-600 hover:border-navy-300 hover:text-navy-900',
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <label className="relative block w-full max-w-xs">
                  <span className="sr-only">Search stories</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    placeholder="Search stories…"
                    className="w-full rounded-full border border-line bg-cream-50 px-5 py-3 text-sm text-ink-800 placeholder:text-ink-400 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-500/30 focus:outline-none"
                  />
                </label>
              </div>

              {/* Grid */}
              {gridStories.length === 0 ? (
                <EmptyState
                  title="No stories found"
                  message="Try a different category or search term."
                />
              ) : (
                <>
                  <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {visibleStories.map((story, index) => (
                      <Reveal key={story.id} delay={(index % 3) * 0.06} y={24}>
                        <StoryCard story={story} />
                      </Reveal>
                    ))}
                  </div>
                  {hasMore && (
                    <div className="mt-12 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={() => setVisible((value) => value + PAGE_SIZE)}
                      >
                        Load more stories
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Container>
      </section>
    </>
  );
}
