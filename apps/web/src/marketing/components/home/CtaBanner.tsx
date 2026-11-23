import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { Button } from "../../components/ui/Button";
import { SmartImage } from "../../components/ui/SmartImage";
import { cmsRepository } from "../../lib/cms";
import { getPlaceholder } from "../../lib/images";

export function CtaBanner() {
  const content = cmsRepository.getPageContent().home;
  return (
    <section className="relative flex items-center overflow-hidden bg-pine-950 py-24 text-cream-50 sm:py-36">
      <SmartImage
        spec={getPlaceholder("resort-hero")}
        priority
        className="absolute inset-0 h-full w-full object-cover object-center"
        sizes="100vw"
      />
      <div
        className="absolute inset-0 bg-linear-to-b from-pine-950/90 via-pine-950/60 to-pine-950/90"
        aria-hidden="true"
      />

      <Container className="relative">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="label-caps flex items-center justify-center gap-3 text-leaf-300">
              <span className="h-px w-8 bg-leaf-500" aria-hidden="true" />
              {content.ctaEyebrow}
              <span className="h-px w-8 bg-leaf-500" aria-hidden="true" />
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h2 className="font-display mt-8 text-5xl leading-[1.02] font-medium text-balance sm:text-6xl lg:text-7xl">
              {content.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="text-body-lg mt-6 text-cream-200/80 text-pretty">
              {content.ctaLede}
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Button to="/experiences" variant="accent" size="lg" withArrow>
                {content.ctaPrimaryCta}
              </Button>
              <Button to="/contact" variant="outline-light" size="lg">
                {content.ctaSecondaryCta}
              </Button>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}