import type { BlockId } from '@/methodology/agitar';
import type {
  HistoryEvent,
  Invite,
  Member,
  Note,
  Person,
  PresenceState,
  Project,
  ProjectInput,
  ProjectSummary,
  Role,
  ShareLink,
  VersionSummary,
} from '@/domain/types';

/**
 * Contrato entre a interface e a origem dos dados.
 *
 * Há duas implementações:
 *   - LocalRepository: dados no navegador, sem conta (modo local).
 *   - SupabaseRepository: Postgres, autenticação e tempo real (modo nuvem).
 *
 * A interface não conhece nenhuma das duas; depende apenas deste contrato.
 * Todos os métodos rejeitam com AppError (src/lib/errors.ts).
 */

export type Unsubscribe = () => void;

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

export interface AuthSnapshot {
  status: AuthStatus;
  user: Person | null;
}

export interface AuthApi {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): Unsubscribe;
  /** Inicia o login. No modo nuvem redireciona para o provedor de identidade. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Atualiza o nome exibido do usuário atual. */
  updateName(name: string): Promise<void>;
}

export interface NoteDraft {
  id: string;
  projectId: string;
  block: BlockId;
  content: string;
  position: number;
}

export interface NotePatch {
  content?: string;
  block?: BlockId;
  position?: number;
}

/**
 * Resultado de uma gravação com controle de concorrência. Quando a versão
 * informada não é mais a atual, nada é gravado e a nota atual é devolvida.
 */
export type UpdateResult = { ok: true; note: Note } | { ok: false; current: Note | null };

/**
 * Resultado de uma exclusão condicionada à versão. Quando a nota mudou desde
 * a versão informada, nada é excluído e a nota atual é devolvida.
 */
export type DeleteResult = { ok: true } | { ok: false; current: Note };

/** Alteração recebida em tempo real. */
export type ProjectChange =
  | { type: 'note'; note: Note; deleted: boolean }
  /** Campos alterados do projeto. Campos ausentes permanecem como estão. */
  | { type: 'project'; project: Partial<Omit<Project, 'role'>> }
  /** O acesso do usuário mudou (papel alterado ou acesso removido). */
  | { type: 'access' }
  /** A conexão foi restabelecida; o estado deve ser recarregado. */
  | { type: 'resync' };

export interface PresenceHandle {
  update(patch: Pick<PresenceState, 'editingNoteId' | 'block'>): void;
  leave(): void;
}

export type InviteOutcome = 'invited' | 'already_member';

/** Convite recebido pelo usuário atual, ainda sem resposta. */
export interface ReceivedInvite {
  id: string;
  projectId: string;
  projectName: string;
  role: Exclude<Role, 'owner'>;
  invitedByName: string;
  createdAt: string;
}

export interface SharingApi {
  listMembers(projectId: string): Promise<Member[]>;
  setRole(projectId: string, userId: string, role: Exclude<Role, 'owner'>): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  leave(projectId: string): Promise<void>;
  /** Registra um convite. O acesso só é concedido quando a pessoa convidada aceita. */
  invite(projectId: string, email: string, role: Exclude<Role, 'owner'>): Promise<InviteOutcome>;
  listInvites(projectId: string): Promise<Invite[]>;
  revokeInvite(inviteId: string): Promise<void>;
  /** Convites pendentes destinados ao usuário atual. */
  listReceivedInvites(): Promise<ReceivedInvite[]>;
  /** Aceita um convite recebido. Retorna o identificador do projeto. */
  acceptInvite(inviteId: string): Promise<string>;
  declineInvite(inviteId: string): Promise<void>;
  listLinks(projectId: string): Promise<ShareLink[]>;
  createLink(projectId: string, role: Exclude<Role, 'owner'>, expiresInDays: number | null): Promise<ShareLink>;
  revokeLink(linkId: string): Promise<void>;
  /** Entra em um projeto por link. Retorna o identificador do projeto. */
  joinViaLink(token: string): Promise<string>;
}

export interface Repository {
  readonly mode: 'local' | 'cloud';
  readonly auth: AuthApi;
  /** Compartilhamento entre contas. Indisponível no modo local. */
  readonly sharing: SharingApi | null;

  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<{ project: Project; notes: Note[] }>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project>;
  setArchived(id: string, archived: boolean): Promise<Project>;
  /** Retorna o identificador da cópia. */
  duplicateProject(id: string): Promise<string>;
  deleteProject(id: string): Promise<void>;

  /** Idempotente: recriar uma nota já existente com o mesmo id é aceito. */
  createNote(draft: NoteDraft): Promise<Note>;
  updateNote(id: string, patch: NotePatch, baseVersion: number): Promise<UpdateResult>;
  /**
   * Exclusão lógica e idempotente: excluir uma nota já excluída ou inexistente
   * é aceito. Com baseVersion, a nota só é excluída se ainda estiver nessa
   * versão; assim ninguém apaga, sem ver, o que outra pessoa acabou de escrever.
   */
  deleteNote(id: string, baseVersion?: number): Promise<DeleteResult>;
  restoreNote(id: string): Promise<Note>;

  subscribe(projectId: string, handler: (change: ProjectChange) => void): Unsubscribe;
  joinPresence(
    projectId: string,
    initial: Pick<PresenceState, 'editingNoteId' | 'block'>,
    onChange: (others: PresenceState[]) => void,
  ): PresenceHandle;

  listEvents(projectId: string, options?: { limit?: number; before?: string }): Promise<HistoryEvent[]>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  createVersion(projectId: string, label: string): Promise<void>;
  restoreVersion(versionId: string): Promise<void>;
}
