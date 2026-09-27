import { Container } from "../../components/ui/Container";
import { Reveal } from "../../components/ui/Reveal";
import { Button } from "../../components/ui/Button";
import { SmartImage } from "../../components/ui/SmartImage";
import { getPlaceholder } from "../../lib/images";
import { useAsync } from "../../hooks/useAsync";
import { vipService } from "../../services/vipService";
import { LoadingState, ErrorState } from "../../components/ui/Feedback";
import type { VipPlan } from "../../types/vip";
import { cn } from "../../lib/cn";
import { cmsRepository } from "../../lib/cms";
import { useEffect } from "react";

/** Membership card treatments — premium, not a pricing table. */
const tierStyle: Record<
  string,
  { card: string; name: string; figure: string; value: string; chip?: boolean }
> = {
  gold: {
    card: "border-gold-500/40 bg-gradient-to-b from-gold-500/[0.09] via-transparent to-transparent",
    name: "text-gold-400",
    figure: "text-gold-300",
    value: "text-cream-50",
    chip: true,
  },
  silver: {
    card: "border-cream-200/30 bg-white/[0.04]",
    name: "text-cream-100",
    figure: "text-cream-100",
    value: "text-cream-100",
  },
  bronze: {
    card: "border-coral-500/30 bg-coral-500/[0.05]",
    name: "text-coral-300",
    figure: "text-coral-200",
    value: "text-cream-100",
  },
};

function TierCard({ plan, index }: { plan: VipPlan; index: number }) {
  const fallback = { card: "", name: "", figure: "", value: "" };
  const style = tierStyle[plan.id] ?? tierStyle.silver ?? fallback;

  return (
    <Reveal delay={index * 0.08} y={32} className="h-full">
      <article
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border p-8 backdrop-blur-sm",
          style.card,
        )}
      >
        {plan.image && (
          <SmartImage
            spec={plan.image}
            className="mb-6 aspect-[16/9] w-full rounded-xl opacity-90"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        )}
        <div className="flex items-center justify-between">
          <p className={cn("label-caps", style.name)}>VIP tier</p>
          {plan.featured && (
            <span className="label-caps rounded-full bg-gold-500 px-3 py-1.5 text-navy-950">
              Flagship tier
            </span>
          )}
        </div>

        <p className={cn("font-display mt-4 text-3xl font-semibold tracking-wide uppercase", style.name)}>
          {plan.name}
        </p>

        <div className="mt-7 flex items-end gap-3">
          <span className={cn("font-display text-7xl leading-none font-medium", style.figure)}>
            {plan.discountPercent}%
          </span>
          <span className="pb-1.5 text-sm font-semibold text-cream-200/70">
            fixed VIP discount
          </span>
        </div>

        <dl className="mt-8 grid grid-cols-1 gap-5 border-t border-white/10 pt-8 sm:grid-cols-2">
          <div>
            <dt className="label-caps text-cream-200/50">Validity</dt>
            <dd className={cn("font-display mt-1 text-2xl font-medium", style.value)}>
              {plan.validityYears} years
            </dd>
          </div>
          <div>
            <dt className="label-caps text-cream-200/50">Loyalty stay points</dt>
            <dd className={cn("font-display mt-1 text-2xl font-medium", style.value)}>
              {plan.pointsPerYear.toLocaleString()} / year
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label-caps text-cream-200/50">Over the term</dt>
            <dd className={cn("font-display mt-1 text-2xl font-medium", style.figure)}>
              {plan.totalPoints.toLocaleString()} total
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-sm leading-relaxed text-cream-200/60">{plan.cardholders}</p>
      </article>
    </Reveal>
  );
}

export function VipTeaser() {
  const { data: plans, loading, error, retry } = useAsync(() => vipService.getPlans());

  useEffect(() => {
    const refresh = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== "vip") return;
      retry();
    };
    window.addEventListener("afhomes-cms-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("afhomes-cms-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [retry]);

  return (
    <section
      className="relative overflow-hidden bg-navy-950 py-24 text-cream-100 sm:py-32"
      aria-labelledby="vip-teaser-heading"
    >
      <SmartImage
        spec={getPlaceholder("resort-forest")}
        className="absolute inset-0 h-full w-full object-cover opacity-15"
        sizes="100vw"
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-navy-950 via-navy-950/70 to-navy-950"
        aria-hidden="true"
      />

      <Container className="relative">
        <div className="max-w-3xl">
          <Reveal>
            <p className="label-caps flex items-center gap-3 text-gold-400">
              <span className="h-px w-8 bg-gold-500" aria-hidden="true" />
              {cmsRepository.getPageContent().home.vipTeaserEyebrow}
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h2
              id="vip-teaser-heading"
              className="font-display mt-6 text-5xl leading-[1.02] font-medium text-balance text-cream-50 sm:text-6xl"
            >
              {cmsRepository.getPageContent().home.vipTeaserTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="text-body-lg mt-6 max-w-2xl text-cream-200/75 text-pretty">
              {cmsRepository.getPageContent().home.vipTeaserLede}
            </p>
          </Reveal>
        </div>

        <div className="mt-14">
          {loading && <LoadingState label="Loading tiers…" />}
          {error && (
            <ErrorState
              title="Couldn't load VIP tiers"
              message={error.message}
              onRetry={retry}
              className="text-cream-100"
            />
          )}
          {plans && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {plans.map((plan, index) => (
                <TierCard key={plan.id} plan={plan} index={index} />
              ))}
            </div>
          )}
        </div>

        <Reveal delay={0.2}>
          <div className="mt-12">
            <Button to="/vip" variant="accent" size="lg" withArrow>
              {cmsRepository.getPageContent().home.vipTeaserButton}
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}