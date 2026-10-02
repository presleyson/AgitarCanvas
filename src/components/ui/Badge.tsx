import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx(styles.badge, styles[tone])}>
      {icon}
      {children}
    </span>
  );
}
