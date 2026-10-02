import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Mostra um indicador de progresso e bloqueia novos cliques. */
  loading?: boolean;
  icon?: ReactNode;
  /** Ícone exibido depois do texto (por exemplo, seta de avanço). */
  iconRight?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children && <span className={styles.label}>{children}</span>}
      {iconRight}
    </button>
  );
}

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Descrição da ação, lida por leitores de tela e exibida ao passar o mouse. */
  label: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'danger';
}

export function IconButton({ label, size = 'md', tone = 'default', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.iconButton, styles[`icon-${size}`], tone === 'danger' && styles.iconDanger, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
