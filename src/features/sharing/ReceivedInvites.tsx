import { useCallback, useEffect, useState } from 'react';
import { MailOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { ReceivedInvite } from '@/data/repository';
import { ROLE_LABEL } from '@/domain/types';
import { errorMessage } from '@/lib/errors';
import { useRepository } from '@/state/RepositoryContext';
import styles from './ReceivedInvites.module.css';

interface ReceivedInvitesProps {
  /** Chamado depois de um convite aceito, para atualizar a lista de projetos. */
  onAccepted: (projectId: string) => void;
}

/**
 * Convites destinados ao email do usuário. O acesso a um projeto só passa a
 * existir depois que a pessoa aceita o convite; recusar o remove.
 */
export function ReceivedInvites({ onAccepted }: ReceivedInvitesProps) {
  const { sharing } = useRepository();
  const toast = useToast();
  const [invites, setInvites] = useState<ReceivedInvite[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sharing) return;
    try {
      setInvites(await sharing.listReceivedInvites());
    } catch {
      // A lista de projetos já informa falhas de conexão; aqui basta não exibir nada.
    }
  }, [sharing]);

  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!sharing || invites.length === 0) return null;

  async function answer(invite: ReceivedInvite, accept: boolean) {
    if (!sharing) return;
    setWorking(invite.id);
    try {
      if (accept) {
        const projectId = await sharing.acceptInvite(invite.id);
        toast({ message: `Você agora participa de "${invite.projectName}".`, tone: 'success' });
        onAccepted(projectId);
      } else {
        await sharing.declineInvite(invite.id);
        toast({ message: 'Convite recusado.' });
      }
      setInvites((current) => current.filter((candidate) => candidate.id !== invite.id));
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
      void load();
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="convites-recebidos">
      <h2 id="convites-recebidos" className={styles.title}>
        <MailOpen size={18} aria-hidden />
        Convites recebidos
      </h2>
      <ul className={styles.list}>
        {invites.map((invite) => (
          <li key={invite.id} className={styles.invite}>
            <div className={styles.text}>
              <strong>{invite.projectName}</strong>
              <span>
                {invite.invitedByName ? `${invite.invitedByName} convidou você` : 'Você recebeu um convite'} como{' '}
                {ROLE_LABEL[invite.role].toLowerCase()}.
              </span>
            </div>
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="primary"
                loading={working === invite.id}
                disabled={working !== null}
                onClick={() => void answer(invite, true)}
                aria-label={`Aceitar convite para ${invite.projectName}`}
              >
                Aceitar
              </Button>
              <Button
                size="sm"
                disabled={working !== null}
                onClick={() => void answer(invite, false)}
                aria-label={`Recusar convite para ${invite.projectName}`}
              >
                Recusar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
