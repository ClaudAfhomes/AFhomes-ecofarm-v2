import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { ArrowRight } from "../../components/ui/icons";

type Variant =
  | "primary"
  | "accent"
  | "secondary"
  | "outline"
  | "outline-light"
  | "ghost-light"
  | "text";
type Size = "sm" | "md" | "lg";

const base =
  "group/btn relative inline-flex items-center justify-center gap-2.5 font-semibold tracking-wide transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:pointer-events-none disabled:opacity-50 rounded-full motion-safe:active:scale-[0.98]";

const variants: Record<Variant, string> = {
  /* Deep forest green — primary action, luxury restraint */
  primary:
    "bg-pine-800 text-cream-50 hover:bg-pine-700 active:bg-pine-900 focus-visible:outline-leaf-500",
  /* AFhomes green — brand CTA */
  accent:
    "bg-leaf-500 text-pine-950 hover:bg-leaf-400 active:bg-leaf-600 focus-visible:outline-pine-800",
  /* Deep navy — premium dark contexts */
  secondary:
    "bg-navy-800 text-cream-50 hover:bg-navy-700 active:bg-navy-900 focus-visible:outline-leaf-500",
  outline:
    "border border-leaf-700/25 text-pine-900 hover:border-pine-800 hover:bg-pine-800 hover:text-cream-50 focus-visible:outline-leaf-500",
  "outline-light":
    "border border-cream-50/40 text-cream-50 hover:border-cream-50 hover:bg-cream-50 hover:text-pine-950 focus-visible:outline-leaf-300",
  "ghost-light":
    "text-cream-50 hover:text-leaf-300 focus-visible:outline-leaf-300",
  text: "text-pine-900 hover:text-leaf-700 focus-visible:outline-leaf-500",
};

const sizes: Record<Size, string> = {
  sm: "px-5 py-2.5 text-sm",
  md: "px-7 py-3.5 text-sm",
  lg: "px-8 py-4 text-base",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  withArrow?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps> & {
    to?: undefined;
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof CommonProps> & {
    to: string;
    href?: undefined;
  };

type ButtonAsAnchor = CommonProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof CommonProps> & {
    href: string;
    to?: undefined;
  };

type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

export function Button({
  variant = "primary",
  size = "md",
  withArrow = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);

  const inner = (
    <>
      <span>{children}</span>
      {withArrow && (
        <ArrowRight
          className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover/btn:translate-x-1"
        />
      )}
    </>
  );

  if ("to" in props && props.to !== undefined) {
    const { to, ...linkProps } = props as ButtonAsLink;
    return (
      <Link to={to} className={classes} {...linkProps}>
        {inner}
      </Link>
    );
  }

  if ("href" in props && props.href !== undefined) {
    const { href, ...anchorProps } = props as ButtonAsAnchor;
    return (
      <a href={href} className={classes} {...anchorProps}>
        {inner}
      </a>
    );
  }

  return (
    <button className={classes} {...(props as ButtonAsButton)}>
      {inner}
    </button>
  );
}