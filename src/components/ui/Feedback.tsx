import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Feedback.module.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/** Estado vazio: explica o que falta e oferece o próximo passo. */
export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.compact)}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <h3 className={styles.emptyTitle}>{title}</h3>
      {description && <p className={styles.emptyText}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/** Bloco animado que ocupa o lugar do conteúdo durante o carregamento. */
export function Skeleton({ width, height = 16, radius, style }: { width?: number | string; height?: number | string; radius?: number | string; style?: CSSProperties }) {
  return <span className={styles.skeleton} style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
    >
      <span className={styles.progressFill} style={{ width: `${clamped}%` }} />
    </div>
  );
}

interface BannerProps {
  tone?: 'info' | 'warning' | 'danger';
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

/** Faixa informativa persistente, usada para contexto da tela (somente leitura, sem conexão). */
export function Banner({ tone = 'info', icon, children, action }: BannerProps) {
  return (
    <div className={cx(styles.banner, styles[`banner-${tone}`])} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <span className={styles.bannerIcon}>{icon}</span>}
      <div className={styles.bannerText}>{children}</div>
      {action}
    </div>
  );
}
