import { BLOCKS, getBlock, type BlockId } from '@/methodology/agitar';
import { canEdit, type Note, type PresenceState, type Project, type ProjectInput } from '@/domain/types';
import type { NotePatch, PresenceHandle, ProjectChange, Repository, Unsubscribe } from '@/data/repository';
import { AppError, toAppError, type ErrorCode } from '@/lib/errors';
import { newId } from '@/lib/id';
import {
  CACHE_PREFIX,
  OUTBOX_PREFIX,
  listKeys,
  readJson,
  removeKey,
  safeLocalStorage,
  writeJson,
} from '@/lib/storage';

/**
 * Sessão de trabalho em um projeto.
 *
 * Concentra o estado do canvas e garante que nada do que foi digitado se
 * perca. O modelo é de sincronização por estado, não por lista de comandos:
 *
 *   1. Para cada nota alterada existe uma pendência com o estado desejado
 *      (texto, bloco e posição, ou exclusão) e o estado do servidor em que a
 *      alteração se baseou. A tela mostra o estado do servidor com as
 *      pendências aplicadas por cima.
 *   2. As pendências são gravadas no navegador antes de qualquer chamada de
 *      rede e só saem de lá quando o servidor confirma o estado desejado.
 *      Reenviar é sempre seguro: cada envio compara o desejado com o atual.
 *   3. Sem conexão, sem sessão válida ou diante de uma falha do servidor, as
 *      pendências aguardam e são reenviadas, inclusive depois de fechar e
 *      reabrir o navegador. Só são descartadas quando o servidor recusa a
 *      alteração de forma definitiva (falta de permissão, projeto arquivado).
 *   4. Cada gravação informa a versão da nota em que se baseou. Quando a nota
 *      mudou no servidor, a pendência é reposicionada sobre o estado atual por
 *      uma fusão de três vias, campo a campo: o que só um lado alterou é
 *      mantido; bloco e posição alterados nos dois lados ficam com o valor
 *      local; texto alterado nos dois lados vira um conflito, exposto para
 *      decisão do usuário em vez de sobrescrever.
 *
 * A classe não depende de React; a interface a consome por subscribe/getSnapshot.
 */

export type SaveStatus =
  /** Tudo gravado. */
  | 'saved'
  /** Há alterações aguardando envio ou em envio. */
  | 'saving'
  /** Sem conexão; as alterações serão enviadas quando a rede voltar. */
  | 'offline'
  /** A sessão do usuário expirou; as alterações aguardam um novo login. */
  | 'paused'
  /** O servidor não confirmou a gravação; novas tentativas estão agendadas. */
  | 'error'
  /** Há conflitos de edição aguardando decisão. */
  | 'conflict';

export type SessionPhase = 'loading' | 'ready' | 'not_found' | 'error';

export interface SessionSnapshot {
  phase: SessionPhase;
  error: string | null;
  project: Project | null;
  /** Notas ativas, ordenadas por bloco e posição. */
  notes: Note[];
  /**
   * Notas com conflito de edição. O valor é a versão atual no servidor, ou
   * null quando a nota foi excluída por outra pessoa.
   */
  conflicts: Record<string, Note | null>;
  save: { status: SaveStatus; pending: number; lastSavedAt: string | null };
  /** Outras conexões presentes no projeto. */
  presence: PresenceState[];
  readOnly: boolean;
  /** Verdadeiro quando o conteúdo exibido veio da cópia local por falta de conexão. */
  stale: boolean;
  /** Incrementado a cada alteração de conteúdo; útil para atualizar painéis derivados. */
  revision: number;
}

export interface SessionNotice {
  level: 'error' | 'info';
  message: string;
}

export interface SessionOptions {
  /** Espera antes de enviar edições de texto, para fundir a digitação. */
  debounceMs?: number;
  onNotice?: (notice: SessionNotice) => void;
}

interface Fields {
  block: BlockId;
  content: string;
  position: number;
}

interface Base extends Fields {
  version: number;
}

/** Alteração local de uma nota ainda não confirmada pelo servidor. */
interface Pending {
  noteId: string;
  /** Ordem de envio. */
  seq: number;
  /** Estado desejado da nota. */
  target: Fields;
  /** O usuário excluiu a nota; o estado desejado fica guardado para o caso de a exclusão ser desfeita. */
  deleted: boolean;
  /** Estado do servidor em que a alteração se baseia; null enquanto a nota não existe lá. */
  base: Base | null;
  /** Já houve tentativa de criar a nota no servidor (a resposta pode ter se perdido). */
  sent: boolean;
  /** A nota pode ter sido excluída no servidor por esta sessão e precisa ser restaurada. */
  restore: boolean;
  /** O estado desejado prevalece sobre o que o servidor devolver (decisão explícita do usuário). */
  force: boolean;
  /**
   * Valores enviados desde a última resposta do servidor. Servem para
   * reconhecer as próprias gravações quando a resposta se perde.
   */
  tried: NotePatch[];
  /**
   * Versão informada em uma atualização cujo resultado ainda é desconhecido
   * (em envio, ou com a resposta perdida). Enquanto houver dúvida, a pendência
   * não é dada por resolvida, mesmo que o estado desejado volte a coincidir
   * com a base.
   */
  doubt: number | null;
  /** A lista de valores enviados precisou descartar os mais antigos durante uma dúvida. */
  overflow: boolean;
  /** Conflito aguardando decisão; a edição não é enviada enquanto existir. */
  conflict: { theirs: Note | null } | null;
  /**
   * O texto local e o do servidor divergiram e o usuário ainda não decidiu.
   * Enquanto for assim, qualquer novo estado do servidor com texto diferente
   * do local continua sendo um conflito, não importa por que caminho chegue.
   */
  diverged: boolean;
  /** O usuário já foi avisado de que o bloco de destino está cheio no servidor. */
  warned: boolean;
  createdAt: string;
  changedAt: string;
  /** Instante a partir do qual pode ser enviada (espera da digitação ou nova tentativa). */
  notBefore: number;
  /** Falhas consecutivas do servidor. */
  failures: number;
}

interface StoredOutbox {
  /** Último sinal de vida da sessão dona; 0 quando a sessão foi encerrada. */
  beat: number;
  entries: Pending[];
}

interface CachedProject {
  project: Project;
  notes: Note[];
}

interface Tombstone {
  version: number;
  /** Verdadeiro quando a versão veio do servidor; falso quando foi estimada. */
  exact: boolean;
}

/** Origem de um estado do servidor: resposta a um envio desta pendência, ou observação (tempo real, recarga). */
type Source = 'response' | 'observed';

/** Recusas definitivas do servidor: reenviar não mudaria o resultado. */
const PERMANENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['forbidden', 'project_archived', 'validation', 'not_found']);

const HOLD_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];
const FAILURE_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const HEARTBEAT_MS = 5_000;
const ORPHAN_AFTER_MS = 15_000;
const CACHE_DELAY_MS = 1_000;
const RESYNC_AFTER_HIDDEN_MS = 60_000;
const MAX_TRIED = 8;
const MAX_ROUNDS_PER_NOTE = 8;

interface LockManagerLike {
  request<T>(name: string, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
  request<T>(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
}

/** Travas entre abas (Web Locks), quando o navegador oferece. */
function lockManager(): LockManagerLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as unknown as { locks?: LockManagerLike }).locks;
}

export class ProjectSession {
  private readonly listeners = new Set<() => void>();
  private readonly debounceMs: number;
  private readonly onNotice: (notice: SessionNotice) => void;
  private readonly userId: string;
  private readonly outboxPrefix: string;
  private readonly outboxKey: string;
  private readonly cacheKey: string;

  private phase: SessionPhase = 'loading';
  private error: string | null = null;
  private project: Project | null = null;
  /** Último estado de cada nota ativa confirmado pelo servidor. */
  private server = new Map<string, Note>();
  /** Notas sabidamente excluídas no servidor e a versão em que isso ocorreu. */
  private tombstones = new Map<string, Tombstone>();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private presence: PresenceState[] = [];
  private stale = false;
  private revision = 0;
  private lastSavedAt: string | null = null;

  /** Fila de execução: gravações e recargas nunca correm ao mesmo tempo. */
  private chain: Promise<unknown> = Promise.resolve();
  private drainQueued = false;
  private offline = false;
  private authHold = false;
  private holdUntil = 0;
  private holdAttempt = 0;
  /** O estado exibido pode estar desatualizado e precisa ser relido do servidor. */
  private reloadWanted = false;
  private lastReloadAt = 0;
  private hiddenAt = 0;
  /** Notas alteradas por eventos em tempo real durante uma recarga em andamento. */
  private refreshTouched: Set<string> | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;

  private unsubscribeChanges: Unsubscribe | null = null;
  private unsubscribeAuth: Unsubscribe | null = null;
  private presenceHandle: PresenceHandle | null = null;
  private presenceState: Pick<PresenceState, 'editingNoteId' | 'block'> = { editingNoteId: null, block: null };
  private disposed = false;
  /** A sessão foi encerrada ou a página está saindo: outra sessão pode assumir as pendências. */
  private released = false;
  private releaseLock: (() => void) | null = null;
  /** As pendências já foram gravadas no navegador ao menos uma vez. */
  private everPersisted = false;
  /** Depois de encerrada, esta sessão teve as pendências assumidas por outra. */
  private handedOver = false;
  private snapshot: SessionSnapshot;

  constructor(
    private readonly repo: Repository,
    readonly projectId: string,
    options: SessionOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 700;
    this.onNotice = options.onNotice ?? (() => undefined);
    // As chaves incluem o usuário: contas diferentes no mesmo navegador nunca
    // compartilham pendências nem cópias locais.
    this.userId = this.repo.auth.getSnapshot().user?.id ?? 'anon';
    this.outboxPrefix = `${OUTBOX_PREFIX}${this.userId}.${projectId}.`;
    this.outboxKey = `${this.outboxPrefix}${newId()}`;
    this.cacheKey = `${CACHE_PREFIX}${this.userId}.${projectId}`;
    this.snapshot = this.buildSnapshot();
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('pagehide', this.handlePageHide);
      window.addEventListener('pageshow', this.handlePageShow);
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
    this.unsubscribeAuth = this.repo.auth.subscribe(this.handleAuth);
    this.acquireLock();

    await this.exclusive(() => this.load());
    if (this.disposed || this.phase !== 'ready') return;

    this.unsubscribeChanges = this.repo.subscribe(this.projectId, this.handleChange);
    try {
      this.presenceHandle = this.repo.joinPresence(this.projectId, this.presenceState, (others) => {
        this.presence = others;
        this.emit();
      });
    } catch {
      // Sem presença o projeto continua utilizável.
      this.presenceHandle = null;
    }

    this.beatTimer = setInterval(this.beat, HEARTBEAT_MS);
    this.scheduleNext();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.timer) clearTimeout(this.timer);
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.timer = null;
    this.cacheTimer = null;
    this.beatTimer = null;

    this.unsubscribeChanges?.();
    this.unsubscribeAuth?.();
    this.presenceHandle?.leave();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('pagehide', this.handlePageHide);
      window.removeEventListener('pageshow', this.handlePageShow);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    this.listeners.clear();

    // A partir daqui outra sessão pode assumir as pendências; enviar a mesma
    // pendência duas vezes é inofensivo. Há ainda uma última tentativa de
    // envio, e o que não for confirmado permanece gravado no navegador.
    this.released = true;
    this.dropLock();
    const finish = () => {
      this.persist();
      this.writeCache();
    };
    finish();
    if (this.phase === 'ready' && this.hasSendable()) {
      void this.exclusive(() => this.drain(true)).then(finish, finish);
    }
  }

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  // -------------------------------------------------------------------------
  // Ações do usuário
  // -------------------------------------------------------------------------

  /** Cria uma nota no bloco. Retorna o id, ou null se o bloco está cheio ou a sessão é somente leitura. */
  addNote(block: BlockId, content = ''): string | null {
    if (this.isReadOnly()) return null;

    const inBlock = this.notesIn(block);
    if (inBlock.length >= getBlock(block).limit) {
      this.onNotice({ level: 'error', message: new AppError('block_full').message });
      return null;
    }

    const noteId = newId();
    const entry = this.newEntry(noteId, { block, content, position: nextPosition(inBlock) }, null);
    // A criação espera a digitação: o primeiro envio já leva o texto.
    entry.notBefore = Date.now() + this.debounceMs;
    this.commit();
    return noteId;
  }

  editNote(noteId: string, content: string): void {
    if (this.isReadOnly()) return;
    const entry = this.entryFor(noteId);
    if (!entry) return;
    if (entry.deleted || entry.target.content === content) {
      this.settle(entry);
      return;
    }

    entry.target.content = content;
    entry.changedAt = new Date().toISOString();
    entry.notBefore = Date.now() + this.debounceMs;
    this.settle(entry);
    this.commit();
  }

  moveNote(noteId: string, block: BlockId): boolean {
    const note = this.view().get(noteId);
    if (!note || this.isReadOnly() || note.block === block) return false;

    const destination = this.notesIn(block);
    if (destination.length >= getBlock(block).limit) {
      this.onNotice({ level: 'error', message: `O bloco "${getBlock(block).title}" atingiu o limite de notas.` });
      return false;
    }

    const entry = this.entryFor(noteId);
    if (!entry || entry.deleted) return false;
    entry.target.block = block;
    entry.target.position = nextPosition(destination);
    // Ocupa lugar em outro bloco: vai para o fim da ordem de envio, depois das
    // alterações que abriram esse lugar.
    entry.seq = ++this.seq;
    entry.changedAt = new Date().toISOString();
    entry.notBefore = 0;
    entry.warned = false;
    this.settle(entry);
    this.commit();
    return true;
  }

  /** Move a nota uma posição para cima (-1) ou para baixo (1) dentro do bloco. */
  reorderNote(noteId: string, direction: -1 | 1): void {
    const note = this.view().get(noteId);
    if (!note || this.isReadOnly()) return;

    const siblings = this.notesIn(note.block);
    const index = siblings.findIndex((candidate) => candidate.id === noteId);
    const other = siblings[index + direction];
    if (!other) return;

    // Posições iguais (dados antigos) são desempatadas antes da troca.
    const positions: Array<[string, number]> = [
      [note.id, note.position === other.position ? other.position + direction : other.position],
      [other.id, note.position],
    ];
    const now = new Date().toISOString();
    for (const [id, position] of positions) {
      const entry = this.entryFor(id);
      if (!entry || entry.deleted) continue;
      entry.target.position = position;
      entry.changedAt = now;
      entry.notBefore = 0;
      this.settle(entry);
    }
    this.commit();
  }

  /** Exclui a nota e devolve uma função que desfaz a exclusão. */
  deleteNote(noteId: string): (() => void) | null {
    const note = this.view().get(noteId);
    if (!note || this.isReadOnly()) return null;

    const entry = this.entryFor(noteId);
    if (!entry) return null;

    // O estado desejado continua guardado na pendência (inclusive texto ainda
    // não gravado e um conflito em aberto): desfazer apenas retira a marca.
    // Nunca chegou a ser enviada, ou já está excluída no servidor por outra
    // pessoa: não há o que enviar.
    const nothingToSend = (entry.base === null && !entry.sent) || entry.conflict?.theirs === null;
    entry.deleted = true;
    entry.changedAt = new Date().toISOString();
    entry.notBefore = 0;
    entry.failures = 0;
    if (nothingToSend) this.pending.delete(noteId);
    this.commit();

    return () => {
      // Se a nota já voltou à tela, a exclusão foi cancelada (outra pessoa
      // alterou o texto) e o que havia de local já está de volta com ela.
      if (this.disposed || this.isReadOnly() || this.view().has(noteId)) return;
      if (this.notesIn(entry.target.block).length >= getBlock(entry.target.block).limit) {
        this.onNotice({ level: 'error', message: new AppError('block_full').message });
        return;
      }

      const current = this.pending.get(noteId);
      const restored = current ?? entry;
      if (!current) {
        // A exclusão já foi confirmada (ou nunca precisou ser enviada): a
        // mesma pendência volta, com a base que tinha, e a nota é restaurada.
        restored.restore = !nothingToSend;
        restored.doubt = null;
        this.pending.set(noteId, restored);
      }
      restored.deleted = false;
      restored.seq = ++this.seq;
      restored.changedAt = new Date().toISOString();
      restored.notBefore = 0;
      restored.failures = 0;
      this.settle(restored);
      this.commit();
    };
  }

  /**
   * Resolve um conflito de edição.
   *   "mine":   mantém o texto local e grava sobre a versão atual do servidor.
   *   "theirs": descarta o texto local e adota a versão do servidor.
   */
  resolveConflict(noteId: string, choice: 'mine' | 'theirs'): void {
    const entry = this.pending.get(noteId);
    if (!entry?.conflict) return;

    const { theirs } = entry.conflict;
    entry.conflict = null;
    entry.diverged = false;

    if (choice === 'theirs') {
      this.pending.delete(noteId);
    } else {
      if (theirs === null) {
        // A nota foi excluída por outra pessoa: restaura e grava o texto local.
        entry.restore = true;
        entry.force = true;
      } else {
        // Bloco e posição já acompanham o servidor desde que o conflito surgiu.
        entry.base = baseOf(theirs);
      }
      entry.seq = ++this.seq;
      entry.notBefore = 0;
      entry.failures = 0;
      this.settle(entry);
    }
    this.commit();
  }

  /** Informa aos demais participantes o que este usuário está fazendo. */
  setActivity(activity: Pick<PresenceState, 'editingNoteId' | 'block'>): void {
    if (
      this.presenceState.editingNoteId === activity.editingNoteId &&
      this.presenceState.block === activity.block
    ) {
      return;
    }
    this.presenceState = activity;
    this.presenceHandle?.update(activity);
  }

  async updateProject(patch: Partial<ProjectInput>): Promise<void> {
    const project = await this.repo.updateProject(this.projectId, patch);
    this.project = project;
    this.touch();
    this.scheduleCache();
  }

  async setArchived(archived: boolean): Promise<void> {
    await this.flushNow();
    this.project = await this.repo.setArchived(this.projectId, archived);
    this.touch();
    this.scheduleCache();
  }

  /**
   * Envia imediatamente o que estiver pendente, sem aguardar a espera da
   * digitação nem o intervalo entre tentativas.
   */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Encerra a espera da digitação e os intervalos entre tentativas: se o
    // envio não for possível agora, acontece assim que voltar a ser.
    for (const entry of this.pending.values()) entry.notBefore = 0;
    await this.exclusive(() => this.drain(true));
    this.scheduleNext();
  }

  /** Recarrega projeto e notas do servidor, preservando alterações ainda não enviadas. */
  async refresh(): Promise<void> {
    await this.exclusive(() => this.reload());
    this.scheduleNext();
  }

  // -------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------

  private async load(): Promise<void> {
    try {
      const { project, notes } = await this.repo.getProject(this.projectId);
      if (this.disposed) return;
      this.applyServerState(project, notes, true);
      this.phase = 'ready';
      this.stale = false;
      this.lastSavedAt = project.updatedAt;
      this.lastReloadAt = Date.now();
    } catch (error) {
      if (this.disposed) return;
      const appError = toAppError(error);
      const cached = appError.code === 'network' ? readJson<CachedProject | null>(this.cacheKey, null) : null;

      if (cached?.project && Array.isArray(cached.notes)) {
        // Sem conexão: trabalha sobre a última cópia conhecida.
        this.applyServerState(cached.project, cached.notes, false);
        this.phase = 'ready';
        this.stale = true;
        this.offline = true;
        this.lastSavedAt = cached.project.updatedAt;
        this.hold();
      } else if (appError.code === 'not_found' || appError.code === 'forbidden') {
        this.phase = 'not_found';
      } else {
        this.phase = 'error';
        this.error = appError.message;
      }
    }

    if (this.phase === 'ready') {
      await this.adoptOrphans();
      if (this.disposed) return;
      if (!this.stale) this.scheduleCache();
    }
    this.emit();
  }

  private async reload(): Promise<void> {
    if (this.disposed || this.phase !== 'ready') return;

    this.refreshTouched = new Set();
    try {
      const { project, notes } = await this.repo.getProject(this.projectId);
      if (this.disposed) return;
      this.applyServerState(project, notes, true);
      this.stale = false;
      this.reloadWanted = false;
      this.offline = false;
      this.holdAttempt = 0;
      this.lastReloadAt = Date.now();
      this.persist();
      this.touch();
      this.scheduleCache();
    } catch (error) {
      if (toAppError(error).code === 'not_found') {
        this.loseAccess();
      } else {
        // Sem resposta útil do servidor: nova tentativa depois de um intervalo.
        if (toAppError(error).code === 'network') this.offline = true;
        this.reloadWanted = true;
        this.hold();
        this.emit();
      }
    } finally {
      this.refreshTouched = null;
    }
  }

  /**
   * O projeto deixou de existir ou o acesso foi removido. O que ainda não
   * havia sido enviado continua guardado no navegador, para o caso de o
   * acesso ser devolvido.
   */
  private loseAccess(): void {
    this.released = true;
    this.persist();
    this.dropLock();
    this.phase = 'not_found';
    this.project = null;
    this.server.clear();
    this.tombstones.clear();
    this.pending.clear();
    removeKey(this.cacheKey);
    this.emit();
  }

  /**
   * Adota o estado recebido do servidor e reposiciona as pendências sobre ele.
   * Uma cópia local (authoritative = false) não permite concluir que notas
   * ausentes foram excluídas.
   */
  private applyServerState(project: Project, notes: Note[], authoritative: boolean): void {
    this.project = project;

    const seen = new Set<string>();
    for (const note of notes) {
      seen.add(note.id);
      if (!this.acceptNote(note)) continue;
      const entry = this.pending.get(note.id);
      if (entry) this.rebase(entry, note, 'observed');
    }
    if (!authoritative) return;

    const touched = this.refreshTouched;
    for (const id of [...this.server.keys()]) {
      if (seen.has(id) || touched?.has(id)) continue;
      this.acceptDeletion(id);
      const entry = this.pending.get(id);
      if (entry) this.rebase(entry, null, 'observed');
    }
    for (const entry of [...this.pending.values()]) {
      if (entry.base && !this.server.has(entry.noteId) && !touched?.has(entry.noteId)) {
        this.rebase(entry, null, 'observed');
      }
    }
  }

  /**
   * Registra o estado de uma nota vindo do servidor, a menos que seja mais
   * antigo que o conhecido. A resposta a uma criação ou restauração desta
   * sessão (ownWrite) prevalece sobre uma exclusão apenas estimada.
   */
  private acceptNote(note: Note, ownWrite = false): boolean {
    const known = this.server.get(note.id);
    if (known && note.version < known.version) return false;
    const tombstone = this.tombstones.get(note.id);
    if (tombstone && note.version <= tombstone.version && !(ownWrite && !tombstone.exact)) return false;
    this.tombstones.delete(note.id);
    this.server.set(note.id, note);
    return true;
  }

  private acceptDeletion(noteId: string, version?: number): boolean {
    const known = this.server.get(noteId);
    if (known && version !== undefined && version < known.version) return false;
    const previous = this.tombstones.get(noteId);
    if (version !== undefined) {
      if (!previous || version >= previous.version) this.tombstones.set(noteId, { version, exact: true });
    } else if (known || !previous) {
      // Sem a versão da exclusão, vale uma estimativa: a seguinte à conhecida.
      const estimate = known ? known.version + 1 : 1;
      if (!previous || estimate > previous.version) this.tombstones.set(noteId, { version: estimate, exact: false });
    }
    this.server.delete(noteId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Pendências
  // -------------------------------------------------------------------------

  private newEntry(noteId: string, target: Fields, base: Base | null): Pending {
    const now = new Date().toISOString();
    const entry: Pending = {
      noteId,
      seq: ++this.seq,
      target,
      deleted: false,
      base,
      sent: false,
      restore: false,
      force: false,
      tried: [],
      doubt: null,
      overflow: false,
      conflict: null,
      diverged: false,
      warned: false,
      createdAt: now,
      changedAt: now,
      notBefore: 0,
      failures: 0,
    };
    this.pending.set(noteId, entry);
    return entry;
  }

  /** Pendência da nota, criada a partir do estado do servidor se ainda não existir. */
  private entryFor(noteId: string): Pending | null {
    const existing = this.pending.get(noteId);
    if (existing) return existing;

    const note = this.server.get(noteId);
    if (!note) return null;

    const entry = this.newEntry(noteId, fieldsOf(note), baseOf(note));
    entry.sent = true;
    entry.createdAt = note.createdAt;
    return entry;
  }

  /**
   * Remove a pendência que não tem mais nada a gravar: o estado desejado
   * coincide com o do servidor e não há envio de resultado desconhecido.
   */
  private settle(entry: Pending): void {
    if (this.pending.get(entry.noteId) !== entry) return;
    if (entry.deleted || entry.conflict || !entry.base || entry.restore || entry.doubt !== null) return;
    if (sameFields(entry.target, entry.base)) this.pending.delete(entry.noteId);
  }

  /**
   * Reposiciona a pendência sobre o estado atual da nota no servidor
   * (current = null quando a nota foi excluída lá), por fusão de três vias
   * entre a base, o estado desejado e o estado atual:
   *
   *   - campo que só o servidor alterou acompanha o servidor;
   *   - campo que só o usuário alterou permanece como o usuário deixou;
   *   - bloco e posição alterados nos dois lados ficam com o valor local;
   *   - texto alterado nos dois lados é um conflito.
   *
   * Um valor que esta própria pendência enviou não conta como alteração do
   * servidor: é uma gravação anterior cuja resposta se perdeu.
   */
  private rebase(entry: Pending, current: Note | null, source: Source): void {
    const id = entry.noteId;
    if (this.pending.get(id) !== entry) return;

    const base = entry.base;
    if (current && base && current.version < base.version) return;

    // O resultado do último envio deixa de ser dúvida quando chega a resposta
    // ou quando o servidor já está além da versão informada naquele envio.
    const doubt = entry.doubt;
    const superseded = current !== null && (base === null || (doubt !== null && current.version > doubt));
    if (source === 'response' || !current || superseded) entry.doubt = null;

    const tried = entry.tried;
    const overflow = entry.overflow;
    if (source === 'response' || superseded) {
      // Os envios anteriores já chegaram ou não chegarão mais.
      entry.tried = [];
      entry.overflow = false;
    }

    if (!current) {
      if (entry.deleted) this.pending.delete(id);
      else if (entry.conflict) entry.conflict = { theirs: null };
      else if (base === null || entry.restore) return; // aguarda a criação ou a restauração
      else if (entry.target.content !== base.content) entry.conflict = { theirs: null };
      else this.pending.delete(id);
      return;
    }

    const target = entry.target;
    let contentChangedRemotely = false;
    let clash = false;

    if (!entry.force) {
      // Quando a lista de envios transbordou, vale um indício mais fraco: a
      // única gravação feita desde a base é deste usuário.
      const ownByAuthor =
        overflow && doubt !== null && current.version === doubt + 1 && current.updatedBy === this.userId;

      // Fusão de um campo. Com base, compara-se com ela. Na criação ainda não
      // confirmada não se sabe qual dos envios chegou: o servidor só alterou o
      // campo se o valor atual não é nenhum dos enviados, e o usuário só o
      // manteve se todos os envios levaram o valor que ele deseja agora.
      const merge = <K extends keyof Fields>(field: K): 'kept' | 'adopted' | 'both' => {
        const sent = (value: Fields[K]) => ownByAuthor || tried.some((patch) => patch[field] === value);
        const remote = base
          ? current[field] !== base[field] && !sent(current[field])
          : tried.length > 0 && !sent(current[field]);
        if (!remote) return 'kept';

        const local = base ? target[field] !== base[field] : !tried.every((patch) => patch[field] === target[field]);
        if (local) return 'both';
        target[field] = current[field];
        return 'adopted';
      };

      merge('block');
      merge('position');
      const content = merge('content');
      contentChangedRemotely = content !== 'kept';
      clash = (content === 'both' || entry.diverged) && target.content !== current.content;
    }

    entry.base = baseOf(current);
    entry.force = false;
    entry.diverged = clash;
    entry.conflict = clash ? { theirs: current } : null;

    if (entry.deleted && contentChangedRemotely) {
      // Outra pessoa alterou o texto depois do pedido de exclusão: a nota é
      // mantida. Ninguém apaga o que não chegou a ver.
      entry.deleted = false;
      this.onNotice({
        level: 'info',
        message: 'Uma nota que você excluiu foi alterada por outra pessoa nesse intervalo e, por isso, foi mantida.',
      });
    }
    this.settle(entry);
  }

  /**
   * Há algo a enviar: uma edição sem conflito em aberto, uma exclusão, ou a
   * restauração de uma nota que esta sessão excluiu (mesmo com conflito em
   * aberto, caso em que só a restauração é enviada).
   */
  private sendable(entry: Pending): boolean {
    return entry.deleted || !entry.conflict || entry.restore;
  }

  private hasSendable(): boolean {
    for (const entry of this.pending.values()) if (this.sendable(entry)) return true;
    return false;
  }

  private nextDue(force: boolean, skip: Set<string>): Pending | null {
    const now = Date.now();
    let best: Pending | null = null;
    for (const entry of this.pending.values()) {
      if (!this.sendable(entry) || skip.has(entry.noteId)) continue;
      if (!force && entry.notBefore > now) continue;
      if (!best || entry.seq < best.seq) best = entry;
    }
    return best;
  }

  /** Outra pendência está para liberar um lugar neste bloco (exclusão ou saída ainda não gravada). */
  private slotBeingFreed(block: BlockId, exceptId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.noteId === exceptId || !this.sendable(entry) || entry.base?.block !== block) continue;
      if (entry.deleted || entry.target.block !== block) return true;
    }
    return false;
  }

  /** Envia as pendências vencidas, em ordem. Sempre executado dentro da fila de execução. */
  private async drain(force: boolean): Promise<void> {
    if (this.phase !== 'ready') return;
    if (this.repo.auth.getSnapshot().status === 'signed_out') {
      // Sem usuário não há como gravar; o envio é retomado no próximo login.
      this.authHold = true;
      this.holdUntil = Infinity;
      this.emit();
      return;
    }
    if (!force && (this.offline || this.authHold) && Date.now() < this.holdUntil) return;

    const skip = new Set<string>();
    const rounds = new Map<string, number>();

    for (;;) {
      const entry = this.nextDue(force, skip);
      if (!entry) break;

      const round = (rounds.get(entry.noteId) ?? 0) + 1;
      rounds.set(entry.noteId, round);
      if (round > MAX_ROUNDS_PER_NOTE) {
        // A nota muda no servidor mais rápido do que é possível acompanhar.
        this.postpone(entry);
        skip.add(entry.noteId);
        continue;
      }

      try {
        await this.send(entry);
        entry.failures = 0;
        this.offline = false;
        this.authHold = false;
        this.holdAttempt = 0;
        this.holdUntil = 0;
        this.lastSavedAt = new Date().toISOString();
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'network') {
          this.offline = true;
          this.hold();
          break;
        }
        if (appError.code === 'unauthenticated') {
          this.authHold = true;
          this.hold();
          break;
        }

        // O servidor respondeu: há conexão e sessão válida, mesmo com a recusa.
        this.offline = false;
        this.authHold = false;
        this.holdAttempt = 0;
        this.holdUntil = 0;

        if (PERMANENT.has(appError.code)) {
          // Reenviar não mudaria a resposta: a alteração é descartada e a tela
          // volta ao estado do servidor.
          if (this.pending.get(entry.noteId) === entry) this.pending.delete(entry.noteId);
          this.onNotice({ level: 'error', message: appError.message });
          this.reloadWanted = true;
        } else {
          skip.add(entry.noteId);
          this.postpone(entry);
          if (appError.code === 'block_full') {
            // O servidor recusou, então nada foi gravado. A nota e o texto
            // ficam guardados até que haja lugar no bloco ou o usuário a mova.
            entry.doubt = null;
            const block = entry.target.block;
            if (!entry.warned && !this.slotBeingFreed(block, entry.noteId)) {
              entry.warned = true;
              this.onNotice({
                level: 'error',
                message: `O bloco "${getBlock(block).title}" atingiu o limite de notas. A nota continua guardada: mova para outro bloco ou libere um lugar para concluir a gravação.`,
              });
            }
            this.reloadWanted = true;
          }
        }
      }
      this.persist();
      this.touch();
    }

    this.persist();
    if (this.reloadWanted && Date.now() >= this.holdUntil) await this.reload();
    this.scheduleCache();
    this.emit();
  }

  /** Adia o reenvio de uma pendência que falhou, com intervalos crescentes. */
  private postpone(entry: Pending): void {
    entry.failures += 1;
    entry.notBefore = Date.now() + FAILURE_DELAYS_MS[Math.min(entry.failures, FAILURE_DELAYS_MS.length) - 1];
  }

  /** Um passo de sincronização da nota: aproxima o servidor do estado desejado. */
  private async send(entry: Pending): Promise<void> {
    const id = entry.noteId;
    const alive = () => this.pending.get(id) === entry;
    const target = { ...entry.target };

    // Estado recebido em resposta a um envio desta pendência. Se for mais
    // antigo que o já conhecido, vale o conhecido.
    const settleWith = (note: Note, ownWrite: boolean) => {
      const accepted = this.acceptNote(note, ownWrite);
      this.rebase(entry, accepted ? note : (this.server.get(id) ?? null), 'response');
    };

    if (entry.deleted && entry.base === null && !entry.sent) {
      this.pending.delete(id);
      return;
    }

    if (entry.base === null && entry.deleted) {
      // Exclusão de uma nota cuja criação ficou sem resposta. Antes de excluir
      // é preciso saber o que há no servidor, para não apagar o que outra
      // pessoa tenha escrito nela. Uma atualização com a versão 0, que nunca
      // existe, não grava nada e devolve o estado atual da nota.
      const probe = await this.repo.updateNote(id, { position: target.position }, 0);
      const current = probe.ok ? probe.note : probe.current;
      if (current) settleWith(current, true);
      // Nada no servidor. Se a exclusão foi desfeita durante a consulta, a
      // pendência segue como criação.
      else if (alive() && entry.deleted) this.pending.delete(id);
      return;
    }

    if (entry.base === null) {
      entry.sent = true;
      remember(entry, target);
      this.persist();

      let note: Note;
      try {
        note = await this.repo.createNote({ id, projectId: this.projectId, ...target });
      } catch (error) {
        if (toAppError(error).code !== 'not_found') throw error;
        // A criação já havia chegado ao servidor e a nota foi excluída depois.
        if (!alive()) return;
        if (!entry.restore) {
          entry.base = { ...target, content: '', version: 0 };
          this.acceptDeletion(id);
          this.rebase(entry, null, 'response');
          return;
        }
        note = await this.repo.restoreNote(id);
        if (alive()) entry.restore = false;
      }
      settleWith(note, true);
      return;
    }

    if (entry.deleted) {
      // A partir daqui a nota pode estar excluída no servidor: desfazer exige restaurar.
      const version = entry.base.version;
      entry.restore = true;
      this.persist();
      const result = await this.repo.deleteNote(id, version);
      if (result.ok) {
        this.acceptDeletion(id, version + 1);
        if (alive() && entry.deleted) this.pending.delete(id);
        return;
      }
      // A nota mudou depois que a exclusão foi pedida e continua ativa.
      if (alive()) entry.restore = false;
      settleWith(result.current, false);
      return;
    }

    if (entry.restore) {
      let note: Note;
      try {
        note = await this.repo.restoreNote(id);
      } catch (error) {
        if (toAppError(error).code !== 'not_found') throw error;
        // A nota nunca chegou a existir no servidor: volta a ser uma criação.
        if (alive()) {
          entry.base = null;
          entry.restore = false;
          entry.force = false;
          entry.doubt = null;
        }
        return;
      }
      if (alive()) entry.restore = false;
      settleWith(note, true);
      return;
    }

    let patch = diff(target, entry.base);
    if (Object.keys(patch).length === 0) {
      if (entry.doubt === null) {
        this.pending.delete(id);
        return;
      }
      // O estado desejado voltou a coincidir com a base, mas um envio anterior
      // pode ter chegado ao servidor. Enviar o estado completo esclarece: ou é
      // aceito (nada havia chegado), ou o servidor devolve o estado atual.
      patch = { ...target };
    }

    const sentVersion = entry.base.version;
    entry.doubt = sentVersion;
    remember(entry, patch);
    this.persist();

    const result = await this.repo.updateNote(id, patch, sentVersion);
    if (result.ok) {
      settleWith(result.note, false);
    } else if (result.current) {
      settleWith(result.current, false);
    } else {
      if (alive()) entry.doubt = null;
      const known = this.server.get(id);
      if (known && known.version > sentVersion) {
        // A nota estava excluída quando o pedido chegou, mas já voltou a
        // existir em uma versão mais nova: a resposta está superada.
        this.reloadWanted = true;
        return;
      }
      this.acceptDeletion(id);
      this.rebase(entry, null, 'response');
    }
  }

  // -------------------------------------------------------------------------
  // Agendamento
  // -------------------------------------------------------------------------

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Inicia um intervalo de espera antes da próxima tentativa (sem rede ou sem sessão válida). */
  private hold(): void {
    const delay = HOLD_DELAYS_MS[Math.min(this.holdAttempt, HOLD_DELAYS_MS.length - 1)];
    this.holdAttempt += 1;
    this.holdUntil = Date.now() + delay;
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.disposed || this.phase !== 'ready') return;

    let due = Infinity;
    for (const entry of this.pending.values()) {
      if (this.sendable(entry)) due = Math.min(due, entry.notBefore);
    }
    // Em espera (sem rede ou sem sessão), nada é tentado antes do fim do intervalo.
    if (due !== Infinity && (this.offline || this.authHold)) due = Math.max(due, this.holdUntil);

    const at = this.stale || this.reloadWanted ? Math.min(due, this.holdUntil) : due;
    if (at === Infinity) return;

    this.timer = setTimeout(this.tick, Math.max(0, at - Date.now()));
  }

  private tick = (): void => {
    this.timer = null;
    if (this.disposed || this.drainQueued) return;
    this.drainQueued = true;
    void this.exclusive(async () => {
      this.drainQueued = false;
      if ((this.stale || this.reloadWanted) && Date.now() >= this.holdUntil) await this.reload();
      await this.drain(false);
    }).then(
      () => this.scheduleNext(),
      () => this.scheduleNext(),
    );
  };

  /** Grava as pendências, publica o novo estado e agenda o envio. */
  private commit(): void {
    this.persist();
    this.touch();
    this.scheduleNext();
  }

  // -------------------------------------------------------------------------
  // Armazenamento local
  // -------------------------------------------------------------------------

  private persist(): void {
    // Depois da perda de acesso, o que estava guardado fica como está.
    if (this.phase === 'not_found') return;
    // Encerrada a sessão, outra pode ter assumido as pendências e removido a
    // chave. Nesse caso ela não é recriada: a outra sessão é a dona agora.
    if (!this.released) {
      this.handedOver = false;
    } else {
      const missing = this.everPersisted && safeLocalStorage()?.getItem(this.outboxKey) == null;
      if (missing && this.pending.size > 0) this.handedOver = true;
      if (this.handedOver) return;
    }
    if (this.pending.size === 0) {
      removeKey(this.outboxKey);
      return;
    }
    const stored: StoredOutbox = {
      beat: this.released ? 0 : Date.now(),
      entries: [...this.pending.values()],
    };
    writeJson(this.outboxKey, stored);
    this.everPersisted = true;
  }

  /**
   * Mantém uma trava com o nome da chave das pendências enquanto a sessão
   * vive. O navegador a libera sozinho quando a aba fecha ou trava, o que
   * permite a outra sessão saber, sem depender de temporizadores, que estas
   * pendências ficaram órfãs.
   */
  private acquireLock(): void {
    const locks = lockManager();
    if (!locks || this.releaseLock) return;
    const held = new Promise<void>((resolve) => {
      this.releaseLock = resolve;
    });
    void Promise.resolve(locks.request(this.outboxKey, () => held)).catch(() => undefined);
  }

  private dropLock(): void {
    this.releaseLock?.();
    this.releaseLock = null;
  }

  /**
   * Assume pendências deixadas por sessões encerradas deste usuário neste
   * projeto (aba fechada, página recarregada, navegador reaberto). Sessões
   * vivas não são tocadas: mantêm uma trava ou, em navegadores sem travas,
   * renovam um sinal periódico.
   */
  private async adoptOrphans(): Promise<void> {
    const locks = lockManager();
    let adopted = false;

    for (const key of listKeys(this.outboxPrefix)) {
      if (key === this.outboxKey) continue;
      if (locks) {
        try {
          await locks.request(key, { ifAvailable: true }, (lock) => {
            if (lock !== null && this.adoptKey(key)) adopted = true;
          });
        } catch {
          /* trava indisponível: fica para a próxima verificação */
        }
      } else if (this.adoptKey(key)) {
        adopted = true;
      }
    }

    if (adopted && !this.disposed) this.commit();
  }

  /**
   * Incorpora as pendências guardadas em uma chave órfã. Retorna true se
   * alguma foi assumida. A chave só é órfã se a dona a liberou (sinal zerado)
   * ou deixou de renovar o sinal; com travas, exige-se ainda a trava livre.
   */
  private adoptKey(key: string): boolean {
    if (this.disposed || this.phase !== 'ready') return false;

    const stored = readJson<StoredOutbox | null>(key, null);
    const entries = stored && Array.isArray(stored.entries) ? stored.entries : [];
    const beat = stored && typeof stored.beat === 'number' ? stored.beat : 0;
    if (beat > 0 && Date.now() - beat < ORPHAN_AFTER_MS) return false;

    let adopted = false;
    const remaining: Pending[] = [];
    for (const raw of [...entries].sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0))) {
      if (!isPending(raw)) continue;

      const mine = this.pending.get(raw.noteId);
      if (mine) {
        // Esta sessão também alterou a nota. Se o estado desejado é outro, a
        // pendência órfã fica guardada e será examinada quando a desta sessão
        // terminar.
        const same = mine.deleted === (raw.deleted === true) && sameFields(mine.target, raw.target);
        if (!same) remaining.push(raw);
        continue;
      }

      const entry: Pending = {
        ...raw,
        seq: ++this.seq,
        deleted: raw.deleted === true,
        sent: raw.sent !== false,
        restore: raw.restore === true,
        force: raw.force === true,
        tried: Array.isArray(raw.tried) ? raw.tried.filter((patch) => typeof patch === 'object' && patch !== null) : [],
        doubt: typeof raw.doubt === 'number' ? raw.doubt : null,
        overflow: raw.overflow === true,
        conflict: raw.conflict && typeof raw.conflict === 'object' ? { theirs: raw.conflict.theirs ?? null } : null,
        diverged: raw.diverged === true,
        warned: false,
        notBefore: 0,
        failures: 0,
      };
      this.pending.set(entry.noteId, entry);

      const current = this.server.get(entry.noteId) ?? null;
      if (current) this.rebase(entry, current, 'observed');
      else if (entry.base && !this.stale) this.rebase(entry, null, 'observed');
      adopted = true;
    }

    if (remaining.length > 0) writeJson(key, { beat: 0, entries: remaining } satisfies StoredOutbox);
    else removeKey(key);
    return adopted;
  }

  private beat = (): void => {
    if (this.disposed) return;
    if (this.pending.size > 0) this.persist();
    if (this.phase === 'ready') void this.adoptOrphans();
  };

  private scheduleCache(): void {
    if (this.disposed || this.cacheTimer || this.repo.mode === 'local') return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      this.writeCache();
    }, CACHE_DELAY_MS);
  }

  /**
   * Atualiza a cópia usada para abrir o projeto sem conexão. No modo local os
   * dados já estão no navegador, e sem usuário conectado nada é guardado.
   */
  private writeCache(): void {
    if (this.repo.mode === 'local' || this.phase !== 'ready' || !this.project || this.stale) return;
    if (this.repo.auth.getSnapshot().status === 'signed_out') return;
    writeJson(this.cacheKey, { project: this.project, notes: [...this.server.values()] } satisfies CachedProject);
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  private handleChange = (change: ProjectChange): void => {
    if (this.disposed || this.phase !== 'ready') return;

    switch (change.type) {
      case 'note': {
        const { note, deleted } = change;
        this.refreshTouched?.add(note.id);

        const accepted = deleted ? this.acceptDeletion(note.id, note.version) : this.acceptNote(note);
        if (!accepted) return;

        const entry = this.pending.get(note.id);
        if (entry) {
          this.rebase(entry, deleted ? null : note, 'observed');
          this.persist();
          // A fusão pode ter liberado a pendência para envio (um conflito que
          // deixou de existir, uma exclusão cancelada).
          this.scheduleNext();
        }
        this.touch();
        this.scheduleCache();
        return;
      }
      case 'project': {
        if (!this.project) return;
        this.project = { ...this.project, ...change.project, role: this.project.role };
        this.emit();
        this.scheduleCache();
        return;
      }
      case 'access':
      case 'resync':
        void this.refresh();
        return;
    }
  };

  private handleAuth = (): void => {
    if (this.disposed) return;
    const { status } = this.repo.auth.getSnapshot();
    if (status === 'signed_in' && this.authHold) {
      this.authHold = false;
      this.holdUntil = 0;
      this.emit();
      this.scheduleNext();
    } else if (status === 'signed_out') {
      // As pendências ficam guardadas até um novo login.
      this.authHold = true;
      this.holdUntil = Infinity;
      this.emit();
      this.scheduleNext();
    }
  };

  private handleOnline = (): void => {
    if (this.holdUntil !== Infinity) this.holdUntil = 0;
    // O que mudou no servidor durante a queda não é reenviado em tempo real.
    if (this.repo.mode === 'cloud') this.reloadWanted = true;
    this.scheduleNext();
  };

  private handlePageHide = (): void => {
    // A página pode não voltar: libera as pendências para a próxima sessão.
    this.released = true;
    this.persist();
    this.dropLock();
    void this.flushNow();
  };

  private handlePageShow = (): void => {
    if (!this.released || this.disposed) return;
    this.released = false;
    this.acquireLock();
    this.persist();
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      void this.flushNow();
      return;
    }
    // De volta depois de um tempo em segundo plano: o canal em tempo real pode
    // ter sido suspenso pelo navegador, então o estado é relido.
    const away = this.hiddenAt > 0 && Date.now() - this.hiddenAt > RESYNC_AFTER_HIDDEN_MS;
    if (this.repo.mode === 'cloud' && away && Date.now() - this.lastReloadAt > RESYNC_AFTER_HIDDEN_MS) {
      this.reloadWanted = true;
      this.scheduleNext();
    }
  };

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  private isReadOnly(): boolean {
    return this.phase !== 'ready' || !this.project || !canEdit(this.project.role) || this.project.archivedAt !== null;
  }

  /** Notas como aparecem na tela: estado do servidor com as pendências aplicadas. */
  private view(): Map<string, Note> {
    const notes = new Map<string, Note>();

    for (const note of this.server.values()) {
      const entry = this.pending.get(note.id);
      if (!entry) notes.set(note.id, note);
      else if (!entry.deleted) notes.set(note.id, { ...note, ...entry.target, updatedAt: entry.changedAt });
    }
    for (const entry of this.pending.values()) {
      if (entry.deleted || notes.has(entry.noteId)) continue;
      notes.set(entry.noteId, {
        id: entry.noteId,
        projectId: this.projectId,
        ...entry.target,
        version: entry.base?.version ?? 0,
        createdBy: this.userId,
        updatedBy: this.userId,
        createdAt: entry.createdAt,
        updatedAt: entry.changedAt,
      });
    }
    return notes;
  }

  private notesIn(block: BlockId): Note[] {
    return sortNotes([...this.view().values()].filter((note) => note.block === block));
  }

  private touch(): void {
    this.revision += 1;
    this.emit();
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private buildSnapshot(): SessionSnapshot {
    const conflicts: Record<string, Note | null> = {};
    let sendable = 0;
    let failing = false;
    for (const entry of this.pending.values()) {
      if (this.sendable(entry)) {
        sendable += 1;
        if (entry.failures > 0) failing = true;
      } else if (entry.conflict) {
        conflicts[entry.noteId] = entry.conflict.theirs;
      }
    }

    let status: SaveStatus = 'saved';
    if (this.stale || (this.offline && (sendable > 0 || this.reloadWanted))) status = 'offline';
    else if (this.authHold && sendable > 0) status = 'paused';
    else if (failing) status = 'error';
    else if (sendable > 0) status = 'saving';
    else if (Object.keys(conflicts).length > 0) status = 'conflict';

    return {
      phase: this.phase,
      error: this.error,
      project: this.project,
      notes: sortNotes([...this.view().values()]),
      conflicts,
      save: { status, pending: sendable, lastSavedAt: this.lastSavedAt },
      presence: this.presence,
      readOnly: this.isReadOnly(),
      stale: this.stale,
      revision: this.revision,
    };
  }
}

const BLOCK_ORDER = new Map<string, number>(BLOCKS.map((block, index) => [block.id, index]));

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort(
    (a, b) =>
      (BLOCK_ORDER.get(a.block) ?? 0) - (BLOCK_ORDER.get(b.block) ?? 0) ||
      a.position - b.position ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

function nextPosition(notes: Note[]): number {
  return notes.reduce((max, note) => Math.max(max, note.position), 0) + 1;
}

function fieldsOf(note: Fields): Fields {
  return { block: note.block, content: note.content, position: note.position };
}

function baseOf(note: Note): Base {
  return { block: note.block, content: note.content, position: note.position, version: note.version };
}

function sameFields(a: Fields, b: Fields): boolean {
  return a.content === b.content && a.block === b.block && a.position === b.position;
}

function diff(target: Fields, base: Fields): NotePatch {
  const patch: NotePatch = {};
  if (target.content !== base.content) patch.content = target.content;
  if (target.block !== base.block) patch.block = target.block;
  if (target.position !== base.position) patch.position = target.position;
  return patch;
}

function remember(entry: Pending, patch: NotePatch): void {
  const key = JSON.stringify([patch.content, patch.block, patch.position]);
  if (entry.tried.some((known) => JSON.stringify([known.content, known.block, known.position]) === key)) return;
  entry.tried.push({ ...patch });
  if (entry.tried.length > MAX_TRIED) {
    entry.tried.shift();
    entry.overflow = true;
  }
}

function isFields(value: unknown): value is Fields {
  const fields = value as Fields | null;
  return (
    typeof fields === 'object' &&
    fields !== null &&
    typeof fields.content === 'string' &&
    typeof fields.block === 'string' &&
    BLOCK_ORDER.has(fields.block) &&
    typeof fields.position === 'number'
  );
}

/** Valida uma pendência lida do armazenamento antes de adotá-la. */
function isPending(value: unknown): value is Pending {
  const entry = value as Pending | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.noteId === 'string' &&
    isFields(entry.target) &&
    (entry.base === null || (isFields(entry.base) && typeof entry.base.version === 'number')) &&
    typeof entry.createdAt === 'string' &&
    typeof entry.changedAt === 'string'
  );
}
