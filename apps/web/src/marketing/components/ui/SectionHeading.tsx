import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Eyebrow } from "../../components/ui/Eyebrow";
import { Reveal } from "../../components/ui/Reveal";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  tone?: "light" | "dark";
  align?: "left" | "center";
  /** Optional call-to-action rendered beside the heading (left alignment only). */
  action?: ReactNode;
  className?: string;
  id?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  tone = "light",
  align = "left",
  action,
  className,
  id,
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div id={id} className={cn("max-w-3xl", centered && "mx-auto text-center", className)}>
      {eyebrow && (
        <Reveal>
          <Eyebrow tone={tone} className={cn(centered && "justify-center")}>
            {eyebrow}
          </Eyebrow>
        </Reveal>
      )}
      <div
        className={cn(
          "mt-5 flex flex-col justify-between gap-4",
          !centered && "lg:flex-row lg:items-end",
        )}
      >
        <Reveal delay={0.05}>
          <h2
            className={cn(
              "text-h2 text-balance",
              tone === "dark" ? "text-cream-50" : "text-navy-900",
            )}
          >
            {title}
          </h2>
        </Reveal>
        {action && !centered && <div className="shrink-0">{action}</div>}
      </div>
      {lede && (
        <Reveal delay={0.12}>
          <p
            className={cn(
              "text-body-lg mt-6 max-w-2xl text-pretty",
              centered && "mx-auto",
              tone === "dark" ? "text-cream-200/85" : "text-ink-600",
            )}
          >
            {lede}
          </p>
        </Reveal>
      )}
    </div>
  );
}