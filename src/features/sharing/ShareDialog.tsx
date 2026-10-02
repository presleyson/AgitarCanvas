import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Mail, Trash2, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Banner, Skeleton } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ROLE_LABEL, type Invite, type Member, type Project, type Role, type ShareLink } from '@/domain/types';
import { isValidEmail } from '@/domain/validation';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useAuth, useRepository } from '@/state/RepositoryContext';
import { copyText, joinUrl, projectUrl } from './links';
import styles from './ShareDialog.module.css';

type GrantRole = Exclude<Role, 'owner'>;

const ROLE_HELP: Record<GrantRole, string> = {
  editor: 'Pode editar notas e dados do projeto',
  viewer: 'Pode ver e exportar, sem editar',
};

interface ShareDialogProps {
  project: Project;
  onClose: () => void;
}

/** Gestão de acesso ao projeto: pessoas, convites por email e links controlados. */
export function ShareDialog({ project, onClose }: ShareDialogProps) {
  const repository = useRepository();
  const { user } = useAuth();
  const toast = useToast();
  const sharing = repository.sharing;
  const isOwner = project.role === 'owner';

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantRole>('editor');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [linkRole, setLinkRole] = useState<GrantRole>('viewer');
  const [linkDays, setLinkDays] = useState('7');
  const [creatingLink, setCreatingLink] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!sharing) return;
    try {
      const [nextMembers, nextInvites, nextLinks] = await Promise.all([
        sharing.listMembers(project.id),
        isOwner ? sharing.listInvites(project.id) : Promise.resolve([]),
        isOwner ? sharing.listLinks(project.id) : Promise.resolve([]),
      ]);
      setMembers(nextMembers);
      setInvites(nextInvites);
      setLinks(nextLinks);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [sharing, project.id, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(task: () => Promise<unknown>, success?: string) {
    setWorking(true);
    try {
      await task();
      if (success) toast({ message: success, tone: 'success' });
      await load();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setWorking(false);
    }
  }

  async function invite() {
    if (!sharing) return;
    const address = email.trim().toLowerCase();
    if (!isValidEmail(address)) {
      setEmailError('Informe um email válido.');
      return;
    }
    setInviting(true);
    setEmailError(null);
    try {
      const outcome = await sharing.invite(project.id, address, role);
      setEmail('');
      toast(
        outcome === 'already_member'
          ? { message: `${address} já participa do projeto.`, tone: 'info' }
          : {
              message: `Convite registrado. ${address} verá o convite ao entrar com este email e terá acesso depois de aceitar.`,
              tone: 'success',
            },
      );
      await load();
    } catch (error) {
      setEmailError(errorMessage(error));
    } finally {
      setInviting(false);
    }
  }

  async function createLink() {
    if (!sharing) return;
    setCreatingLink(true);
    try {
      const link = await sharing.createLink(project.id, linkRole, linkDays === 'never' ? null : Number(linkDays));
      const copied = await copyText(joinUrl(link.token));
      toast({ message: copied ? 'Link criado e copiado.' : 'Link criado.', tone: 'success' });
      await load();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setCreatingLink(false);
    }
  }

  async function copy(text: string, message: string) {
    toast((await copyText(text)) ? { message, tone: 'success' } : { message: 'Não foi possível copiar.', tone: 'error' });
  }

  function mailto(address: string): string {
    const subject = `Convite para o projeto "${project.name}" no AGITAR Canvas`;
    const body = `Olá,\n\nVocê foi convidado(a) a participar do projeto "${project.name}" no AGITAR Canvas.\n\nAcesse ${projectUrl(project.id)} e entre com a conta Google deste email (${address}).`;
    return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  if (!sharing) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()} title="Compartilhar projeto" size="sm">
        <Banner>
          O compartilhamento exige contas de usuário e está disponível quando a plataforma opera conectada ao servidor.
          No modo local, os projetos ficam apenas neste navegador. Para enviar o planejamento a outras pessoas, use a
          exportação em PDF.
        </Banner>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Compartilhar projeto"
      description={isOwner ? 'Convide pessoas e defina o que cada uma pode fazer.' : 'Pessoas com acesso a este projeto.'}
      size="md"
    >
      <div className={styles.sections}>
        {isOwner && (
          <section aria-labelledby="convidar">
            <h3 id="convidar" className={styles.heading}>
              Convidar por email
            </h3>
            <form
              className={styles.inviteRow}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void invite();
              }}
            >
              <label className={styles.grow}>
                <span className="sr-only">Email da pessoa</span>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="nome@empresa.com"
                  value={email}
                  aria-invalid={emailError ? true : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailError(null);
                  }}
                />
              </label>
              <label>
                <span className="sr-only">Papel</span>
                <Select value={role} onChange={(event) => setRole(event.target.value as GrantRole)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Visualizador</option>
                </Select>
              </label>
              <Button type="submit" variant="primary" icon={<UserPlus size={16} aria-hidden />} loading={inviting}>
                Convidar
              </Button>
            </form>
            {emailError ? (
              <p className={styles.error} role="alert">
                {emailError}
              </p>
            ) : (
              <p className={styles.hint}>
                {ROLE_HELP[role]}. A pessoa acessa ao entrar com a conta Google deste email.
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="pessoas">
          <h3 id="pessoas" className={styles.heading}>
            Pessoas com acesso
          </h3>
          {loadError ? (
            <Banner tone="danger" action={<Button size="sm" onClick={() => void load()}>Tentar novamente</Button>}>
              {loadError}
            </Banner>
          ) : !members ? (
            <div className={styles.list}>
              <Skeleton height={44} radius={10} />
              <Skeleton height={44} radius={10} />
            </div>
          ) : (
            <ul className={styles.list}>
              {members.map((member) => (
                <li key={member.user.id} className={styles.person}>
                  <Avatar person={member.user} size={34} />
                  <div className={styles.personBody}>
                    <p className={styles.personName}>
                      {member.user.name}
                      {member.user.id === user?.id && <span className={styles.you}> (você)</span>}
                    </p>
                    {member.user.email && <p className={styles.personEmail}>{member.user.email}</p>}
                  </div>
                  {isOwner && member.role !== 'owner' ? (
                    <>
                      <label>
                        <span className="sr-only">Papel de {member.user.name}</span>
                        <Select
                          value={member.role}
                          disabled={working}
                          onChange={(event) =>
                            void act(
                              () => sharing.setRole(project.id, member.user.id, event.target.value as GrantRole),
                              'Papel atualizado.',
                            )
                          }
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Visualizador</option>
                        </Select>
                      </label>
                      <IconButton label={`Remover ${member.user.name}`} tone="danger" onClick={() => setRemoving(member)}>
                        <X size={16} aria-hidden />
                      </IconButton>
                    </>
                  ) : (
                    <Badge tone={member.role === 'owner' ? 'primary' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
                  )}
                </li>
              ))}

              {invites.map((invite) => (
                <li key={invite.id} className={styles.person}>
                  <span className={styles.pendingIcon}>
                    <Mail size={16} aria-hidden />
                  </span>
                  <div className={styles.personBody}>
                    <p className={styles.personName}>{invite.email}</p>
                    <p className={styles.personEmail}>Convite pendente · {ROLE_LABEL[invite.role]}</p>
                  </div>
                  <a className={styles.mail} href={mailto(invite.email)}>
                    Avisar por email
                  </a>
                  <IconButton
                    label={`Cancelar convite de ${invite.email}`}
                    tone="danger"
                    onClick={() => void act(() => sharing.revokeInvite(invite.id), 'Convite cancelado.')}
                  >
                    <X size={16} aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isOwner && (
          <section aria-labelledby="links">
            <h3 id="links" className={styles.heading}>
              Link de acesso
            </h3>
            <p className={styles.hint}>
              Quem abrir o link e entrar com uma conta passa a participar do projeto com o papel escolhido. Você pode
              revogar o link a qualquer momento.
            </p>
            <div className={styles.linkForm}>
              <label>
                <span className="sr-only">Papel concedido pelo link</span>
                <Select value={linkRole} onChange={(event) => setLinkRole(event.target.value as GrantRole)}>
                  <option value="viewer">Visualizador</option>
                  <option value="editor">Editor</option>
                </Select>
              </label>
              <label>
                <span className="sr-only">Validade do link</span>
                <Select value={linkDays} onChange={(event) => setLinkDays(event.target.value)}>
                  <option value="1">Válido por 1 dia</option>
                  <option value="7">Válido por 7 dias</option>
                  <option value="30">Válido por 30 dias</option>
                  <option value="never">Sem validade</option>
                </Select>
              </label>
              <Button icon={<Link2 size={16} aria-hidden />} onClick={() => void createLink()} loading={creatingLink}>
                Criar link
              </Button>
            </div>

            {links.length > 0 && (
              <ul className={styles.list}>
                {links.map((link) => (
                  <li key={link.id} className={styles.person}>
                    <span className={styles.pendingIcon}>
                      <Link2 size={16} aria-hidden />
                    </span>
                    <div className={styles.personBody}>
                      <p className={styles.personName}>Link para {ROLE_LABEL[link.role].toLocaleLowerCase('pt-BR')}</p>
                      <p className={styles.personEmail}>
                        Criado em {formatDate(link.createdAt)} ·{' '}
                        {link.expiresAt ? `expira em ${formatDate(link.expiresAt)}` : 'sem validade'}
                      </p>
                    </div>
                    <IconButton label="Copiar link" onClick={() => void copy(joinUrl(link.token), 'Link copiado.')}>
                      <Copy size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      label="Revogar link"
                      tone="danger"
                      onClick={() => void act(() => sharing.revokeLink(link.id), 'Link revogado.')}
                    >
                      <Trash2 size={16} aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover acesso?"
        description={
          <>
            <strong>{removing?.user.name}</strong> deixará de ver e editar este projeto. As contribuições já feitas
            permanecem no histórico.
          </>
        }
        confirmLabel="Remover acesso"
        tone="danger"
        loading={working}
        onConfirm={() =>
          removing &&
          void act(() => sharing.removeMember(project.id, removing.user.id), 'Acesso removido.').then(() => setRemoving(null))
        }
      />
    </Dialog>
  );
}
