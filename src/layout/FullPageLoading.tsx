import { LogoMark } from '@/components/ui/Logo';
import { Spinner } from '@/components/ui/Spinner';
import styles from './FullPageLoading.module.css';

export function FullPageLoading({ label }: { label: string }) {
  return (
    <div className={styles.page} role="status">
      <LogoMark size={44} />
      <div className={styles.row}>
        <Spinner size={16} />
        <span>{label}…</span>
      </div>
    </div>
  );
}
