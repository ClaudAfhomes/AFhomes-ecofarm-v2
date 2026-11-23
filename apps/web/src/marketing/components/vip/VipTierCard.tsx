import { TiltCard } from "../../components/vip/TiltCard";
import { Check } from "../../components/ui/icons";
import { SmartImage } from "../../components/ui/SmartImage";
import { getPlaceholder } from "../../lib/images";
import { cn } from "../../lib/cn";
import type { VipPlan } from "../../types/vip";

interface VipTierCardProps {
  plan: VipPlan;
}

/** Membership card treatments — informative card, not a photo of the physical card. */
const tierStyle: Record<
  VipPlan["id"],
  { card: string; glow: string; name: string; figure: string; value: string }
> = {
  gold: {
    card: "border-gold-500/40 bg-gradient-to-br from-navy-800 via-navy-950 to-navy-950",
    glow: "bg-[radial-gradient(90%_60%_at_85%_0%,rgba(251,199,94,0.22),transparent)]",
    name: "text-gold-400",
    figure: "text-gold-300",
    value: "text-cream-50",
  },
  silver: {
    card: "border-cream-200/30 bg-gradient-to-br from-navy-700/70 via-navy-950 to-navy-950",
    glow: "bg-[radial-gradient(90%_60%_at_85%_0%,rgba(207,213,236,0.18),transparent)]",
    name: "text-cream-100",
    figure: "text-cream-100",
    value: "text-cream-50",
  },
  bronze: {
    card: "border-coral-500/30 bg-gradient-to-br from-coral-600/25 via-navy-950 to-navy-950",
    glow: "bg-[radial-gradient(90%_60%_at_85%_0%,rgba(246,148,107,0.18),transparent)]",
    name: "text-coral-300",
    figure: "text-coral-200",
    value: "text-cream-50",
  },
};

export function VipTierCard({ plan }: VipTierCardProps) {
  const style = tierStyle[plan.id] ?? tierStyle.silver;
  const defaultImage =
    plan.id === "gold" || plan.id === "silver" || plan.id === "bronze"
      ? getPlaceholder(`vip-card-${plan.id}`)
      : getPlaceholder("vip-card-silver");

  return (
    <TiltCard className="h-full">
      <article
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border p-8 shadow-lift sm:p-10",
          style.card,
        )}
      >
        <div
          className={cn("pointer-events-none absolute inset-0", style.glow)}
          aria-hidden="true"
        />

        <div className="relative">
          <div className="overflow-hidden rounded-xl border border-white/10">
            <SmartImage
              spec={plan.image ?? defaultImage}
              className="aspect-[2560/1597] w-full"
              imgClassName="object-cover"
              sizes="(max-width: 768px) 100vw, 33vw"
            />
          </div>
        </div>

        <div className="relative mt-6 flex items-center justify-between">
          <p className="label-caps text-cream-200/60">VIP Privilege</p>
          {plan.featured && (
            <span className="label-caps rounded-full bg-gold-500 px-3 py-1.5 text-navy-950">
              Flagship tier
            </span>
          )}
        </div>

        <p
          className={cn(
            "font-display mt-5 text-3xl font-semibold tracking-wide uppercase",
            style.name,
          )}
        >
          {plan.name}
        </p>

        <div className="mt-7 flex items-end gap-3">
          <span
            className={cn("font-display text-7xl leading-none font-medium", style.figure)}
          >
            {plan.discountPercent}%
          </span>
          <div className="pb-1.5">
            <p className="text-sm font-semibold text-cream-200/70">fixed VIP discount</p>
            <span
              className={cn(
                "label-caps mt-2 inline-block rounded-full px-2.5 py-1 text-navy-950",
                plan.accentBg,
              )}
            >
              {plan.validityYears}-year validity
            </span>
          </div>
        </div>

        <dl className="mt-8 grid grid-cols-1 gap-5 border-t border-white/10 pt-8 sm:grid-cols-2">
          <div>
            <dt className="label-caps text-cream-200/50">Loyalty stay points</dt>
            <dd className={cn("font-display mt-1 text-2xl font-medium", style.value)}>
              {plan.pointsPerYear.toLocaleString()} / year
            </dd>
          </div>
          <div>
            <dt className="label-caps text-cream-200/50">Over the term</dt>
            <dd className={cn("font-display mt-1 text-2xl font-medium", style.figure)}>
              {plan.totalPoints.toLocaleString()} total
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-sm leading-relaxed text-cream-200/60">
          {plan.cardholders}
        </p>

        <ul className="mt-7 space-y-3 border-t border-white/10 pt-7">
          {plan.benefits
            .filter(
              (benefit) =>
                benefit !== plan.cardholders &&
                !benefit.startsWith(`${plan.discountPercent}%`) &&
                !/year/.test(benefit),
            )
            .map((benefit) => (
              <li key={benefit} className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-navy-950",
                    plan.accentBg,
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="text-sm leading-relaxed text-cream-200/75">
                  {benefit}
                </span>
              </li>
            ))}
        </ul>
      </article>
    </TiltCard>
  );
}