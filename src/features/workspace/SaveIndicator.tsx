import { Check, CloudOff, Eye, LogIn, RefreshCw, TriangleAlert } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import type { SessionSnapshot } from '@/state/ProjectSession';
import { formatDateTime, formatTime } from '@/lib/dates';
import styles from './SaveIndicator.module.css';

function sameDay(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

interface SaveIndicatorProps {
  save: SessionSnapshot['save'];
  readOnly: boolean;
  /** Motivo da leitura sem edição, quando aplicável. */
  readOnlyReason?: string;
  /** Tenta enviar agora o que estiver guardado. */
  onRetry?: () => void;
}

function pendingLabel(count: number): string {
  return `${count} ${count === 1 ? 'alteração guardada' : 'alterações guardadas'}`;
}

/**
 * Mostra de forma contínua se o trabalho está salvo, sendo salvo ou aguardando
 * algo (conexão, novo login, nova tentativa, decisão sobre um conflito).
 */
export function SaveIndicator({ save, readOnly, readOnlyReason, onRetry }: SaveIndicatorProps) {
  if (readOnly && save.pending === 0) {
    return (
      <span className={styles.indicator} data-state="readonly" title={readOnlyReason}>
        <Eye size={15} aria-hidden />
        <span className={styles.text}>Somente leitura</span>
      </span>
    );
  }

  if (save.status === 'saving') {
    return (
      <span className={styles.indicator} data-state="saving" role="status" data-testid="save-indicator">
        <Spinner size={13} />
        <span className={styles.text}>Salvando…</span>
      </span>
    );
  }

  if (save.status === 'offline') {
    return (
      <span
        className={styles.indicator}
        data-state="offline"
        role="status"
        data-testid="save-indicator"
        title="Suas alterações estão guardadas neste dispositivo e serão enviadas quando a conexão voltar."
      >
        <CloudOff size={15} aria-hidden />
        <span className={styles.text}>
          Sem conexão
          {save.pending > 0 && ` · ${pendingLabel(save.pending)}`}
        </span>
      </span>
    );
  }

  if (save.status === 'paused') {
    return (
      <span
        className={styles.indicator}
        data-state="paused"
        role="status"
        data-testid="save-indicator"
        title="Suas alterações estão guardadas neste dispositivo e serão enviadas quando você entrar novamente."
      >
        <LogIn size={15} aria-hidden />
        <span className={styles.text}>
          Sessão expirada
          {save.pending > 0 && ` · ${pendingLabel(save.pending)}`}
        </span>
      </span>
    );
  }

  if (save.status === 'error') {
    return (
      <button
        type="button"
        className={styles.indicator}
        data-state="error"
        data-testid="save-indicator"
        onClick={onRetry}
        title="O servidor não confirmou a gravação. As alterações estão guardadas neste dispositivo e novas tentativas são feitas automaticamente. Clique para tentar agora."
      >
        <RefreshCw size={15} aria-hidden />
        <span className={styles.text} role="status">
          Falha ao salvar
          {save.pending > 0 && ` · ${pendingLabel(save.pending)}`}
        </span>
      </button>
    );
  }

  if (save.status === 'conflict') {
    return (
      <span
        className={styles.indicator}
        data-state="conflict"
        role="status"
        data-testid="save-indicator"
        title="Há notas alteradas também por outra pessoa. Escolha qual versão manter em cada uma."
      >
        <TriangleAlert size={15} aria-hidden />
        <span className={styles.text}>Conflito a resolver</span>
      </span>
    );
  }

  const at = save.lastSavedAt;
  return (
    <span
      className={styles.indicator}
      data-state="saved"
      role="status"
      data-testid="save-indicator"
      title={at ? `Última atualização em ${formatDateTime(at)}` : undefined}
    >
      <Check size={15} aria-hidden />
      <span className={styles.text}>
        Salvo
        {at && <span className={styles.detail}> · {sameDay(at) ? `às ${formatTime(at)}` : formatDateTime(at)}</span>}
      </span>
    </span>
  );
}
