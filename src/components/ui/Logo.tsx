import styles from './Logo.module.css';

/** Símbolo da marca: os blocos do canvas reunidos em um único quadro. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="#10173A" />
      <rect x="7" y="7" width="7.5" height="11" rx="2" fill="#F6B73C" />
      <rect x="17.5" y="7" width="7.5" height="4.5" rx="2" fill="#7C8CFF" />
      <rect x="17.5" y="13.5" width="7.5" height="4.5" rx="2" fill="#4FD1B5" />
      <rect x="7" y="20.5" width="18" height="4.5" rx="2" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ size = 32, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <span className={styles.logo} data-inverted={inverted || undefined}>
      <LogoMark size={size} />
      <span className={styles.word}>
        AGITAR <span className={styles.light}>Canvas</span>
      </span>
    </span>
  );
}
