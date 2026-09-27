import { Container } from "../components/ui/Container";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { CountUp } from "../components/ui/CountUp";
import { ImageReveal } from "../components/ui/ImageReveal";
import { SmartImage } from "../components/ui/SmartImage";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import { Seo } from "../lib/seo";
import { getPlaceholder } from "../lib/images";
import { cmsRepository } from "../lib/cms";
import { cn } from "../lib/cn";

export default function About() {
  const experiences = cmsRepository.getExperiences();
  const content = cmsRepository.getPageContent().about;
  return (
    <>
      <Seo
        title="About AFhomes"
        description="AFhomes is a diversified hospitality and wellness group in the Philippines — spanning eco-tourism, premium food and beverage, and advanced wellness hospitality."
        path="/about"
      />

      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
        imageSpec={content.image.src ? content.image : getPlaceholder("brand-field")}
      />

      {/* Who we are + philosophy + the group in numbers */}
      <section className="bg-cream-100 py-24 sm:py-32">
        <Container>
          <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <SectionHeading
                eyebrow={content.introEyebrow}
                title={content.introTitle}
                lede={content.introLede}
              />

              <Reveal delay={0.14}>
                <blockquote className="mt-10 rounded-[1.25rem] border border-line bg-cream-50 p-8 shadow-soft sm:p-10">
                  <p className="label-caps flex items-center gap-3 text-leaf-700">
                    <span className="h-px w-8 bg-leaf-500" aria-hidden="true" />
                    {content.philosophyTitle}
                  </p>
                  <p className="font-display mt-4 text-3xl leading-snug text-navy-900 italic sm:text-4xl">
                    {content.philosophyBody}
                  </p>
                </blockquote>
              </Reveal>
            </div>

            <div className="lg:col-span-5">
              <Reveal y={40}>
                <ImageReveal
                  spec={getPlaceholder("resort-forest")}
                  ratio="aspect-[4/5]"
                  className="rounded-[1.25rem]"
                />
              </Reveal>
            </div>
          </div>

          {/* Group in numbers */}
          <Reveal delay={0.1}>
            <dl className="mt-20 grid grid-cols-2 gap-x-6 gap-y-10 border-t border-line pt-10 lg:grid-cols-4">
              {content.stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <dd>
                    <CountUp
                      value={Number(stat.value)}
                      minDigits={stat.value.length}
                      className="font-display text-5xl font-medium text-leaf-700 sm:text-6xl"
                    />
                    <span className="mt-3 block max-w-[14rem] text-sm leading-relaxed text-ink-500">
                      {stat.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </Container>
      </section>

      {/* Vision & mission */}
      <section className="bg-cream-200/70 py-24 sm:py-28" aria-labelledby="vision-heading">
        <Container>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-[1.25rem] border border-line bg-cream-50 p-10 shadow-soft">
                <p className="label-caps text-leaf-700">Vision</p>
                <p className="font-display mt-5 text-3xl leading-snug font-medium text-navy-900 text-balance sm:text-4xl">
                  {content.vision}
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="h-full rounded-[1.25rem] border border-line bg-cream-50 p-10 shadow-soft">
                <p className="label-caps text-leaf-700">Mission</p>
                <p className="font-display mt-5 text-3xl leading-snug font-medium text-navy-900 text-balance sm:text-4xl">
                  {content.mission}
                </p>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Development model */}
      <section className="bg-cream-100 py-24 sm:py-32" aria-labelledby="model-heading">
        <Container>
          <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                id="model-heading"
                eyebrow={content.modelEyebrow}
                title={content.modelTitle}
                lede={content.modelLede}
              />
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.1}>
                <p className="text-xl leading-relaxed text-ink-600 text-pretty">
                  {content.modelBody}
                </p>
              </Reveal>
              <ol className="mt-10 space-y-0">
                {content.modelChapters.map((chapter, index) => (
                  <li key={chapter.number} className="relative">
                    {index < 2 && (
                      <span
                        className="absolute top-12 left-[1.3rem] h-[calc(100%-3rem)] w-px bg-line sm:left-[1.55rem]"
                        aria-hidden="true"
                      />
                    )}
                    <Reveal delay={index * 0.08} y={24}>
                      <div className="group relative flex gap-6 py-7 sm:gap-8">
                        <span className="font-display text-4xl font-medium text-line group-hover:text-leaf-600 sm:text-5xl italic">
                          {chapter.number}
                        </span>
                        <div className="border-b border-line pb-7">
                          <h3 className="font-display text-2xl font-medium text-navy-900 transition-colors group-hover:text-leaf-700">
                            {chapter.title}
                          </h3>
                          <p className="mt-3 max-w-xl leading-relaxed text-ink-600">
                            {chapter.body}
                          </p>
                        </div>
                      </div>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Container>
      </section>

      {/* Current operations */}
      <section className="bg-cream-200/70 py-24 sm:py-28" aria-labelledby="operations-heading">
        <Container>
          <SectionHeading
            id="operations-heading"
            eyebrow={content.operationsEyebrow}
            title={content.operationsTitle}
          />

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {experiences.map((experience, index) => (
              <Reveal key={experience.id} delay={index * 0.08} y={28}>
                <article className="group flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-line bg-cream-50 shadow-soft transition-shadow hover:shadow-lift">
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <SmartImage
                      spec={experience.image}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-navy-950/60 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <StatusBadge
                        status={experience.status}
                        label={experience.statusLabel}
                        className="border-white/20 bg-white/10 text-cream-100 backdrop-blur-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-7">
                    <h3 className="font-display text-2xl font-medium text-navy-900">
                      {experience.name}
                    </h3>
                    <p className="mt-2 text-sm text-ink-500">{experience.location}</p>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-600">
                      {experience.summary}
                    </p>
                    <Button
                      to={`/experiences/${experience.slug}`}
                      variant="text"
                      size="sm"
                      withArrow
                      className={cn("mt-5 self-start")}
                    >
                      {experience.actionLabel}
                    </Button>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-navy-950 py-20 text-cream-50 sm:py-24">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] border border-white/10 bg-navy-900/60 p-10 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                {content.familyHeading}
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-200/75">
                {content.familyLede}
              </p>
            </div>
            <Button to="/contact" variant="accent" size="lg" withArrow>
              {content.familyButton}
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
