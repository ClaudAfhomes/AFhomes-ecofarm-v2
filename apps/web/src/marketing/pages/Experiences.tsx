import { Container } from "../components/ui/Container";
import { Reveal } from "../components/ui/Reveal";
import { Button } from "../components/ui/Button";
import { Badge, StatusBadge } from "../components/ui/Badge";
import { PageHeader } from "../components/ui/PageHeader";
import { cmsRepository } from "../lib/cms";
import { getPlaceholder } from "../lib/images";
import { Seo } from "../lib/seo";
import { ImageReveal } from "../components/ui/ImageReveal";
import { cn } from "../lib/cn";
import type { Experience } from "../types/experience";

export default function Experiences() {
  const experiences = cmsRepository.getExperiences();
  const content = cmsRepository.getPageContent().experiences;
  return (
    <>
      <Seo
        title="Experiences — Dining, Stay & Escape"
        description="Dine at ALM Japanese Restaurant, stay at the Smart Wellness Hotel, and escape to the Hotspring & Ecofarm Resort — the AFhomes experience in Laguna, Philippines."
        path="/experiences"
      />
      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
        imageSpec={content.image.src ? content.image : getPlaceholder("resort-hero")}
      />

      <div className="py-20 sm:py-28">
        <div className="space-y-24 sm:space-y-32">
          {experiences.map((experience, index) => (
            <ExperienceRow key={experience.id} experience={experience} index={index} />
          ))}
        </div>
      </div>
    </>
  );
}

function ExperienceRow({
  experience,
  index,
}: {
  experience: Experience;
  index: number;
}) {
  const reversed = index % 2 === 1;

  return (
    <Container>
      <article className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={cn(reversed && "lg:order-2")}>
          <Reveal y={40}>
            <ImageReveal spec={experience.image} ratio="aspect-[4/3]" className="rounded-[1.25rem]" />
          </Reveal>
        </div>

        <div className={cn(reversed && "lg:order-1")}>
          <Reveal>
            <span aria-hidden="true" className="font-display text-6xl leading-none font-medium text-navy-800/60 sm:text-7xl">
              {String(index + 1).padStart(2, "0")}
            </span>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="font-display mt-2 text-4xl leading-tight font-medium text-navy-900 text-balance sm:text-5xl">
              {experience.name}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-2 text-sm text-ink-500">{experience.location}</p>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600 text-pretty">
              {experience.summary}
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5">
              {experience.highlights.slice(0, 4).map((highlight) => (
                <li key={highlight} className="flex items-center gap-2 text-sm font-medium text-navy-800">
                  <span className="h-1 w-1 rounded-full bg-coral-500" aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.22}>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {experience.featured && <Badge tone="gold">Featured experience</Badge>}
              <StatusBadge
                status={experience.status}
                label={experience.statusLabel}
                className="border-navy-800/10 bg-white/80"
              />
              <Button to={`/experiences/${experience.slug}`} variant="text" size="md" withArrow>
                {experience.actionLabel}
              </Button>
            </div>
          </Reveal>
        </div>
      </article>
    </Container>
  );
}
