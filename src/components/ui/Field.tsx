import { useId, type ComponentProps, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Field.module.css';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Recebe o id do controle e os ids descritivos para associação acessível. */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}

/** Rótulo, dica e mensagem de erro em torno de um controle de formulário. */
export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {optional && <span className={styles.optional}>opcional</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(styles.control, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(styles.control, styles.textarea, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cx(styles.control, styles.select, className)} {...rest}>
      {children}
    </select>
  );
}
