import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { ExperienceStatus } from "../../types/experience";

const statusStyles: Record<ExperienceStatus, { dot: string; text: string; textDark: string }> = {
  open: { dot: "bg-leaf-500", text: "text-leaf-700", textDark: "text-leaf-300" },
  "opening-soon": {
    dot: "bg-gold-500",
    text: "text-[#a47616]",
    textDark: "text-gold-300",
  },
  "in-development": {
    dot: "bg-cyan-500",
    text: "text-cyan-700",
    textDark: "text-cyan-300",
  },
};

interface StatusBadgeProps {
  status: ExperienceStatus;
  label: string;
  /** "dark" for use on image backdrops / dark surfaces. */
  tone?: "light" | "dark";
  className?: string;
}

export function StatusBadge({ status, label, tone = "light", className }: StatusBadgeProps) {
  const style = statusStyles[status];
  return (
    <span
      className={cn(
        "label-caps inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3.5 py-2 backdrop-blur-sm",
        tone === "dark" ? style.textDark : style.text,
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          style.dot,
          status !== "open" && "animate-dot-pulse",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "gold" | "cyan" | "leaf" | "magenta" | "coral";
  className?: string;
}

const badgeTones: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-sage-200 text-pine-800",
  gold: "bg-gold-100 text-[#8a6510]",
  cyan: "bg-cyan-100 text-cyan-700",
  leaf: "bg-leaf-100 text-leaf-700",
  magenta: "bg-magenta-100 text-magenta-700",
  coral: "bg-coral-100 text-coral-700",
};

/** Small category / tag pill. */
export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}