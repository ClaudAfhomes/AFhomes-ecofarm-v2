import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { CountUp } from "../../components/ui/CountUp";
import { SectionHeading } from "../../components/ui/SectionHeading";
import { SmartImage } from "../../components/ui/SmartImage";
import { Button } from "../../components/ui/Button";
import { getPlaceholder } from "../../lib/images";
import { cmsRepository } from "../../lib/cms";
import { useCmsRevision } from "../../hooks/useCmsRevision";

export function SmartWellnessSection() {
  useCmsRevision();
  const content = cmsRepository.getPageContent().home;
  const experience = cmsRepository.getExperiences().find((item) => item.id === "smart-wellness-hotel");
  return (
    <section
      className="relative overflow-hidden bg-pine-950 py-24 text-cream-100 sm:py-32 lg:py-36"
      aria-labelledby="smart-wellness-heading"
    >
      {/* Ambient glows — calm, not neon */}
      <div
        className="absolute inset-0 bg-[radial-gradient(70%_50%_at_85%_0%,rgba(40,171,197,0.14),transparent)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(50%_40%_at_5%_100%,rgba(87,171,75,0.1),transparent)]"
        aria-hidden="true"
      />

      <Container className="relative">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20">
          {/* Content */}
          <div>
            <SectionHeading
              id="smart-wellness-heading"
              tone="dark"
              eyebrow={content.smartWellnessEyebrow}
              title={content.smartWellnessTitle}
              lede={content.smartWellnessLede}
            />

            <Reveal delay={0.15}>
              <div className="mt-12 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
                {content.smartWellnessRooms.map((room) => (
                  <div key={room.label}>
                    <CountUp
                      value={Number(room.value)}
                      className="font-display text-4xl text-cyan-300 sm:text-5xl"
                    />
                    <p className="mt-2 text-xs font-semibold tracking-wide text-cream-200/70 uppercase">
                      {room.label}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <div className="mt-10 flex flex-col items-start gap-5">
                <span className="label-caps flex items-center gap-2.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-gold-300">
                  <span
                    className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold-400"
                    aria-hidden="true"
                  />
                  {experience?.statusLabel ?? content.smartWellnessStatus}
                </span>
                <Button
                  to="/experiences/smart-wellness-hotel"
                  variant="outline-light"
                  size="md"
                  withArrow
                >
                  {content.smartWellnessButton}
                </Button>
              </div>
            </Reveal>
          </div>

          {/* Visual + feature progression */}
          <div>
            <div className="hidden lg:block">
              <Reveal y={40}>
                <div className="overflow-hidden rounded-[1.25rem]" data-cursor="view">
                  <SmartImage
                    spec={experience?.image ?? getPlaceholder("hotel-room")}
                    className="aspect-[4/3]"
                    priority
                    sizes="(max-width: 768px) 100vw, 44vw"
                  />
                </div>
              </Reveal>
            </div>

            <div className="mt-4 space-y-2 lg:hidden">
              <Reveal y={30}>
                <div className="overflow-hidden rounded-2xl">
                  <SmartImage
                    spec={experience?.image ?? getPlaceholder("hotel-room")}
                    className="aspect-[4/3]"
                    sizes="100vw"
                  />
                </div>
              </Reveal>
            </div>

            <ol className="relative z-10 mt-12 space-y-7 border-t border-white/10 pt-12">
              {content.smartWellnessFeatures.map((feature, index) => (
                <li key={feature.title}>
                  <Reveal delay={index * 0.04} y={28}>
                    <div className="group flex gap-5">
                      <span className="font-display -mt-1 text-lg text-cyan-300/70 italic">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="border-l border-white/10 pb-2 pl-5 transition-colors duration-300 group-hover:border-cyan-400/60">
                        <h3 className="font-display text-2xl font-medium text-cream-50 sm:text-[1.7rem]">
                          {feature.title}
                        </h3>
                        <p className="mt-1.5 max-w-md leading-relaxed text-cream-200/70">
                          {feature.line}
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
  );
}