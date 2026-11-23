import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { ArrowRight } from '../../components/ui/icons';
import { buttonClassName, type ButtonVariant } from '@afhomes/ui';
import styles from './Button.module.css';

type Variant =
  'primary' | 'accent' | 'secondary' | 'outline' | 'outline-light' | 'ghost-light' | 'text';
type Size = 'sm' | 'md' | 'lg';

const base = 'group/btn relative';

// Preserve existing call-site vocabulary while sharing the operational system.
const variants: Record<Variant, ButtonVariant> = {
  primary: 'primary',
  accent: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  'outline-light': 'secondary',
  'ghost-light': 'secondary',
  text: 'ghost',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  withArrow?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ComponentPropsWithoutRef<'button'>, keyof CommonProps> & {
    to?: undefined;
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof CommonProps> & {
    to: string;
    href?: undefined;
  };

type ButtonAsAnchor = CommonProps &
  Omit<ComponentPropsWithoutRef<'a'>, keyof CommonProps> & {
    href: string;
    to?: undefined;
  };

type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

export function Button({
  variant = 'primary',
  size = 'md',
  withArrow = false,
  className,
  children,
  ...props
}: ButtonProps) {
  // Pill + elevation finish for every marketing action except the flat `text`
  // variant, which stays an unadorned inline link.
  const classes = cn(
    base,
    buttonClassName(variants[variant], size),
    variant === 'text' ? undefined : styles.action,
    className,
  );

  const inner = (
    <>
      <span>{children}</span>
      {withArrow && (
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover/btn:translate-x-1" />
      )}
    </>
  );

  if ('to' in props && props.to !== undefined) {
    const { to, ...linkProps } = props as ButtonAsLink;
    return (
      <Link to={to} className={classes} {...linkProps}>
        {inner}
      </Link>
    );
  }

  if ('href' in props && props.href !== undefined) {
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
