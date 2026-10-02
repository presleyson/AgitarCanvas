import type { RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js';
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
import { countByBlock } from '@/domain/progress';
import { emptyProjectInput, normalizeProjectInput } from '@/domain/validation';
import { isBlockId } from '@/methodology/agitar';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { CACHE_PREFIX, removeByPrefix, safeSessionStorage } from '@/lib/storage';
import type {
  AuthApi,
  AuthSnapshot,
  DeleteResult,
  InviteOutcome,
  NoteDraft,
  NotePatch,
  PresenceHandle,
  ProjectChange,
  ReceivedInvite,
  Repository,
  SharingApi,
  Unsubscribe,
  UpdateResult,
} from '../repository';
import { fromSupabase } from './errors';
import {
  toEvent,
  toInvite,
  toLink,
  toMember,
  toNote,
  toPerson,
  toProject,
  toVersion,
  type EventRow,
  type InviteRow,
  type LinkRow,
  type MemberRow,
  type NoteRow,
  type ProfileRow,
  type ProjectRow,
  type VersionRow,
} from './rows';

/**
 * Repositório do modo nuvem (Supabase).
 *
 * A autorização acontece no banco, por Row Level Security: este código nunca
 * decide quem pode ver ou alterar um projeto, apenas traduz as respostas.
 */

export const RETURN_TO_KEY = 'agitar.returnTo';

const PROFILE_COLUMNS = 'id, full_name, email, avatar_url';
const NOTE_COLUMNS =
  'id, project_id, block, content, position, version, created_by, updated_by, created_at, updated_at, deleted_at';
const PROJECT_COLUMNS =
  'id, owner_id, name, description, organization, responsible, participants, status, archived_at, created_at, updated_at';

interface ProjectListRow extends ProjectRow {
  project_members: Array<{ user_id: string; role: Role }>;
  notes: Array<{ block: string }>;
  owner: ProfileRow | null;
}

interface ReceivedInviteRow {
  id: string;
  project_id: string;
  project_name: string;
  role: Exclude<Role, 'owner'>;
  invited_by_name: string;
  created_at: string;
}

/** Converte apenas as colunas presentes em uma linha parcial de projeto. */
function projectPatch(row: Partial<ProjectRow>): Partial<Omit<Project, 'role'>> {
  const patch: Partial<Omit<Project, 'role'>> = {};
  if (row.id !== undefined) patch.id = row.id;
  if (row.owner_id !== undefined) patch.ownerId = row.owner_id;
  if (row.name !== undefined) patch.name = row.name;
  if (row.description !== undefined) patch.description = row.description;
  if (row.organization !== undefined) patch.organization = row.organization;
  if (row.responsible !== undefined) patch.responsible = row.responsible;
  if (row.participants !== undefined) patch.participants = row.participants ?? [];
  if (row.status !== undefined) patch.status = row.status;
  if (row.archived_at !== undefined) patch.archivedAt = row.archived_at;
  if (row.created_at !== undefined) patch.createdAt = row.created_at;
  if (row.updated_at !== undefined) patch.updatedAt = row.updated_at;
  return patch;
}

/**
 * Canal privado de um projeto ("project:<uuid>"), compartilhado por tudo o que
 * esta aba faz no projeto: presença e avisos de mudança de acesso.
 */
interface Room {
  channel: RealtimeChannel | null;
  joined: boolean;
  users: number;
  disposed: boolean;
  /** Estado de presença publicado por esta conexão. */
  state: PresenceState | null;
  readonly presenceListeners: Set<(others: PresenceState[]) => void>;
  readonly accessListeners: Set<() => void>;
}

export class SupabaseRepository implements Repository {
  readonly mode = 'cloud' as const;
  readonly auth: AuthApi;
  readonly sharing: SharingApi;

  private authSnapshot: AuthSnapshot = { status: 'loading', user: null };
  private readonly authListeners = new Set<() => void>();
  private readonly connectionId = newId();
  private profileLoadedFor: string | null = null;
  private readonly rooms = new Map<string, Room>();
  /** Canais em fechamento, por projeto: um novo canal só abre depois. */
  private readonly closing = new Map<string, Promise<void>>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly redirectUrl: string,
  ) {
    this.auth = {
      getSnapshot: () => this.authSnapshot,
      subscribe: (listener) => {
        this.authListeners.add(listener);
        return () => this.authListeners.delete(listener);
      },
      signIn: () => this.signIn(),
      signOut: () => this.signOut(),
      updateName: (name) => this.updateName(name),
    };
    this.sharing = this.buildSharing();

    void this.client.auth.getSession().then(({ data }) => this.applySession(data.session));
    this.client.auth.onAuthStateChange((event, session) => {
      // Saída da conta, nesta ou em outra aba, ou acesso revogado: a cópia para
      // leitura sem conexão não deve permanecer no navegador. Alterações ainda
      // não enviadas ficam guardadas para a volta. Uma sessão apenas ausente
      // por falta de rede não apaga nada.
      if (event === 'SIGNED_OUT') removeByPrefix(CACHE_PREFIX);
      // Chamadas ao Supabase dentro deste callback podem travar; a aplicação
      // da sessão é adiada para o próximo ciclo.
      setTimeout(() => this.applySession(session), 0);
    });
  }

  // -------------------------------------------------------------------------
  // Autenticação
  // -------------------------------------------------------------------------

  private applySession(session: Session | null): void {
    if (!session) {
      this.profileLoadedFor = null;
      this.setAuth({ status: 'signed_out', user: null });
      return;
    }

    const metadata = session.user.user_metadata ?? {};
    const current = this.authSnapshot.user;
    const user: Person =
      current?.id === session.user.id
        ? current
        : {
            id: session.user.id,
            name: metadata.full_name || metadata.name || session.user.email?.split('@')[0] || 'Você',
            email: session.user.email ?? null,
            avatarUrl: metadata.avatar_url || metadata.picture || null,
          };

    if (this.authSnapshot.status !== 'signed_in' || current?.id !== user.id) {
      this.setAuth({ status: 'signed_in', user });
    }

    if (this.profileLoadedFor !== user.id) {
      this.profileLoadedFor = user.id;
      void this.loadProfile(user.id);
    }
  }

  /**
   * Carrega o nome escolhido no perfil. Convites recebidos não são aceitos
   * aqui: o acesso só é concedido quando a pessoa aceita cada convite.
   */
  private async loadProfile(userId: string): Promise<void> {
    try {
      const { data } = await this.client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
      if (data && this.authSnapshot.user?.id === userId) {
        this.setAuth({ status: 'signed_in', user: toPerson(data as ProfileRow) });
      }
    } catch {
      // Sem o perfil, valem os dados da sessão; a próxima sessão tenta de novo.
      if (this.profileLoadedFor === userId) this.profileLoadedFor = null;
    }
  }

  private setAuth(snapshot: AuthSnapshot): void {
    this.authSnapshot = snapshot;
    this.authListeners.forEach((listener) => listener());
  }

  private async signIn(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        safeSessionStorage()?.setItem(RETURN_TO_KEY, window.location.hash);
      } catch {
        /* sem armazenamento de sessão */
      }
    }
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: this.redirectUrl, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw fromSupabase(error);
  }

  private async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw fromSupabase(error);
    removeByPrefix(CACHE_PREFIX);
  }

  private async updateName(name: string): Promise<void> {
    const user = this.requireUser();
    const fullName = name.trim().slice(0, 160);
    if (!fullName) throw new AppError('validation', 'Informe seu nome.');

    const { error, status } = await this.client.from('profiles').update({ full_name: fullName }).eq('id', user.id);
    if (error) throw fromSupabase(error, status);
    this.setAuth({ status: 'signed_in', user: { ...user, name: fullName } });
  }

  private requireUser(): Person {
    const user = this.authSnapshot.user;
    if (!user) throw new AppError('unauthenticated');
    return user;
  }

  // -------------------------------------------------------------------------
  // Projetos
  // -------------------------------------------------------------------------

  async listProjects(): Promise<ProjectSummary[]> {
    const user = this.requireUser();
    const { data, error, status } = await this.client
      .from('projects')
      .select(
        `${PROJECT_COLUMNS}, project_members(user_id, role), notes(block), owner:profiles!projects_owner_id_fkey(${PROFILE_COLUMNS})`,
      )
      .is('notes.deleted_at', null)
      .order('updated_at', { ascending: false });
    if (error) throw fromSupabase(error, status);

    return ((data ?? []) as unknown as ProjectListRow[]).map((row) => {
      const role = row.project_members.find((member) => member.user_id === user.id)?.role ?? 'viewer';
      return {
        ...toProject(row, role),
        noteCounts: countByBlock(
          row.notes.flatMap((note) => (isBlockId(note.block) ? [{ block: note.block }] : [])),
        ),
        memberCount: row.project_members.length,
        owner: row.owner ? toPerson(row.owner) : null,
      };
    });
  }

  async getProject(id: string): Promise<{ project: Project; notes: Note[] }> {
    const user = this.requireUser();
    const [projectResult, notesResult] = await Promise.all([
      this.client
        .from('projects')
        .select(`${PROJECT_COLUMNS}, project_members(user_id, role)`)
        .eq('id', id)
        .maybeSingle(),
      this.client.from('notes').select(NOTE_COLUMNS).eq('project_id', id).is('deleted_at', null),
    ]);
    if (projectResult.error) throw fromSupabase(projectResult.error, projectResult.status);
    if (notesResult.error) throw fromSupabase(notesResult.error, notesResult.status);
    if (!projectResult.data) throw new AppError('not_found');

    const row = projectResult.data as unknown as ProjectRow & { project_members: Array<{ user_id: string; role: Role }> };
    const role = row.project_members.find((member) => member.user_id === user.id)?.role;
    if (!role) throw new AppError('not_found');

    return { project: toProject(row, role), notes: ((notesResult.data ?? []) as NoteRow[]).map(toNote) };
  }

  async createProject(input: ProjectInput): Promise<Project> {
    this.requireUser();
    const value = normalizeProjectInput(input);
    const { data, error, status } = await this.client.from('projects').insert(value).select(PROJECT_COLUMNS).single();
    if (error) throw fromSupabase(error, status);
    return toProject(data as ProjectRow, 'owner');
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project> {
    const user = this.requireUser();
    const normalized = normalizeProjectInput({ ...emptyProjectInput(), ...patch });
    if (patch.name !== undefined && !normalized.name) {
      throw new AppError('validation', 'Informe o nome do projeto.');
    }
    const changes = Object.fromEntries(
      (Object.keys(patch) as Array<keyof ProjectInput>).map((key) => [key, normalized[key]]),
    );

    const { data, error, status } = await this.client
      .from('projects')
      .update(changes)
      .eq('id', id)
      .select(`${PROJECT_COLUMNS}, project_members(user_id, role)`)
      .maybeSingle();
    if (error) throw fromSupabase(error, status);
    if (!data) throw new AppError('forbidden');

    const row = data as unknown as ProjectRow & { project_members: Array<{ user_id: string; role: Role }> };
    const role = row.project_members.find((member) => member.user_id === user.id)?.role ?? 'viewer';
    return toProject(row, role);
  }

  async setArchived(id: string, archived: boolean): Promise<Project> {
    const { data, error, status } = await this.client
      .from('projects')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) throw fromSupabase(error, status);
    if (!data) throw new AppError('forbidden');
    return toProject(data as ProjectRow, 'owner');
  }

  async duplicateProject(id: string): Promise<string> {
    const { data, error, status } = await this.client.rpc('duplicate_project', { p_project: id });
    if (error) throw fromSupabase(error, status);
    return data as string;
  }

  async deleteProject(id: string): Promise<void> {
    const { data, error, status } = await this.client.from('projects').delete().eq('id', id).select('id');
    if (error) throw fromSupabase(error, status);
    if (!data || data.length === 0) throw new AppError('forbidden');
  }

  // -------------------------------------------------------------------------
  // Notas
  // -------------------------------------------------------------------------

  async createNote(draft: NoteDraft): Promise<Note> {
    const { data, error, status } = await this.client
      .from('notes')
      .insert({
        id: draft.id,
        project_id: draft.projectId,
        block: draft.block,
        content: draft.content,
        position: draft.position,
      })
      .select(NOTE_COLUMNS)
      .single();

    if (error) {
      // Reenvio de uma criação que já havia chegado ao servidor. Se a nota foi
      // excluída nesse meio tempo, a criação não deve trazê-la de volta.
      if (error.code === '23505') {
        const existing = await this.fetchNote(draft.id);
        if (existing && existing.project_id === draft.projectId) {
          if (existing.deleted_at) throw new AppError('not_found');
          return toNote(existing);
        }
      }
      throw fromSupabase(error, status);
    }
    return toNote(data as NoteRow);
  }

  async updateNote(id: string, patch: NotePatch, baseVersion: number): Promise<UpdateResult> {
    // O filtro por versão é o controle de concorrência: se outra gravação
    // chegou antes, nenhuma linha é afetada.
    const { data, error, status } = await this.client
      .from('notes')
      .update(patch)
      .eq('id', id)
      .eq('version', baseVersion)
      .is('deleted_at', null)
      .select(NOTE_COLUMNS)
      .maybeSingle();
    if (error) throw fromSupabase(error, status);
    if (data) return { ok: true, note: toNote(data as NoteRow) };

    const current = await this.fetchNote(id);
    if (!current || current.deleted_at) return { ok: false, current: null };

    // A versão confere e mesmo assim nada foi gravado: não é conflito, é falta
    // de permissão (por exemplo, o papel do usuário passou a visualizador).
    if (current.version === baseVersion) throw new AppError('forbidden');

    return { ok: false, current: toNote(current) };
  }

  async deleteNote(id: string, baseVersion?: number): Promise<DeleteResult> {
    let query = this.client
      .from('notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);
    if (baseVersion !== undefined) query = query.eq('version', baseVersion);

    const { data, error, status } = await query.select('id');
    if (error) throw fromSupabase(error, status);
    if (data && data.length > 0) return { ok: true };

    // Nenhuma linha alterada: a nota já estava excluída ou não existe
    // (idempotente), mudou de versão, ou o usuário não pode alterá-la.
    const current = await this.fetchNote(id);
    if (!current || current.deleted_at) return { ok: true };
    if (baseVersion !== undefined && current.version !== baseVersion) return { ok: false, current: toNote(current) };
    throw new AppError('forbidden');
  }

  async restoreNote(id: string): Promise<Note> {
    const { data, error, status } = await this.client
      .from('notes')
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select(NOTE_COLUMNS)
      .maybeSingle();
    if (error) throw fromSupabase(error, status);
    if (data) return toNote(data as NoteRow);

    // Já estava ativa (restauração repetida) ou não pode ser restaurada.
    const current = await this.fetchNote(id);
    if (!current) throw new AppError('not_found');
    if (current.deleted_at) throw new AppError('forbidden');
    return toNote(current);
  }

  private async fetchNote(id: string): Promise<NoteRow | null> {
    const { data, error, status } = await this.client.from('notes').select(NOTE_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw fromSupabase(error, status);
    return (data as NoteRow | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Tempo real
  // -------------------------------------------------------------------------

  subscribe(projectId: string, handler: (change: ProjectChange) => void): Unsubscribe {
    let active = true;
    let subscribedOnce = false;
    let wasInterrupted = false;
    const emit = (change: ProjectChange) => {
      if (active) handler(change);
    };

    const onNote = (row: Partial<NoteRow> | null | undefined) => {
      if (!row?.id) return;
      // Colunas grandes que não mudaram podem vir ausentes; nesse caso a nota
      // é lida de novo em vez de ser aplicada pela metade.
      const complete =
        row.content !== undefined &&
        row.block !== undefined &&
        row.version !== undefined &&
        row.position !== undefined &&
        row.deleted_at !== undefined;
      if (complete) {
        const full = row as NoteRow;
        emit({ type: 'note', note: toNote(full), deleted: full.deleted_at !== null });
        return;
      }
      void this.fetchNote(row.id).then(
        (full) => {
          if (full) emit({ type: 'note', note: toNote(full), deleted: full.deleted_at !== null });
          else emit({ type: 'resync' });
        },
        () => emit({ type: 'resync' }),
      );
    };

    const channel = this.client
      .channel(`db:project:${projectId}:${newId()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `project_id=eq.${projectId}` },
        (payload) => onNote(payload.new as Partial<NoteRow>),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const { id: _id, ...project } = projectPatch(payload.new as Partial<ProjectRow>);
          if (Object.keys(project).length > 0) emit({ type: 'project', project });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // O servidor não reenvia o que mudou enquanto o canal não estava
          // ativo: nem durante uma queda, nem entre a leitura inicial do
          // projeto e a confirmação da inscrição.
          if (!subscribedOnce || wasInterrupted) emit({ type: 'resync' });
          subscribedOnce = true;
          wasInterrupted = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasInterrupted = true;
        }
      });

    // Mudanças de acesso chegam pelo canal privado do projeto.
    const onAccess = () => emit({ type: 'access' });
    const room = this.enterRoom(projectId);
    room.accessListeners.add(onAccess);

    return () => {
      if (!active) return;
      active = false;
      room.accessListeners.delete(onAccess);
      this.leaveRoom(projectId, room);
      void this.client.removeChannel(channel).then(undefined, () => undefined);
    };
  }

  joinPresence(
    projectId: string,
    initial: Pick<PresenceState, 'editingNoteId' | 'block'>,
    onChange: (others: PresenceState[]) => void,
  ): PresenceHandle {
    const user = this.requireUser();
    const room = this.enterRoom(projectId);
    let active = true;

    room.state = { connectionId: this.connectionId, user, ...initial };
    room.presenceListeners.add(onChange);
    this.publishPresence(room);

    return {
      update: (patch) => {
        if (!active || !room.state) return;
        room.state = { ...room.state, ...patch };
        this.publishPresence(room);
      },
      leave: () => {
        if (!active) return;
        active = false;
        room.presenceListeners.delete(onChange);
        if (room.presenceListeners.size === 0) {
          room.state = null;
          if (room.joined && room.channel) void room.channel.untrack().then(undefined, () => undefined);
        }
        this.leaveRoom(projectId, room);
      },
    };
  }

  private publishPresence(room: Room): void {
    if (!room.joined || !room.channel || !room.state) return;
    void room.channel.track(room.state).then(undefined, () => undefined);
  }

  /**
   * Entra no canal privado do projeto, criando-o se necessário. O servidor só
   * admite participantes do projeto (políticas sobre realtime.messages, em
   * 0005_realtime.sql).
   */
  private enterRoom(projectId: string): Room {
    let room = this.rooms.get(projectId);
    if (!room) {
      const created: Room = {
        channel: null,
        joined: false,
        users: 0,
        disposed: false,
        state: null,
        presenceListeners: new Set(),
        accessListeners: new Set(),
      };
      room = created;
      this.rooms.set(projectId, created);
      // Um canal com o mesmo nome pode estar terminando de fechar.
      const pending = this.closing.get(projectId) ?? Promise.resolve();
      void pending.then(() => {
        if (!created.disposed) this.openRoom(projectId, created);
      });
    }
    room.users += 1;
    return room;
  }

  private openRoom(projectId: string, room: Room): void {
    const channel = this.client.channel(`project:${projectId}`, {
      config: { private: true, presence: { key: this.connectionId } },
    });
    room.channel = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const latest = new Map<string, PresenceState>();
        for (const entry of Object.values(channel.presenceState<PresenceState>()).flat()) {
          if (entry.connectionId && entry.connectionId !== this.connectionId && entry.user?.id) {
            latest.set(entry.connectionId, {
              connectionId: entry.connectionId,
              user: entry.user,
              editingNoteId: entry.editingNoteId ?? null,
              block: entry.block ?? null,
            });
          }
        }
        const others = [...latest.values()];
        room.presenceListeners.forEach((listener) => listener(others));
      })
      .on('broadcast', { event: 'access' }, () => {
        room.accessListeners.forEach((listener) => listener());
      })
      .subscribe((status) => {
        room.joined = status === 'SUBSCRIBED';
        if (room.joined) this.publishPresence(room);
      });
  }

  private leaveRoom(projectId: string, room: Room): void {
    room.users -= 1;
    if (room.users > 0 || room.disposed) return;

    room.disposed = true;
    room.joined = false;
    if (this.rooms.get(projectId) === room) this.rooms.delete(projectId);

    const channel = room.channel;
    room.channel = null;
    if (!channel) return;

    const previous = this.closing.get(projectId) ?? Promise.resolve();
    const done: Promise<void> = previous
      .then(() => this.client.removeChannel(channel))
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        if (this.closing.get(projectId) === done) this.closing.delete(projectId);
      });
    this.closing.set(projectId, done);
  }

  // -------------------------------------------------------------------------
  // Histórico e versões
  // -------------------------------------------------------------------------

  async listEvents(projectId: string, options: { limit?: number; before?: string } = {}): Promise<HistoryEvent[]> {
    let query = this.client
      .from('project_events')
      .select(
        `id, project_id, actor_id, actor_name, at, kind, block, note_id, before, after, actor:profiles(${PROFILE_COLUMNS})`,
      )
      .eq('project_id', projectId)
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .limit(options.limit ?? 50);
    if (options.before) query = query.lt('at', options.before);

    const { data, error, status } = await query;
    if (error) throw fromSupabase(error, status);
    return ((data ?? []) as unknown as EventRow[]).map(toEvent);
  }

  async listVersions(projectId: string): Promise<VersionSummary[]> {
    const { data, error, status } = await this.client
      .from('project_versions')
      .select(
        `id, project_id, label, kind, note_count, created_by, created_by_name, created_at, author:profiles(${PROFILE_COLUMNS})`,
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw fromSupabase(error, status);
    return ((data ?? []) as unknown as VersionRow[]).map(toVersion);
  }

  async createVersion(projectId: string, label: string): Promise<void> {
    const { error, status } = await this.client.rpc('create_version', { p_project: projectId, p_label: label });
    if (error) throw fromSupabase(error, status);
  }

  async restoreVersion(versionId: string): Promise<void> {
    const { error, status } = await this.client.rpc('restore_version', { p_version: versionId });
    if (error) throw fromSupabase(error, status);
  }

  // -------------------------------------------------------------------------
  // Compartilhamento
  // -------------------------------------------------------------------------

  private buildSharing(): SharingApi {
    const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error, status } = await this.client.rpc(name, args);
      if (error) throw fromSupabase(error, status);
      return data as T;
    };

    return {
      listMembers: async (projectId): Promise<Member[]> => {
        const { data, error, status } = await this.client
          .from('project_members')
          .select(`role, created_at, user:profiles!project_members_user_id_fkey(${PROFILE_COLUMNS})`)
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });
        if (error) throw fromSupabase(error, status);
        return ((data ?? []) as unknown as MemberRow[]).flatMap((row) => toMember(row) ?? []);
      },
      setRole: (projectId, userId, role) =>
        rpc<void>('set_member_role', { p_project: projectId, p_user: userId, p_role: role }),
      removeMember: (projectId, userId) => rpc<void>('remove_member', { p_project: projectId, p_user: userId }),
      leave: (projectId) => rpc<void>('leave_project', { p_project: projectId }),
      invite: (projectId, email, role) =>
        rpc<InviteOutcome>('invite_member', { p_project: projectId, p_email: email, p_role: role }),
      listInvites: async (projectId): Promise<Invite[]> => {
        const { data, error, status } = await this.client
          .from('project_invites')
          .select('id, email, role, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });
        if (error) throw fromSupabase(error, status);
        return ((data ?? []) as InviteRow[]).map(toInvite);
      },
      revokeInvite: (inviteId) => rpc<void>('revoke_invite', { p_invite: inviteId }),
      listReceivedInvites: async (): Promise<ReceivedInvite[]> => {
        const rows = await rpc<ReceivedInviteRow[] | null>('my_invites', {});
        return (rows ?? []).map((row) => ({
          id: row.id,
          projectId: row.project_id,
          projectName: row.project_name,
          role: row.role,
          invitedByName: row.invited_by_name,
          createdAt: row.created_at,
        }));
      },
      acceptInvite: (inviteId) => rpc<string>('accept_invite', { p_invite: inviteId }),
      declineInvite: (inviteId) => rpc<void>('decline_invite', { p_invite: inviteId }),
      listLinks: async (projectId): Promise<ShareLink[]> => {
        const { data, error, status } = await this.client
          .from('project_links')
          .select('id, token, role, created_at, expires_at, revoked_at')
          .eq('project_id', projectId)
          .is('revoked_at', null)
          .order('created_at', { ascending: false });
        if (error) throw fromSupabase(error, status);
        const now = Date.now();
        return ((data ?? []) as LinkRow[])
          .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
          .map(toLink);
      },
      createLink: async (projectId, role, expiresInDays) =>
        toLink(
          await rpc<LinkRow>('create_link', { p_project: projectId, p_role: role, p_expires_in_days: expiresInDays }),
        ),
      revokeLink: (linkId) => rpc<void>('revoke_link', { p_link: linkId }),
      joinViaLink: (token) => rpc<string>('join_via_link', { p_token: token }),
    };
  }
}
