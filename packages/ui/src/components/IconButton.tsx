import type { ButtonHTMLAttributes } from 'react';

import { Icon, type IconName } from './Icon';
import { Button, type ButtonVariant } from './Button';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  variant?: ButtonVariant;
}

/** Icon-only button with an accessible name (40px target, DESIGN-SYSTEM §7.4). */
export function IconButton({
  icon,
  label,
  size = 20,
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      className={`${styles.iconButton} ${className ?? ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </Button>
  );
}
