import { Container } from "../components/ui/Container";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { Button } from "../components/ui/Button";
import { VipTierCard } from "../components/vip/VipTierCard";
import { LoadingState, ErrorState } from "../components/ui/Feedback";
import { Seo } from "../lib/seo";
import { useEffect } from "react";
import { useAsync } from "../hooks/useAsync";
import { vipService } from "../services/vipService";
import { cmsRepository } from "../lib/cms";

export default function VIPPrivilege() {
  const { data: plans, loading, error, retry } = useAsync(() => vipService.getPlans());
  const content = cmsRepository.getPageContent().vip;

  useEffect(() => {
    const refreshVipPlans = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== "vip") return;
      retry();
    };

    window.addEventListener("afhomes-cms-updated", refreshVipPlans);
    window.addEventListener("storage", refreshVipPlans);
    return () => {
      window.removeEventListener("afhomes-cms-updated", refreshVipPlans);
      window.removeEventListener("storage", refreshVipPlans);
    };
  }, [retry]);

  return (
    <>
      <Seo
        title="VIP Privilege — Gold, Silver & Bronze"
        description="AFhomes VIP Privilege — fixed VIP discounts, priority reservation rights, welcome gifts, and loyalty stay points across the AFhomes experience."
        path="/vip"
      />

      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
        className="bg-navy-950"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_85%_10%,rgba(251,199,94,0.14),transparent)]"
          aria-hidden="true"
        />
      </PageHeader>

      {/* Tiers */}
      <section className="bg-cream-100 py-24 sm:py-32" aria-labelledby="vip-tiers-heading">
        <Container>
          <SectionHeading
            id="vip-tiers-heading"
            eyebrow={content.tierEyebrow}
            title={content.tierTitle}
            lede={content.tierLede}
          />

          <div className="mt-14 lg:mt-20">
            {loading && <LoadingState label="Loading tiers…" />}
            {error && (
              <ErrorState
                title="Couldn't load VIP tiers"
                message={error.message}
                onRetry={retry}
              />
            )}
            {plans && (
              <div className="grid grid-cols-1 gap-8 pb-10 md:grid-cols-3 md:gap-6 lg:gap-8 lg:pb-14">
                {plans.map((plan, index) => (
                  <Reveal key={plan.id} delay={index * 0.08} y={32}>
                    <VipTierCard plan={plan} />
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-cream-50 py-20 sm:py-24" aria-label="How VIP Privilege works">
        <Container>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
            {content.steps.map((step, index) => (
              <Reveal key={step.number} delay={index * 0.08} y={24}>
                <div className="border-t border-line pt-6">
                  <span className="font-display text-sm text-gold-600 italic">
                    {step.number}
                  </span>
                  <h3 className="font-display mt-2 text-2xl font-medium text-navy-900">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Included benefits */}
      <section className="bg-cream-200/70 py-24 sm:py-28" aria-labelledby="vip-included-heading">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                id="vip-included-heading"
                eyebrow={content.includedEyebrow}
                title={content.includedTitle}
                lede={content.includedLede}
              />
              <Reveal delay={0.15}>
                <Button to="/contact" variant="primary" size="md" withArrow className="mt-8">
                  {content.includedButton}
                </Button>
              </Reveal>
            </div>

            <div className="lg:col-span-7">
              <div className="space-y-4">
                {content.includedItems.map((item, index) => (
                  <Reveal key={item.title} delay={index * 0.07} y={24}>
                    <div className="group flex gap-6 rounded-2xl border border-line bg-cream-50 p-7 transition-colors hover:border-gold-500/40 sm:p-8">
                      <span className="font-display text-lg text-gold-600 italic">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3 className="font-display text-2xl font-medium text-navy-900">
                          {item.title}
                        </h3>
                        <p className="mt-2 max-w-xl leading-relaxed text-ink-600">{item.body}</p>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Transparency */}
      <section className="bg-navy-950 py-24 text-cream-100 sm:py-28" aria-labelledby="vip-transparency-heading">
        <Container>
          <div className="max-w-3xl">
            <SectionHeading
              id="vip-transparency-heading"
              tone="dark"
              eyebrow={content.transparencyEyebrow}
              title={content.transparencyTitle}
            />
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {content.transparencyCards.map((card, index) => <Reveal key={card.title} delay={index * 0.08}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-8">
                <p className="label-caps text-gold-400">{card.title}</p>
                <p className="mt-4 leading-relaxed text-cream-200/80">{card.body}</p>
              </div>
            </Reveal>)}
          </div>

          <Reveal delay={0.12}>
            <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-[1.25rem] bg-gradient-to-br from-navy-800 to-navy-900 p-10 sm:p-12 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-display text-3xl font-medium text-balance sm:text-4xl">
                  {content.transparencyLede}
                </h3>
                <p className="mt-3 max-w-xl text-cream-200/75">
                  {content.transparencyTitle}
                </p>
              </div>
              <Button to="/contact" variant="accent" size="lg" withArrow>
                {content.transparencyButton}
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
