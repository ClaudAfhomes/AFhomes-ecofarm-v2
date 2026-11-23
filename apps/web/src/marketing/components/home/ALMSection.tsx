import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { CountUp } from "../../components/ui/CountUp";
import { StatusBadge } from "../../components/ui/Badge";
import { ImageReveal } from "../../components/ui/ImageReveal";
import { Button } from "../../components/ui/Button";
import { getPlaceholder } from "../../lib/images";
import { cmsRepository } from "../../lib/cms";
import { useCmsRevision } from "../../hooks/useCmsRevision";

export function ALMSection() {
  useCmsRevision();
  const content = cmsRepository.getPageContent().home;
  const experience = cmsRepository.getExperiences().find((item) => item.id === "alm-japanese-restaurant");
  return (
    <section
      className="relative overflow-hidden bg-[#14100e] py-24 text-cream-100 sm:py-32 lg:py-36"
      aria-labelledby="alm-heading"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(70%_50%_at_15%_100%,rgba(244,150,107,0.14),transparent)]"
        aria-hidden="true"
      />

      <Container className="relative">
        <div className="grid grid-cols-1 items-start gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <Reveal>
              <StatusBadge
                status="open"
                label={content.almBadge}
                tone="dark"
                className="border-white/20 bg-white/10 backdrop-blur-md"
              />
            </Reveal>
            <Reveal delay={0.05}>
              <div className="mt-8 flex items-baseline gap-4">
                <CountUp
                  value={600}
                  duration={1}
                  className="font-display text-7xl leading-none font-medium text-coral-400 sm:text-8xl"
                />
                <span className="label-caps max-w-32 text-cream-200/60">
                  sqm of Japanese dining in Alaminos, Laguna
                </span>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <h2
                id="alm-heading"
                className="font-display mt-7 text-5xl leading-[1.02] font-medium text-balance text-cream-50 sm:text-6xl"
              >
                {content.almTitle}
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="text-body-lg mt-7 max-w-xl text-cream-200/75 text-pretty">
                {content.almLede}
              </p>
            </Reveal>

            <Reveal delay={0.22}>
              <dl className="mt-10 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                {content.almFeatures.map((feature) => (
                  <div key={feature.label} className="border-l-2 border-coral-500/60 pl-4">
                    <dt className="font-display text-xl font-medium text-cream-50">
                      {feature.label}
                    </dt>
                    <dd className="mt-1 text-sm text-cream-200/60">{feature.note}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal delay={0.28}>
              <Button
                to="/experiences/alm-japanese-restaurant"
                variant="accent"
                size="md"
                withArrow
                className="mt-10"
              >
                {content.almButton}
              </Button>
            </Reveal>
          </div>

          <div className="relative lg:col-span-6">
            <Reveal y={40}>
                <ImageReveal
                spec={experience?.image ?? getPlaceholder("alm-teppanyaki")}
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
                <p className="font-display mt-4 text-right text-lg text-cream-200/60 italic">
                  {content.almImageNote}
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}