import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { SectionHeading } from "../../components/ui/SectionHeading";
import { cn } from "../../lib/cn";
import { cmsRepository } from "../../lib/cms";

export function DevelopmentJourney() {
  const content = cmsRepository.getPageContent().home;
  const milestones = content.journeyMilestones;
  return (
    <section className="bg-cream-200/70 py-24 sm:py-32" aria-labelledby="journey-heading">
      <Container>
        <SectionHeading
          id="journey-heading"
          eyebrow={content.journeyEyebrow}
          title={content.journeyTitle}
          lede={content.journeyLede}
        />

        {/* Desktop — editorial horizontal timeline */}
        <ol className="mt-16 hidden lg:grid lg:grid-cols-3">
          {milestones.map((milestone, index) => (
            <li key={milestone.phase} className={cn("relative", index > 0 && "pl-16")}>
              {/* Connecting line */}
              <div
                className={cn(
                  "absolute top-1.5 h-px",
                  index === 0 ? "left-0 right-0" : "-left-16 right-0",
                  index < milestones.length - 1
                    ? "bg-gradient-to-r from-pine-800/40 to-pine-800/10"
                    : "bg-gradient-to-r from-pine-800/40 to-transparent",
                )}
                aria-hidden="true"
              />
              <Reveal delay={index * 0.15} y={30}>
                <div className="relative">
                  <span
                    className={cn("absolute -top-[2.35rem] left-0 h-3 w-3 rounded-full ring-4", milestone.accent, milestone.ring)}
                    aria-hidden="true"
                  />
                  <span className="font-display pointer-events-none absolute -top-16 right-0 text-[5rem] leading-none font-medium text-navy-900/8 select-none">
                    {milestone.ghost}
                  </span>
                  <p className="label-caps text-leaf-700">{milestone.phase}</p>
                  <p className="font-display mt-3 text-3xl leading-tight font-medium text-navy-900 text-balance">
                    {milestone.name}
                  </p>
                  <p className={cn("mt-2 text-sm font-semibold", milestone.text)}>
                    {milestone.note}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        {/* Mobile — vertical timeline */}
        <ol className="relative mt-14 space-y-10 border-l border-pine-800/20 pl-8 lg:hidden">
          {milestones.map((milestone, index) => (
            <li key={milestone.phase} className="relative">
              <span
                className={cn(
                  "absolute top-1.5 -left-[2.15rem] h-3 w-3 rounded-full ring-4",
                  milestone.accent,
                  milestone.ring,
                )}
                aria-hidden="true"
              />
              <Reveal delay={index * 0.08}>
                <p className="label-caps text-leaf-700">{milestone.phase}</p>
                <p className="font-display mt-2 text-3xl font-medium text-navy-900">
                  {milestone.name}
                </p>
                <p className={cn("mt-1.5 text-sm font-semibold", milestone.text)}>
                  {milestone.note}
                </p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}