import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { CountUp } from "../components/ui/CountUp";
import { SmartImage } from "../components/ui/SmartImage";
import { Button } from "../components/ui/Button";
import { ExperienceHero } from "../components/experiences/ExperienceHero";
import { Seo } from "../lib/seo";
import { getPlaceholder } from "../lib/images";
import { cmsRepository } from "../lib/cms";

const rooms = [
  { label: "Rooms in total", value: "18", note: "An intimate, boutique scale" },
  { label: "Signature Suite", value: "1", note: "The hotel's defining stay" },
  { label: "Smart Wellness Rooms", value: "17", note: "Intelligence built into rest" },
];

const technologies = [
  {
    title: "Non-contact sleep intelligence",
    line: "Sleep is observed without wearables or contact — so nothing comes between a guest and their rest.",
  },
  {
    title: "mmWave sensing",
    line: "Gentle sensing technology supports monitoring of sleep and breathing through the night.",
  },
  {
    title: "Adaptive environmental support",
    line: "The room responds to the night, adjusting its environment to support the guest's recovery.",
  },
  {
    title: "Air-quality monitoring",
    line: "The air a guest breathes is watched quietly in the background of every stay.",
  },
  {
    title: "Oxygen enrichment",
    line: "Atmospheric oxygen enrichment is part of the room's support for deeper restoration.",
  },
  {
    title: "Negative Ion Refreshers",
    line: "Negative ions refresh the air in the room, supporting a cleaner, lighter atmosphere for the night.",
  },
  {
    title: "Smart Sleep Reports",
    line: "Guests receive insight into their sleep — designed to inform, not to overwhelm.",
  },
  {
    title: "Wellness guest analytics",
    line: "Wellness-oriented analytics shape the stay while keeping the guest experience calm and personal.",
  },
];

export default function SmartWellnessHotel() {
  const experience = cmsRepository.getExperiences().find((item) => item.slug === "smart-wellness-hotel");

  if (!experience) return null;

  return (
    <>
      <Seo
        title="Smart Wellness Hotel — Alaminos, Laguna"
        description="An upscale wellness-oriented hotel in Alaminos, Laguna. 18 rooms including 1 Signature Suite and 17 Smart Wellness Rooms. Grand opening November 2026."
        path="/experiences/smart-wellness-hotel"
      />
      <ExperienceHero experience={experience} />

      {/* Statement + room configuration */}
      <section className="bg-cream-100 py-24 sm:py-32" aria-labelledby="hotel-statement-heading">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <SectionHeading
                id="hotel-statement-heading"
                eyebrow="The Concept"
                title="Sleep isn't just rest. It's recovery."
                lede="The AFhomes Smart Wellness Hotel is an upscale, wellness-oriented hotel where rest is designed as carefully as hospitality. Rooms are planned around how people truly sleep — observing, adapting, and supporting without ever getting in the way."
              />
            </div>
            <div className="lg:col-span-5">
              <Reveal delay={0.1} y={40}>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage spec={getPlaceholder("hotel-spa")} className="aspect-[4/3]" priority />
                </div>
              </Reveal>
            </div>
          </div>

          <Reveal delay={0.15}>
            <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {rooms.map((room) => (
                <div
                  key={room.label}
                  className="rounded-2xl border border-line bg-cream-50 p-8 shadow-soft"
                >
                  <p className="font-display text-6xl font-medium text-cyan-600">
                    <CountUp value={Number(room.value)} />
                  </p>
                  <p className="mt-3 font-display text-2xl font-medium text-navy-900">{room.label}</p>
                  <p className="mt-2 text-sm text-ink-500">{room.note}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      {/* The stay, in four quiet movements */}
      <section className="border-y border-line bg-cream-200/70 py-20 sm:py-24" aria-label="The stay, in four quiet movements">
        <Container>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {[
              {
                number: "01",
                title: "Arrive",
                body: "The lounge settles you in — a calm center where the stay begins to slow down.",
              },
              {
                number: "02",
                title: "Unwind",
                body: "The room takes its cue from you, adjusting light and environment as the evening unfolds.",
              },
              {
                number: "03",
                title: "Sleep",
                body: "Non-contact sensing watches the night gently — sleep observed without wearables or interruption.",
              },
              {
                number: "04",
                title: "Wake",
                body: "Smart sleep reports and morning insights shape the day, informed without overwhelm.",
              },
            ].map((movement, index) => (
              <Reveal key={movement.number} delay={index * 0.08} y={24}>
                <div className="border-t border-line pt-6">
                  <span className="font-display text-sm text-cyan-600 italic">
                    {movement.number}
                  </span>
                  <h3 className="font-display mt-2 text-2xl font-medium text-navy-900">
                    {movement.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{movement.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Immersive technology storytelling */}
      <section
        className="relative overflow-hidden bg-navy-950 py-24 text-cream-100 sm:py-32"
        aria-labelledby="hotel-tech-heading"
      >
        <div
          className="absolute inset-0 bg-[radial-gradient(80%_60%_at_85%_10%,rgba(40,171,197,0.14),transparent)]"
          aria-hidden="true"
        />
        <Container className="relative">
          <SectionHeading
            id="hotel-tech-heading"
            tone="dark"
            eyebrow="Smart Wellness"
            title="Intelligence that works while you sleep."
            lede="A connected, supportive room concept — technology layered quietly beneath the surface of a calm, homestyle stay."
          />

          <div className="mt-16 grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20">
            <div className="order-2 lg:order-1">
              <ol className="space-y-10">
                {technologies.map((tech, index) => (
                  <li key={tech.title}>
                    <Reveal delay={index * 0.05} y={30}>
                      <div className="group flex gap-5">
                        <span className="font-display -mt-1 text-lg text-cyan-300/70 italic">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="border-l border-white/10 pb-2 pl-5 transition-colors duration-300 group-hover:border-cyan-400/60">
                          <h3 className="font-display text-2xl font-medium text-cream-50 sm:text-3xl">
                            {tech.title}
                          </h3>
                          <p className="mt-2 max-w-md leading-relaxed text-cream-200/70">{tech.line}</p>
                        </div>
                      </div>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>

            <div className="order-1 lg:order-2">
              <div className="sticky top-28 hidden lg:block">
                <Reveal y={40}>
                  <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                    <SmartImage spec={getPlaceholder("hotel-room")} className="aspect-[4/5]" priority />
                  </div>
                </Reveal>
                <Reveal delay={0.15}>
                  <p className="font-display mt-5 text-xl text-cream-200/60 italic">
                    The room as a quiet partner in recovery.
                  </p>
                </Reveal>
              </div>
              <div className="lg:hidden">
                <Reveal y={30}>
                  <div className="overflow-hidden rounded-2xl">
                    <SmartImage spec={getPlaceholder("hotel-room")} className="aspect-[4/3]" />
                  </div>
                </Reveal>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Lounge + opening note */}
      <section className="bg-cream-200/70 py-24 sm:py-28">
        <Container>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage spec={getPlaceholder("hotel-lounge")} className="aspect-[4/3]" />
                </div>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal>
                <p className="label-caps flex items-center gap-3 text-ink-500">
                  <span className="h-px w-8 bg-cyan-500" aria-hidden="true" />
                  Smart Wellness Lounge
                </p>
              </Reveal>
              <Reveal delay={0.05}>
                <h2 className="font-display mt-5 text-4xl leading-tight font-medium text-navy-900 text-balance sm:text-5xl">
                  A calm heart for the stay.
                </h2>
              </Reveal>
              <Reveal delay={0.12}>
                <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-600 text-pretty">
                  The Smart Wellness Hotel Lounge is planned as the social and restful center
                  of the hotel — a place to arrive, reconnect, and begin unwinding the moment
                  you walk in.
                </p>
              </Reveal>

              <Reveal delay={0.18}>
                <p className="mt-8 rounded-2xl border border-gold-500/30 bg-gold-100/60 p-6 text-ink-800">
                  <span className="font-semibold">Grand Opening — November 2026.</span>{" "}
                  Registration of interest opens soon. Reach out through our contact page and
                  we'll keep you updated on pre-opening details.
                </p>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Next step */}
      <section className="bg-cream-100 py-20 sm:py-24">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] bg-navy-900 p-10 text-cream-50 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                Looking forward to your stay.
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-200/75">
                Ask us anything about the Smart Wellness Hotel, the lounge, or how to be among
                the first to experience it.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button to="/contact" variant="accent" size="lg" withArrow>
                Enquire now
              </Button>
              <Button to="/vip" variant="outline-light" size="lg">
                VIP Privilege
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}