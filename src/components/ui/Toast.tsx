import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '@/lib/cx';
import styles from './Toast.module.css';

export interface ToastOptions {
  message: string;
  tone?: 'info' | 'success' | 'error';
  /** Ação opcional, como "Desfazer". */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

type ToastFn = (options: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

/** Avisos breves e não bloqueantes: confirmações, erros e ações de desfazer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (options) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...options, id }]);
      const duration = options.durationMs ?? (options.action ? 7000 : options.tone === 'error' ? 6000 : 3500);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const icons = useMemo(
    () => ({
      info: <Info size={18} aria-hidden />,
      success: <CheckCircle2 size={18} aria-hidden />,
      error: <AlertCircle size={18} aria-hidden />,
    }),
    [],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={styles.region} role="region" aria-label="Avisos">
        {toasts.map((entry) => {
          const tone = entry.tone ?? 'info';
          return (
            <div
              key={entry.id}
              className={cx(styles.toast, styles[tone])}
              role={tone === 'error' ? 'alert' : 'status'}
            >
              <span className={styles.icon}>{icons[tone]}</span>
              <span className={styles.message}>{entry.message}</span>
              {entry.action && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    entry.action!.onClick();
                    dismiss(entry.id);
                  }}
                >
                  {entry.action.label}
                </button>
              )}
              <button type="button" className={styles.close} aria-label="Dispensar aviso" onClick={() => dismiss(entry.id)}>
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast deve ser usado dentro de ToastProvider.');
  return toast;
}
