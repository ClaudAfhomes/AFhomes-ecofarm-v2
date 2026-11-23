import { Link } from "react-router";
import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { SmartImage } from "../../components/ui/SmartImage";
import { Badge, StatusBadge } from "../../components/ui/Badge";
import { SectionHeading } from "../../components/ui/SectionHeading";
import { ArrowRight } from "../../components/ui/icons";
import { cmsRepository } from "../../lib/cms";
import { useCmsRevision } from "../../hooks/useCmsRevision";
import type { Experience } from "../../types/experience";

const verbs: Record<string, string> = {
  "alm-japanese-restaurant": "Dine",
  "smart-wellness-hotel": "Stay",
  "hotspring-ecofarm-resort": "Escape",
};

const chipTone: Record<string, string> = {
  "alm-japanese-restaurant": "bg-white/15 text-cream-50 border-white/25",
  "smart-wellness-hotel": "bg-gold-100/80 text-[#8a6510]",
  "hotspring-ecofarm-resort": "bg-cyan-100/80 text-cyan-700",
};

function supportingPanel(experience: Experience, surface: string) {
  return (
    <Reveal y={32}>
      <article className="group flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-line bg-cream-50 shadow-subtle transition-shadow duration-300 hover:shadow-lift">
        <Link
          to={`/experiences/${experience.slug}`}
          className="relative block aspect-[16/10] overflow-hidden"
          data-cursor="view"
        >
          <SmartImage
            spec={experience.image}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.045]"
            sizes="(max-width: 1024px) 100vw, 40vw"
          />
        </Link>
        <div className={`flex flex-1 flex-col p-7 sm:p-8 ${surface}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="label-caps text-leaf-700">
              {verbs[experience.id] ?? "Experience"}
            </p>
            <span
              className={`label-caps rounded-full border px-3 py-1.5 ${chipTone[experience.id] ?? "border-leaf-300 bg-leaf-100 text-pine-900"}`}
            >
              {experience.statusLabel}
            </span>
          </div>
          <h3 className="font-display mt-4 text-3xl leading-tight font-medium text-navy-900 text-balance">
            <Link
              to={`/experiences/${experience.slug}`}
              className="transition-colors group-hover:text-leaf-700"
            >
              {experience.name}
            </Link>
          </h3>
          <p className="mt-3 flex-1 text-[0.95rem] leading-relaxed text-ink-600 text-pretty">
            {experience.summary}
          </p>
          <Link
            to={`/experiences/${experience.slug}`}
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-navy-900 transition-colors group-hover:text-leaf-700"
          >
            {experience.actionLabel}
            <ArrowRight className="h-4 w-4 text-leaf-600 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </article>
    </Reveal>
  );
}

export function Ecosystem() {
  useCmsRevision();
  const experiences = cmsRepository.getExperiences();
  const [featuredExperience, ...supportingExperiences] = experiences;

  return (
    <section
      className="bg-cream-50 py-24 sm:py-32 lg:py-36"
      aria-labelledby="ecosystem-heading"
    >
      <Container>
        <SectionHeading
          id="ecosystem-heading"
          eyebrow={cmsRepository.getPageContent().home.ecosystemEyebrow}
          title={cmsRepository.getPageContent().home.ecosystemTitle}
          lede={cmsRepository.getPageContent().home.ecosystemLede}
        />

        <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8 sm:mt-20">
          {featuredExperience && (
            <Reveal y={40} className="h-full lg:col-span-7 lg:row-span-2">
              <article className="group relative h-full overflow-hidden rounded-[1.25rem]">
                <Link
                  to={`/experiences/${featuredExperience.slug}`}
                  className="block h-full"
                  data-cursor="view"
                >
                  <SmartImage
                    spec={featuredExperience.image}
                    priority
                    className="aspect-[4/3] h-full w-full object-cover transition-transform duration-1000 group-hover:scale-[1.05] lg:aspect-auto"
                    sizes="(max-width: 1024px) 100vw, 58vw"
                  />
                  <span
                    className="absolute inset-0 bg-gradient-to-t from-pine-950/90 via-pine-950/25 to-pine-950/10"
                    aria-hidden="true"
                  />
                  <span className="absolute inset-0 flex flex-col justify-end p-8 text-cream-50 sm:p-10">
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="label-caps text-leaf-300">
                        {verbs[featuredExperience.id] ?? "Experience"}
                      </span>
                      {featuredExperience.featured && (
                        <Badge tone="gold">Featured</Badge>
                      )}
                      <StatusBadge
                        status={featuredExperience.status}
                        label={featuredExperience.statusLabel}
                        tone="dark"
                        className="border-white/20 bg-white/10 backdrop-blur-md"
                      />
                    </span>
                    <h3 className="font-display mt-4 max-w-xl text-3xl leading-[1.08] font-medium text-balance text-cream-50 sm:text-5xl">
                      {featuredExperience.name}
                    </h3>
                    <span className="mt-3 max-w-lg text-[0.95rem] leading-relaxed text-cream-200/80 text-pretty">
                      {featuredExperience.summary}
                    </span>
                    <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-cream-50 transition-colors duration-300 group-hover:text-leaf-300">
                      {featuredExperience.actionLabel}
                      <ArrowRight className="h-4 w-4 text-leaf-300 transition-transform duration-300 group-hover:translate-x-1" />
                    </span>
                  </span>
                </Link>
              </article>
            </Reveal>
          )}

          {supportingExperiences.map((experience, index) => (
            <div key={experience.id} className="lg:col-span-5">
              {supportingPanel(
                experience,
                index % 2 ? "bg-sage-100" : "bg-cream-50",
              )}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
