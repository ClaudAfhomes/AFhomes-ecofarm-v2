import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { SmartImage } from "../components/ui/SmartImage";
import { ImageReveal } from "../components/ui/ImageReveal";
import { Button } from "../components/ui/Button";
import { ExperienceHero } from "../components/experiences/ExperienceHero";
import { Seo } from "../lib/seo";
import { getPlaceholder } from "../lib/images";
import { cmsRepository } from "../lib/cms";

const details = [
  {
    title: "Live Teppanyaki",
    body: "The table comes alive as chefs cook, season, and finish every course in front of you — a live culinary performance.",
  },
  {
    title: "Upscale Lounge",
    body: "A relaxed, elevated space for conversations, celebrations, and evenings that extend past dinner.",
  },
  {
    title: "Reception & Entry",
    body: "A dedicated reception area that welcomes you the way home should — warmly, and without hurry.",
  },
  {
    title: "Private Family Gatherings",
    body: "Rooms made for family — birthdays, milestones, and everyday celebrations shared together.",
  },
  {
    title: "Corporate Events",
    body: "Refined, well-served settings for business lunches, dinners, and events that leave an impression.",
  },
  {
    title: "Industrial-Scale Kitchen",
    body: "A dedicated, industrial-scale kitchen behind the scenes keeps quality steady even at full service.",
  },
];

const gallery = [
  { spec: getPlaceholder("alm-cuisine") },
  { spec: getPlaceholder("alm-interior") },
  { spec: getPlaceholder("alm-plating") },
];

export default function ALMJapaneseRestaurant() {
  const experience = cmsRepository.getExperiences().find((item) => item.slug === "alm-japanese-restaurant");

  if (!experience) return null;

  return (
    <>
      <Seo
        title="ALM Japanese Restaurant — Alaminos, Laguna"
        description="A 600 sqm Japanese restaurant in Alaminos, Laguna — live Teppanyaki, upscale lounge, private family gatherings, and corporate events. Now open."
        path="/experiences/alm-japanese-restaurant"
      />
      <ExperienceHero experience={experience} />

      {/* Editorial intro */}
      <section className="relative overflow-hidden bg-[#14100e] py-24 text-cream-100 sm:py-32">
        <div
          className="absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_0%,rgba(244,150,107,0.12),transparent)]"
          aria-hidden="true"
        />
        <Container className="relative">
          <div className="grid grid-cols-1 items-start gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <SectionHeading
                tone="dark"
                eyebrow="Now Open · 600 sqm"
                title="The art of Japanese dining."
                lede="ALM is Japanese dining built for togetherness — from the drama of the teppanyaki counter to the calm of the lounge, every detail serves the shared table."
              />
              <Reveal delay={0.15}>
                <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/10 pt-8">
                  {experience.highlights.slice(0, 5).map((highlight) => (
                    <span key={highlight} className="label-caps text-coral-300">
                      {highlight}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <div className="relative lg:col-span-6">
              <Reveal y={40}>
                <ImageReveal
                  spec={getPlaceholder("alm-teppanyaki")}
                  ratio="aspect-[4/3]"
                  className="rounded-[1.25rem]"
                />
              </Reveal>
              <Reveal delay={0.15} y={30}>
                <div className="relative z-10 -mt-24 ml-auto w-3/5 sm:-mt-28">
                  <ImageReveal
                    spec={getPlaceholder("alm-sushi")}
                    ratio="aspect-square"
                    className="rounded-2xl border-8 border-[#14100e]"
                  />
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Detail grid */}
      <section className="bg-[#1a1512] py-24 text-cream-100 sm:py-28">
        <Container>
          <SectionHeading
            tone="dark"
            eyebrow="Inside ALM"
            title="Crafted for every occasion."
          />
          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {details.map((detail, index) => (
              <Reveal key={detail.title} delay={(index % 3) * 0.07}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-8 transition-colors duration-300 hover:border-coral-500/40 hover:bg-white/[0.05]">
                  <span className="font-display text-sm text-coral-400 italic">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display mt-3 text-2xl font-medium text-cream-50">{detail.title}</h3>
                  <p className="mt-3 leading-relaxed text-cream-200/65">{detail.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* An evening at ALM */}
      <section className="relative overflow-hidden bg-[#14100e] py-20 text-cream-100 sm:py-24" aria-label="An evening at ALM, step by step">
        <Container>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {[
              {
                number: "01",
                title: "Arrive",
                body: "Reception meets you the way home should — warmly, and without hurry.",
              },
              {
                number: "02",
                title: "Take the counter",
                body: "Teppanyaki comes alive as chefs cook, season, and finish every course in front of you.",
              },
              {
                number: "03",
                title: "Share the table",
                body: "Family milestones, corporate evenings, and celebrations made for togetherness.",
              },
              {
                number: "04",
                title: "Linger",
                body: "The upscale lounge extends the evening — for conversation and a slower goodbye.",
              },
            ].map((step, index) => (
              <Reveal key={step.number} delay={index * 0.08} y={24}>
                <div className="border-t border-white/15 pt-6">
                  <span className="font-display text-sm text-coral-400 italic">
                    {step.number}
                  </span>
                  <h3 className="font-display mt-2 text-2xl font-medium text-cream-50">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-cream-200/65">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Gallery */}
      <section className="bg-[#14100e] py-24 sm:py-28" aria-label="ALM gallery">
        <Container>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {gallery.map((item, index) => (
              <Reveal key={index} delay={index * 0.08} y={30}>
                <div className="overflow-hidden rounded-2xl" data-cursor="view">
                  <SmartImage spec={item.spec} className="aspect-[3/4]" />
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.15}>
            <div className="mt-16 flex flex-col items-start justify-between gap-8 rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-10 sm:p-12 lg:flex-row lg:items-center">
              <div>
                <h2 className="font-display text-3xl leading-tight font-medium text-balance text-cream-50 sm:text-4xl">
                  Reserve your table at ALM.
                </h2>
                <p className="mt-3 max-w-xl text-cream-200/70">
                  For private family gatherings, corporate events, or an evening of live
                  Teppanyaki — reach out and we'll take care of the rest.
                </p>
              </div>
              <Button to="/contact" variant="accent" size="lg" withArrow>
                Enquire now
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}