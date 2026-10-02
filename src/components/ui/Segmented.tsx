import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Segmented.module.css';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode; count?: number }>;
  label: string;
}

/** Alternância entre poucas opções mutuamente exclusivas (abas compactas). */
export function Segmented<T extends string>({ value, onChange, options, label }: SegmentedProps<T>) {
  return (
    <div className={styles.group} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={cx(styles.option, option.value === value && styles.active)}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
          {option.count !== undefined && <span className={styles.count}>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
