import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './Button.module.css';

export type ButtonLinkVariant = 'primary' | 'secondary' | 'ghost' | 'light' | 'outlineLight';

interface ButtonLinkBaseProps {
  variant?: ButtonLinkVariant;
  children: ReactNode;
}

export interface ButtonLinkAsRouteProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>, ButtonLinkBaseProps {
  /** Internal route - renders a router `Link`. */
  to: string;
  href?: never;
}

export interface ButtonLinkAsExternalProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>, ButtonLinkBaseProps {
  to?: never;
  href: string;
}

export type ButtonLinkProps = ButtonLinkAsRouteProps | ButtonLinkAsExternalProps;

/**
 * Link-styled as a button (DESIGN-SYSTEM §6.1). Renders a router `Link` when
 * `to` is given (the common case for this site's static routes) or a plain
 * anchor when `href` is given. `light` (solid white) and `outlineLight`
 * (white outline) variants are for use on dark brand/hero surfaces.
 *
 * Scroll reset on route change is handled centrally by <ScrollToTop /> in App.
 */
export function ButtonLink({ variant = 'primary', children, className, ...rest }: ButtonLinkProps) {
  const classes = `${styles.button} ${styles[variant]}${className ? ` ${className}` : ''}`;

  if (rest.href !== undefined) {
    const { href, ...anchorProps } = rest;
    return (
      <a href={href} className={classes} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { to, ...linkProps } = rest;
  return (
    <Link to={to} className={classes} {...linkProps}>
      {children}
    </Link>
  );
}
