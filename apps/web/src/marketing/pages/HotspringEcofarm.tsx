import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { Stagger, StaggerItem } from "../components/ui/Stagger";
import { CountUp } from "../components/ui/CountUp";
import { SmartImage } from "../components/ui/SmartImage";
import { ImageReveal } from "../components/ui/ImageReveal";
import { Button } from "../components/ui/Button";
import { ExperienceHero } from "../components/experiences/ExperienceHero";
import { Seo } from "../lib/seo";
import { getPlaceholder } from "../lib/images";
import { cmsRepository } from "../lib/cms";

export default function HotspringEcofarm() {
  const experience = cmsRepository.getExperiences().find((item) => item.slug === "hotspring-ecofarm-resort");

  if (!experience) return null;

  return (
    <>
      <Seo
        title="Hotspring & Ecofarm Resort — Calauan, Laguna"
        description="Approximately 60 hectares in Calauan, Laguna — 10+ natural geothermal springs, an integrated ecofarm, farming education, and family experiences. In development."
        path="/experiences/hotspring-ecofarm-resort"
      />
      <ExperienceHero experience={experience} />

      {/* The landscape */}
      <section className="bg-cream-100 py-24 sm:py-32" aria-labelledby="resort-landscape-heading">
        <Container>
          <Reveal y={40}>
            <ImageReveal
              spec={getPlaceholder("resort-hero")}
              ratio="aspect-[16/9] sm:aspect-[21/9]"
              className="rounded-[1.25rem]"
            />
          </Reveal>

          <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                id="resort-landscape-heading"
                eyebrow="Flagship Vision"
                title="60 hectares of nature, wellness & possibility."
                lede="A master-planned destination in Calauan, Laguna — set against mountain and countryside views, and built around the geothermal gifts of the land."
              />
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.1}>
                <p className="text-xl leading-relaxed text-ink-600 text-pretty">
                  The AFhomes Hotspring &amp; Ecofarm Resort is envisioned as a place where
                  families reconnect, guests restore, and the land teaches. Accommodations,
                  an integrated ecofarm, farming education, nature-based activities, and
                  wellness experiences are planned as part of one expansive landscape.
                </p>
              </Reveal>

              <Stagger delay={0.16} gap={0.08} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StaggerItem className="h-full">
                  <div className="h-full rounded-2xl border border-line bg-cream-50 p-6">
                    <CountUp
                      value={60}
                      className="font-display text-4xl font-medium text-leaf-600"
                    />
                    <p className="mt-2 text-sm font-medium text-navy-900">Approximate hectares</p>
                  </div>
                </StaggerItem>
                <StaggerItem className="h-full">
                  <div className="h-full rounded-2xl border border-line bg-cream-50 p-6">
                    <CountUp
                      value={10}
                      suffix="+"
                      className="font-display text-4xl font-medium text-leaf-600"
                    />
                    <p className="mt-2 text-sm font-medium text-navy-900">
                      Natural geothermal springs
                    </p>
                  </div>
                </StaggerItem>
                <StaggerItem className="h-full">
                  <div className="h-full rounded-2xl border border-line bg-cream-50 p-6">
                    <p className="font-display text-4xl font-medium text-leaf-600 italic">—</p>
                    <p className="mt-2 text-sm font-medium text-navy-900">
                      Mountain &amp; countryside views
                    </p>
                  </div>
                </StaggerItem>
              </Stagger>
            </div>
          </div>

          {/* Planned chapters */}
          <Reveal delay={0.12}>
            <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-8 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-5">
              {[
                "Accommodations",
                "Integrated ecofarm",
                "Farming education",
                "Nature-based activities",
                "Wellness experiences",
              ].map((chapter, index) => (
                <div key={chapter}>
                  <span className="font-display text-sm text-leaf-600 italic">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="font-display mt-2 text-xl font-medium text-navy-900">
                    {chapter}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-sm text-ink-500">
              Planned chapters — each phase is confirmed, coordinated, and announced as
              development progresses.
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Springs + ecofarm */}
      <section className="bg-cream-200/70 py-24 sm:py-28">
        <Container>
          <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage spec={getPlaceholder("resort-spring")} className="aspect-[4/3]" />
                </div>
              </Reveal>
              <Reveal delay={0.12}>
                <h2 className="font-display mt-7 text-3xl leading-tight font-medium text-navy-900 sm:text-4xl">
                  Ten-plus reasons the land is special.
                </h2>
                <p className="mt-4 max-w-xl leading-relaxed text-ink-600 text-pretty">
                  More than ten natural geothermal spring sources rise from this landscape —
                  a rare advantage the resort is being planned to honor gently, and to build
                  wellness experiences around.
                </p>
              </Reveal>
            </div>

            <div>
              <Reveal>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage spec={getPlaceholder("resort-farm")} className="aspect-[4/3]" />
                </div>
              </Reveal>
              <Reveal delay={0.12}>
                <h2 className="font-display mt-7 text-3xl leading-tight font-medium text-navy-900 sm:text-4xl">
                  An ecofarm that grows understanding.
                </h2>
                <p className="mt-4 max-w-xl leading-relaxed text-ink-600 text-pretty">
                  Integrated into the resort, the ecofarm is planned as a place for farming
                  education and nature-based activities — where families learn where food
                  comes from, and where care for the environment becomes part of the visit.
                </p>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Responsible development */}
      <section className="bg-cream-100 py-24 sm:py-28">
        <Container>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <Reveal>
                <p className="label-caps flex items-center gap-3 text-ink-500">
                  <span className="h-px w-8 bg-leaf-500" aria-hidden="true" />
                  Responsible Development
                </p>
              </Reveal>
              <Reveal delay={0.05}>
                <h2 className="font-display mt-5 text-4xl leading-tight font-medium text-navy-900 text-balance sm:text-5xl">
                  Built the way the land deserves — phase by phase.
                </h2>
              </Reveal>
              <Reveal delay={0.12}>
                <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-600 text-pretty">
                  The resort is in development. Progress is intended to happen phase by
                  phase, guided by environmental and governmental compliance at every step.
                  We will only present the project as operational when it truly is.
                </p>
              </Reveal>
              <Reveal delay={0.18}>
                <p className="mt-8 rounded-2xl border border-cyan-500/25 bg-cyan-100/50 p-6 text-sm leading-relaxed text-cyan-700">
                  <span className="font-semibold">Status: In Development.</span> Opening
                  phases and timelines will be announced as they are confirmed. This page
                  will be updated as the project progresses.
                </p>
              </Reveal>
            </div>

            <div className="lg:col-span-5">
              <Reveal y={40}>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage spec={getPlaceholder("resort-valley")} className="aspect-[4/5]" />
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="bg-cream-200/70 py-20 sm:py-24">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] bg-leaf-700/95 p-10 text-cream-50 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                Help us grow this vision.
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-100/85">
                Follow the AFhomes journey. Ask us about the resort, the ecofarm, or the
                future — and be part of the conversation as it unfolds.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button to="/contact" variant="accent" size="lg" withArrow>
                Enquire now
              </Button>
              <Button to="/stories" variant="outline-light" size="lg">
                Read the journey
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}