import { getBlock, type BlockId } from '@/methodology/agitar';
import type {
  HistoryEvent,
  HistoryKind,
  Note,
  Person,
  PresenceState,
  Project,
  ProjectInput,
  ProjectSummary,
  VersionKind,
  VersionSummary,
} from '@/domain/types';
import { countByBlock } from '@/domain/progress';
import { normalizeProjectInput } from '@/domain/validation';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { readJson, removeKey, safeLocalStorage, safeSessionStorage, writeJson } from '@/lib/storage';
import type {
  AuthApi,
  AuthSnapshot,
  DeleteResult,
  NoteDraft,
  NotePatch,
  PresenceHandle,
  ProjectChange,
  Repository,
  Unsubscribe,
  UpdateResult,
} from '../repository';

/**
 * Repositório do modo local: os dados ficam no armazenamento do navegador.
 *
 * Replica as regras do servidor (limite por bloco, versão por nota, histórico
 * consolidado, versões e restauração) para que a interface se comporte da
 * mesma forma nos dois modos. Abas do mesmo navegador se sincronizam por
 * BroadcastChannel, inclusive presença.
 */

/** Um registro por projeto, para que abas diferentes não sobrescrevam projetos umas das outras. */
export const LOCAL_PROJECT_PREFIX = 'agitar.local.project.';
const USER_KEY = 'agitar.local.user';
const CHANNEL = 'agitar.local';
const MAX_EVENTS = 500;
const MAX_AUTO_VERSIONS = 30;
const COALESCE_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
// Abas em segundo plano têm os temporizadores atrasados pelo navegador; a
// tolerância evita que participantes "pisquem". A saída normal é avisada na hora.
const PRESENCE_TTL_MS = 75_000;
const PRESENCE_BEAT_MS = 5_000;

interface StoredNote extends Note {
  deletedAt: string | null;
}

interface StoredVersion {
  id: string;
  label: string;
  kind: VersionKind;
  createdAt: string;
  createdBy: Person;
  notes: Array<Pick<Note, 'id' | 'block' | 'content' | 'position'>>;
}

interface StoredProject {
  project: Omit<Project, 'role'>;
  notes: StoredNote[];
  events: HistoryEvent[];
  versions: StoredVersion[];
}

type ChannelMessage =
  | { kind: 'change'; from: string; projectId: string; change: ProjectChange }
  | { kind: 'presence'; from: string; projectId: string; state: PresenceState }
  | { kind: 'presence-leave'; from: string; projectId: string }
  | { kind: 'presence-request'; from: string; projectId: string };

interface PresenceRoom {
  state: PresenceState;
  onChange: (others: PresenceState[]) => void;
  others: Map<string, { state: PresenceState; seenAt: number }>;
  timer: ReturnType<typeof setInterval>;
}

const DEFAULT_USER: Person = { id: 'local-user', name: 'Você' };

export class LocalRepository implements Repository {
  readonly mode = 'local' as const;
  readonly sharing = null;
  readonly auth: AuthApi;

  private readonly connectionId = newId();
  private readonly channel: BroadcastChannel | null;
  private readonly handlers = new Map<string, Set<(change: ProjectChange) => void>>();
  private readonly rooms = new Map<string, PresenceRoom>();
  private readonly authListeners = new Set<() => void>();
  private readonly memory = new Map<string, StoredProject>();
  private authSnapshot: AuthSnapshot;

  constructor() {
    this.authSnapshot = { status: 'signed_in', user: this.readUser() };
    this.auth = {
      getSnapshot: () => this.authSnapshot,
      subscribe: (listener) => {
        this.authListeners.add(listener);
        return () => this.authListeners.delete(listener);
      },
      signIn: async () => undefined,
      signOut: async () => undefined,
      updateName: async (name) => {
        const user = { ...this.user(), name: name.trim() || DEFAULT_USER.name };
        writeJson(USER_KEY, user);
        this.authSnapshot = { status: 'signed_in', user };
        this.authListeners.forEach((listener) => listener());
      },
    };

    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<ChannelMessage>) => this.onChannelMessage(event.data);
    }
  }

  // -------------------------------------------------------------------------
  // Projetos
  // -------------------------------------------------------------------------

  async listProjects(): Promise<ProjectSummary[]> {
    const user = this.user();
    return this.all().map((entry) => ({
      ...entry.project,
      role: 'owner' as const,
      noteCounts: countByBlock(entry.notes.filter((note) => !note.deletedAt)),
      memberCount: 1,
      owner: user,
    }));
  }

  async getProject(id: string): Promise<{ project: Project; notes: Note[] }> {
    const entry = this.entry(id);
    return {
      project: { ...entry.project, role: 'owner' },
      notes: entry.notes.filter((note) => !note.deletedAt).map(stripDeleted),
    };
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const value = normalizeProjectInput(input);
    if (!value.name) throw new AppError('validation', 'Informe o nome do projeto.');

    const now = new Date().toISOString();
    const project: Omit<Project, 'role'> = {
      id: newId(),
      ...value,
      archivedAt: null,
      ownerId: this.user().id,
      createdAt: now,
      updatedAt: now,
    };
    const entry: StoredProject = { project, notes: [], events: [], versions: [] };
    this.log(entry, 'project_created', { after: { name: project.name } });
    this.write(entry);
    return { ...project, role: 'owner' };
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project> {
    const entry = this.entry(id);
    const next = normalizeProjectInput({ ...pickInput(entry.project), ...patch });
    if (!next.name) throw new AppError('validation', 'Informe o nome do projeto.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(next) as Array<keyof ProjectInput>) {
      if (JSON.stringify(entry.project[key]) !== JSON.stringify(next[key])) {
        before[key] = entry.project[key];
        after[key] = next[key];
      }
    }

    if (Object.keys(after).length > 0) {
      Object.assign(entry.project, next, { updatedAt: new Date().toISOString() });
      this.log(entry, 'project_updated', { before, after });
      this.write(entry);
      this.emit(id, { type: 'project', project: { ...entry.project } });
    }
    return { ...entry.project, role: 'owner' };
  }

  async setArchived(id: string, archived: boolean): Promise<Project> {
    const entry = this.entry(id);
    const now = new Date().toISOString();
    entry.project.archivedAt = archived ? now : null;
    entry.project.updatedAt = now;
    this.log(entry, archived ? 'project_archived' : 'project_unarchived', {});
    this.write(entry);
    this.emit(id, { type: 'project', project: { ...entry.project } });
    return { ...entry.project, role: 'owner' };
  }

  async duplicateProject(id: string): Promise<string> {
    const source = this.entry(id);
    const now = new Date().toISOString();
    const user = this.user();
    const copyId = newId();
    const copy: StoredProject = {
      project: {
        ...source.project,
        id: copyId,
        name: `${source.project.name.slice(0, 151)} (cópia)`,
        archivedAt: null,
        ownerId: user.id,
        createdAt: now,
        updatedAt: now,
      },
      notes: source.notes
        .filter((note) => !note.deletedAt)
        .map((note) => ({
          ...note,
          id: newId(),
          projectId: copyId,
          version: 1,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })),
      events: [],
      versions: [],
    };
    this.log(copy, 'project_created', { after: { name: copy.project.name } });
    this.write(copy);
    return copyId;
  }

  async deleteProject(id: string): Promise<void> {
    this.entry(id);
    removeKey(LOCAL_PROJECT_PREFIX + id);
    this.memory.delete(id);
    this.emit(id, { type: 'access' });
  }

  // -------------------------------------------------------------------------
  // Notas
  // -------------------------------------------------------------------------

  async createNote(draft: NoteDraft): Promise<Note> {
    const entry = this.entry(draft.projectId);
    this.assertWritable(entry);

    const existing = entry.notes.find((note) => note.id === draft.id);
    if (existing) {
      // Recriar uma nota excluída não a traz de volta; para isso existe restoreNote.
      if (existing.deletedAt) throw new AppError('not_found');
      return stripDeleted(existing);
    }

    this.assertRoom(entry, draft.block, draft.id);
    this.ensureAutoVersion(entry);

    const now = new Date().toISOString();
    const user = this.user();
    const note: StoredNote = {
      id: draft.id,
      projectId: draft.projectId,
      block: draft.block,
      content: draft.content,
      position: draft.position,
      version: 1,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    entry.notes.push(note);
    entry.project.updatedAt = now;
    this.log(entry, 'note_created', { block: note.block, noteId: note.id, after: { content: note.content } });
    this.write(entry);
    this.emit(draft.projectId, { type: 'note', note: stripDeleted(note), deleted: false });
    return stripDeleted(note);
  }

  async updateNote(id: string, patch: NotePatch, baseVersion: number): Promise<UpdateResult> {
    const found = this.findNote(id);
    if (!found || found.note.deletedAt) return { ok: false, current: null };

    const { entry, note } = found;
    this.assertWritable(entry);
    if (note.version !== baseVersion) return { ok: false, current: stripDeleted(note) };

    if (patch.block && patch.block !== note.block) {
      this.assertRoom(entry, patch.block, note.id);
    }
    this.ensureAutoVersion(entry);

    const now = new Date().toISOString();
    const user = this.user();

    if (patch.block && patch.block !== note.block) {
      this.log(entry, 'note_moved', {
        block: patch.block,
        noteId: note.id,
        before: { block: note.block },
        after: { block: patch.block },
      });
      note.block = patch.block;
    }

    if (patch.content !== undefined && patch.content !== note.content) {
      const last = [...entry.events].reverse().find((event) => event.noteId === note.id);
      const recent = last && Date.now() - new Date(last.at).getTime() < COALESCE_MS;
      if (
        last &&
        recent &&
        (last.kind === 'note_created' || last.kind === 'note_updated') &&
        last.actor?.id === user.id
      ) {
        last.after = { content: patch.content };
        last.at = now;
      } else {
        this.log(entry, 'note_updated', {
          block: note.block,
          noteId: note.id,
          before: { content: note.content },
          after: { content: patch.content },
        });
      }
      note.content = patch.content;
    }

    if (patch.position !== undefined) note.position = patch.position;

    note.version += 1;
    note.updatedAt = now;
    note.updatedBy = user.id;
    entry.project.updatedAt = now;
    this.write(entry);
    this.emit(entry.project.id, { type: 'note', note: stripDeleted(note), deleted: false });
    return { ok: true, note: stripDeleted(note) };
  }

  async deleteNote(id: string, baseVersion?: number): Promise<DeleteResult> {
    const found = this.findNote(id);
    if (!found || found.note.deletedAt) return { ok: true };

    const { entry, note } = found;
    this.assertWritable(entry);
    if (baseVersion !== undefined && note.version !== baseVersion) return { ok: false, current: stripDeleted(note) };
    this.ensureAutoVersion(entry);

    const now = new Date().toISOString();
    note.deletedAt = now;
    note.version += 1;
    note.updatedAt = now;
    note.updatedBy = this.user().id;
    entry.project.updatedAt = now;
    this.log(entry, 'note_deleted', { block: note.block, noteId: note.id, before: { content: note.content } });
    this.write(entry);
    this.emit(entry.project.id, { type: 'note', note: stripDeleted(note), deleted: true });
    return { ok: true };
  }

  async restoreNote(id: string): Promise<Note> {
    const found = this.findNote(id);
    if (!found) throw new AppError('not_found');

    const { entry, note } = found;
    this.assertWritable(entry);
    if (!note.deletedAt) return stripDeleted(note);

    this.assertRoom(entry, note.block, note.id);
    const now = new Date().toISOString();
    note.deletedAt = null;
    note.version += 1;
    note.updatedAt = now;
    note.updatedBy = this.user().id;
    entry.project.updatedAt = now;
    this.log(entry, 'note_restored', { block: note.block, noteId: note.id, after: { content: note.content } });
    this.write(entry);
    this.emit(entry.project.id, { type: 'note', note: stripDeleted(note), deleted: false });
    return stripDeleted(note);
  }

  // -------------------------------------------------------------------------
  // Tempo real entre abas
  // -------------------------------------------------------------------------

  subscribe(projectId: string, handler: (change: ProjectChange) => void): Unsubscribe {
    const set = this.handlers.get(projectId) ?? new Set();
    set.add(handler);
    this.handlers.set(projectId, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(projectId);
    };
  }

  joinPresence(
    projectId: string,
    initial: Pick<PresenceState, 'editingNoteId' | 'block'>,
    onChange: (others: PresenceState[]) => void,
  ): PresenceHandle {
    const previous = this.rooms.get(projectId);
    if (previous) clearInterval(previous.timer);

    const room: PresenceRoom = {
      state: { connectionId: this.connectionId, user: this.user(), ...initial },
      onChange,
      others: new Map(),
      timer: setInterval(() => {
        this.post({ kind: 'presence', from: this.connectionId, projectId, state: room.state });
        this.prunePresence(room);
      }, PRESENCE_BEAT_MS),
    };
    this.rooms.set(projectId, room);

    this.post({ kind: 'presence', from: this.connectionId, projectId, state: room.state });
    this.post({ kind: 'presence-request', from: this.connectionId, projectId });

    const onUnload = () => this.post({ kind: 'presence-leave', from: this.connectionId, projectId });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onUnload);

    return {
      update: (patch) => {
        room.state = { ...room.state, ...patch };
        this.post({ kind: 'presence', from: this.connectionId, projectId, state: room.state });
      },
      leave: () => {
        clearInterval(room.timer);
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', onUnload);
        // Se outra sessão desta aba já assumiu a sala, a presença continua valendo.
        if (this.rooms.get(projectId) === room) {
          this.rooms.delete(projectId);
          onUnload();
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Histórico e versões
  // -------------------------------------------------------------------------

  async listEvents(projectId: string, options: { limit?: number; before?: string } = {}): Promise<HistoryEvent[]> {
    const entry = this.entry(projectId);
    const limit = options.limit ?? 50;
    let events = [...entry.events].sort((a, b) => b.at.localeCompare(a.at));
    if (options.before) events = events.filter((event) => event.at < options.before!);
    return events.slice(0, limit);
  }

  async listVersions(projectId: string): Promise<VersionSummary[]> {
    const entry = this.entry(projectId);
    return [...entry.versions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((version) => ({
        id: version.id,
        projectId,
        label: version.label,
        kind: version.kind,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        noteCount: version.notes.length,
      }));
  }

  async createVersion(projectId: string, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new AppError('invalid_label');

    const entry = this.entry(projectId);
    this.snapshot(entry, trimmed.slice(0, 160), 'manual');
    this.log(entry, 'version_created', { after: { label: trimmed } });
    this.write(entry);
  }

  async restoreVersion(versionId: string): Promise<void> {
    const entry = this.all().find((candidate) => candidate.versions.some((version) => version.id === versionId));
    if (!entry) throw new AppError('not_found');
    this.assertWritable(entry);

    const version = entry.versions.find((candidate) => candidate.id === versionId)!;
    this.snapshot(entry, `Antes de restaurar "${version.label}"`.slice(0, 160), 'restore');

    const now = new Date().toISOString();
    const user = this.user();
    for (const note of entry.notes) {
      if (!note.deletedAt) {
        note.deletedAt = now;
        note.version += 1;
        note.updatedAt = now;
      }
    }
    for (const saved of version.notes) {
      const existing = entry.notes.find((note) => note.id === saved.id);
      if (existing) {
        Object.assign(existing, saved, { deletedAt: null, version: existing.version + 1, updatedAt: now, updatedBy: user.id });
      } else {
        entry.notes.push({
          ...saved,
          projectId: entry.project.id,
          version: 1,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }
    entry.project.updatedAt = now;
    this.log(entry, 'version_restored', { after: { label: version.label, version_id: version.id } });
    this.write(entry);
    this.emit(entry.project.id, { type: 'resync' });
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private all(): StoredProject[] {
    const storage = safeLocalStorage();
    if (!storage) return [...this.memory.values()];

    const entries: StoredProject[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(LOCAL_PROJECT_PREFIX)) {
        const entry = readJson<StoredProject | null>(key, null);
        if (entry?.project) entries.push(entry);
      }
    }
    return entries;
  }

  private write(entry: StoredProject): void {
    if (!safeLocalStorage()) {
      // Sem armazenamento (janela privada restrita): os dados valem só para esta visita.
      this.memory.set(entry.project.id, entry);
      return;
    }
    if (!writeJson(LOCAL_PROJECT_PREFIX + entry.project.id, entry)) {
      throw new AppError(
        'unknown',
        'Não foi possível salvar neste navegador. O armazenamento local pode estar cheio ou bloqueado.',
      );
    }
  }

  private readUser(): Person {
    const override = readJson<Person | null>(USER_KEY, null, safeSessionStorage());
    return override ?? readJson<Person>(USER_KEY, DEFAULT_USER);
  }

  private user(): Person {
    return this.authSnapshot.user ?? DEFAULT_USER;
  }

  private entry(projectId: string): StoredProject {
    const entry = safeLocalStorage()
      ? readJson<StoredProject | null>(LOCAL_PROJECT_PREFIX + projectId, null)
      : (this.memory.get(projectId) ?? null);
    if (!entry?.project) throw new AppError('not_found');
    return entry;
  }

  private findNote(noteId: string): { entry: StoredProject; note: StoredNote } | null {
    for (const entry of this.all()) {
      const note = entry.notes.find((candidate) => candidate.id === noteId);
      if (note) return { entry, note };
    }
    return null;
  }

  private assertWritable(entry: StoredProject): void {
    if (entry.project.archivedAt) throw new AppError('project_archived');
  }

  private assertRoom(entry: StoredProject, block: BlockId, ignoreNoteId: string): void {
    const used = entry.notes.filter(
      (note) => note.block === block && !note.deletedAt && note.id !== ignoreNoteId,
    ).length;
    if (used >= getBlock(block).limit) throw new AppError('block_full', undefined, block);
  }

  private snapshot(entry: StoredProject, label: string, kind: VersionKind): void {
    entry.versions.push({
      id: newId(),
      label,
      kind,
      createdAt: new Date().toISOString(),
      createdBy: this.user(),
      notes: entry.notes
        .filter((note) => !note.deletedAt)
        .map(({ id, block, content, position }) => ({ id, block, content, position })),
    });
  }

  /** Mesma regra do servidor: guarda o estado antes da primeira alteração após 24 horas. */
  private ensureAutoVersion(entry: StoredProject): void {
    const now = Date.now();
    if (now - new Date(entry.project.createdAt).getTime() < DAY_MS) return;
    if (entry.versions.some((version) => now - new Date(version.createdAt).getTime() < DAY_MS)) return;
    if (!entry.notes.some((note) => !note.deletedAt)) return;

    this.snapshot(entry, 'Versão automática', 'auto');
    const autos = entry.versions.filter((version) => version.kind === 'auto');
    if (autos.length > MAX_AUTO_VERSIONS) {
      const drop = new Set(autos.slice(0, autos.length - MAX_AUTO_VERSIONS).map((version) => version.id));
      entry.versions = entry.versions.filter((version) => !drop.has(version.id));
    }
  }

  private log(
    entry: StoredProject,
    kind: HistoryKind,
    data: { block?: BlockId; noteId?: string; before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): void {
    entry.events.push({
      id: newId(),
      projectId: entry.project.id,
      actor: this.user(),
      at: new Date().toISOString(),
      kind,
      block: data.block ?? null,
      noteId: data.noteId ?? null,
      before: data.before ?? null,
      after: data.after ?? null,
    });
    if (entry.events.length > MAX_EVENTS) {
      entry.events.splice(0, entry.events.length - MAX_EVENTS);
    }
  }

  /** Entrega a alteração aos assinantes desta aba (de forma assíncrona) e às demais abas. */
  private emit(projectId: string, change: ProjectChange): void {
    queueMicrotask(() => this.deliver(projectId, change));
    this.post({ kind: 'change', from: this.connectionId, projectId, change });
  }

  private deliver(projectId: string, change: ProjectChange): void {
    this.handlers.get(projectId)?.forEach((handler) => handler(change));
  }

  private post(message: ChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* canal fechado */
    }
  }

  private onChannelMessage(message: ChannelMessage): void {
    if (!message || message.from === this.connectionId) return;

    if (message.kind === 'change') {
      this.deliver(message.projectId, message.change);
      return;
    }

    const room = this.rooms.get(message.projectId);
    if (!room) return;

    if (message.kind === 'presence') {
      room.others.set(message.from, { state: message.state, seenAt: Date.now() });
      this.notifyPresence(room);
    } else if (message.kind === 'presence-leave') {
      if (room.others.delete(message.from)) this.notifyPresence(room);
    } else if (message.kind === 'presence-request') {
      this.post({ kind: 'presence', from: this.connectionId, projectId: message.projectId, state: room.state });
    }
  }

  private prunePresence(room: PresenceRoom): void {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    let changed = false;
    for (const [connectionId, entry] of room.others) {
      if (entry.seenAt < cutoff) {
        room.others.delete(connectionId);
        changed = true;
      }
    }
    if (changed) this.notifyPresence(room);
  }

  private notifyPresence(room: PresenceRoom): void {
    room.onChange([...room.others.values()].map((entry) => entry.state));
  }
}

function stripDeleted(note: StoredNote): Note {
  const { deletedAt: _deletedAt, ...rest } = note;
  return rest;
}

function pickInput(project: Omit<Project, 'role'>): ProjectInput {
  return {
    name: project.name,
    description: project.description,
    organization: project.organization,
    responsible: project.responsible,
    participants: project.participants,
    status: project.status,
  };
}
