import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository } from '@/data/local/LocalRepository';
import type { AuthSnapshot, ProjectChange, Repository } from '@/data/repository';
import type { Person } from '@/domain/types';
import { emptyProjectInput } from '@/domain/validation';
import { AppError } from '@/lib/errors';
import { CACHE_PREFIX, OUTBOX_PREFIX, removeByPrefix } from '@/lib/storage';
import { ProjectSession, type SessionNotice } from './ProjectSession';

/**
 * Cada "pessoa" dos testes usa o mesmo banco (um LocalRepository) por meio de
 * uma conexão própria, com falhas simuláveis:
 *
 *   mode 'offline'        a chamada falha antes de chegar ao servidor
 *   mode 'lose-response'  a gravação chega ao servidor, mas a resposta se perde
 *   holdBefore            a chamada fica retida antes de ser executada
 *   holdAfter             a chamada é executada e a resposta fica retida
 *   failOnce              a próxima chamada do método falha com o erro dado
 */
interface Connection {
  repo: Repository;
  mode: 'ok' | 'offline' | 'lose-response';
  writes: number;
  holdBefore: Set<string>;
  holdAfter: Set<string>;
  failOnce: Map<string, AppError>;
  latencyMs: number;
  /** Libera as chamadas retidas. */
  release(): void;
  setAuth(status: AuthSnapshot['status']): void;
}

const WRITES = new Set(['createNote', 'updateNote', 'deleteNote', 'restoreNote']);
const NETWORK = new Set([...WRITES, 'getProject']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => sleep(0);

function connect(base: LocalRepository, user: Person = { id: 'ana', name: 'Ana' }, cloud = false): Connection {
  const waiting: Array<() => void> = [];
  const authListeners = new Set<() => void>();
  let auth: AuthSnapshot = { status: 'signed_in', user };

  const connection: Connection = {
    repo: null as unknown as Repository,
    mode: 'ok',
    writes: 0,
    holdBefore: new Set(),
    holdAfter: new Set(),
    failOnce: new Map(),
    latencyMs: 0,
    release() {
      this.holdBefore.clear();
      this.holdAfter.clear();
      waiting.splice(0).forEach((resume) => resume());
    },
    setAuth(status) {
      auth = { status, user: status === 'signed_in' ? user : null };
      authListeners.forEach((listener) => listener());
    },
  };

  const authApi = {
    ...base.auth,
    getSnapshot: () => auth,
    subscribe: (listener: () => void) => {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
  };

  const offline = () => connection.mode === 'offline';

  connection.repo = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'auth') return authApi;
      if (property === 'subscribe') {
        // Com a conexão comprometida os avisos em tempo real também não chegam.
        return (projectId: string, handler: (change: ProjectChange) => void) =>
          target.subscribe(projectId, (change) => {
            if (connection.mode === 'ok') handler(change);
          });
      }
      if (property === 'mode') return cloud ? 'cloud' : 'local';
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      const name = String(property);
      return (...args: unknown[]) => {
        if (!NETWORK.has(name)) return value.apply(target, args);
        return (async () => {
          if (offline()) throw new AppError('network');
          const failure = connection.failOnce.get(name);
          if (failure) {
            connection.failOnce.delete(name);
            throw failure;
          }
          if (connection.latencyMs) await sleep(connection.latencyMs);
          if (connection.holdBefore.has(name)) await new Promise<void>((resume) => waiting.push(resume));
          if (offline()) throw new AppError('network');

          if (WRITES.has(name)) connection.writes += 1;
          const result = await value.apply(target, args);

          if (connection.holdAfter.has(name)) await new Promise<void>((resume) => waiting.push(resume));
          if (connection.mode === 'lose-response' && WRITES.has(name)) throw new AppError('network');
          return result;
        })();
      };
    },
  }) as Repository;

  return connection;
}

async function open(connection: Connection, projectId: string, notices: SessionNotice[] = [], debounceMs = 60_000) {
  const session = new ProjectSession(connection.repo, projectId, {
    debounceMs,
    onNotice: (notice) => notices.push(notice),
  });
  await session.start();
  return session;
}

async function setup() {
  const base = new LocalRepository();
  const project = await base.createProject({ ...emptyProjectInput(), name: 'Projeto' });
  return { base, projectId: project.id, ana: connect(base) };
}

const BRUNO: Person = { id: 'bruno', name: 'Bruno' };

const stored = async (base: LocalRepository, projectId: string) => (await base.getProject(projectId)).notes;
const outboxes = () => Object.keys(localStorage).filter((key) => key.startsWith(OUTBOX_PREFIX));
const outboxText = () => outboxes().map((key) => localStorage.getItem(key)).join('\n');

/** Travas entre abas simuladas (Web Locks), compartilhadas por todas as sessões do teste. */
function installLocks(): () => void {
  const held = new Set<string>();
  const locks = {
    request(name: string, first: unknown, second?: unknown) {
      const options = (typeof first === 'function' ? {} : first) as { ifAvailable?: boolean };
      const callback = (typeof first === 'function' ? first : second) as (lock: unknown) => unknown;
      if (held.has(name)) {
        return options.ifAvailable ? Promise.resolve(callback(null)) : new Promise(() => undefined);
      }
      held.add(name);
      return Promise.resolve()
        .then(() => callback({ name }))
        .finally(() => held.delete(name));
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return () => {
    delete (navigator as unknown as { locks?: unknown }).locks;
  };
}

/** Ana e Bruno editam a mesma nota a partir da mesma versão; a gravação da Ana chega primeiro. */
async function conflictingEdits() {
  const { base, projectId, ana: anaConnection } = await setup();
  const brunoConnection = connect(base, BRUNO);

  const ana = await open(anaConnection, projectId);
  const id = ana.addNote('geracao', 'Texto inicial')!;
  const neighbour = ana.addNote('geracao', 'Vizinha')!;
  await ana.flushNow();
  const bruno = await open(brunoConnection, projectId);

  ana.editNote(id, 'Versão da Ana');
  bruno.editNote(id, 'Versão do Bruno');
  await ana.flushNow();
  await bruno.flushNow();

  return { base, projectId, ana, bruno, brunoConnection, id, neighbour };
}

describe('ProjectSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('gravação', () => {
    it('aplica a edição na tela de imediato e grava ao enviar', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      const id = session.addNote('problema')!;
      session.editNote(id, 'Baixa maturidade em inovação');

      expect(session.getSnapshot().notes[0].content).toBe('Baixa maturidade em inovação');
      expect(session.getSnapshot().save.status).toBe('saving');

      await session.flushNow();

      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect((await stored(base, projectId))[0].content).toBe('Baixa maturidade em inovação');
      expect(outboxes()).toEqual([]);
      session.dispose();
    });

    it('funde a criação e a digitação em uma única gravação', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId);

      const id = session.addNote('mercado')!;
      for (const text of ['P', 'PM', 'PME', 'PMEs', 'PMEs de TIC']) session.editNote(id, text);
      await session.flushNow();
      expect(ana.writes).toBe(1);

      for (const text of ['PMEs de TIC ', 'PMEs de TIC em', 'PMEs de TIC em MG']) session.editNote(id, text);
      await session.flushNow();
      expect(ana.writes).toBe(2);
      session.dispose();
    });

    it('respeita a pausa de digitação mesmo com gravações em andamento', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId, [], 300);
      ana.latencyMs = 15;

      const id = session.addNote('planejamento')!;
      let text = '';
      for (let index = 0; index < 40; index += 1) {
        text += 'x';
        session.editNote(id, text);
        await sleep(8);
      }
      expect(ana.writes).toBeLessThanOrEqual(1);

      await session.flushNow();
      expect((await stored(base, projectId))[0].content).toBe(text);
      session.dispose();
    });

    it('nota criada e excluída antes do envio não gera gravação', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId);

      const id = session.addNote('mercado', 'rascunho')!;
      session.deleteNote(id);
      await session.flushNow();

      expect(ana.writes).toBe(0);
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      session.dispose();
    });

    it('desfazer texto digitado volta ao estado salvo sem gravar', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('mercado', 'PMEs')!;
      await session.flushNow();
      ana.writes = 0;

      session.editNote(id, 'PMEs de TIC');
      session.editNote(id, 'PMEs');
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      await session.flushNow();
      expect(ana.writes).toBe(0);
      session.dispose();
    });

    it('move e reordena notas', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const a = session.addNote('geracao', 'A')!;
      const b = session.addNote('geracao', 'B')!;

      session.reorderNote(b, -1);
      expect(session.getSnapshot().notes.map((note) => note.content)).toEqual(['B', 'A']);

      expect(session.moveNote(a, 'selecionadas')).toBe(true);
      await session.flushNow();

      const notes = await stored(base, projectId);
      expect(notes.find((note) => note.id === a)?.block).toBe('selecionadas');
      expect(notes.find((note) => note.id === b)?.block).toBe('geracao');
      expect(session.getSnapshot().save.pending).toBe(0);
      session.dispose();
    });

    it('impede ultrapassar o limite do bloco e avisa o usuário', async () => {
      const { projectId, ana } = await setup();
      const notices: SessionNotice[] = [];
      const session = await open(ana, projectId, notices);

      expect(session.addNote('mercado', 'Um')).not.toBeNull();
      expect(session.addNote('mercado', 'Dois')).not.toBeNull();
      expect(session.addNote('mercado', 'Três')).toBeNull();
      expect(notices).toHaveLength(1);
      session.dispose();
    });

    it('desfaz a exclusão de uma nota já gravada', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('parceiros', 'Universidade')!;
      await session.flushNow();

      const undo = session.deleteNote(id)!;
      await session.flushNow();
      expect(await stored(base, projectId)).toHaveLength(0);

      undo();
      expect(session.getSnapshot().notes).toHaveLength(1);
      await session.flushNow();
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Universidade']);
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      session.dispose();
    });

    it('desfazer a exclusão preserva texto que ainda não havia sido gravado', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('parceiros', 'Universidade')!;
      await session.flushNow();

      session.editNote(id, 'Universidade e incubadora');
      const undo = session.deleteNote(id)!;
      await session.flushNow();
      undo();
      await session.flushNow();

      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Universidade e incubadora']);
      session.dispose();
    });

    it('fica somente leitura quando o projeto é arquivado', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId);
      await session.setArchived(true);

      expect(session.getSnapshot().readOnly).toBe(true);
      expect(session.addNote('mercado', 'x')).toBeNull();
      session.dispose();
    });

    it('informa projeto inexistente', async () => {
      const { ana } = await setup();
      const session = await open(ana, 'nao-existe');
      expect(session.getSnapshot().phase).toBe('not_found');
      session.dispose();
    });
  });

  describe('falhas de rede e do servidor', () => {
    it('mantém as edições sem conexão e as envia quando a rede volta', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      ana.mode = 'offline';
      const id = session.addNote('resultados', 'Aumentar receita recorrente')!;
      await session.flushNow();

      expect(session.getSnapshot().save).toMatchObject({ status: 'offline', pending: 1 });
      expect(await stored(base, projectId)).toHaveLength(0);
      expect(outboxes()).toHaveLength(1);

      ana.mode = 'ok';
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(session.getSnapshot().save.status).toBe('saved'));

      expect((await stored(base, projectId)).map((note) => note.id)).toEqual([id]);
      session.dispose();
    });

    it('reenvia as pendências depois de fechar e reabrir o navegador', async () => {
      const { base, projectId, ana } = await setup();
      const first = await open(ana, projectId);

      ana.mode = 'offline';
      first.addNote('planejamento', 'Dobrar a base de clientes');
      await first.flushNow();
      first.dispose();

      ana.mode = 'ok';
      const second = await open(ana, projectId);
      await vi.waitFor(() => expect(second.getSnapshot().save.status).toBe('saved'));

      expect(second.getSnapshot().notes.map((note) => note.content)).toEqual(['Dobrar a base de clientes']);
      expect(await stored(base, projectId)).toHaveLength(1);
      expect(outboxes()).toEqual([]);
      second.dispose();
    });

    it('criação cuja resposta se perdeu: o texto digitado depois é gravado', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      ana.mode = 'lose-response';
      const id = session.addNote('problema')!;
      await session.flushNow();
      expect(session.getSnapshot().save.status).toBe('offline');
      expect(await stored(base, projectId)).toHaveLength(1);

      session.editNote(id, 'Texto digitado sem conexão');
      ana.mode = 'ok';
      await session.flushNow();

      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect(session.getSnapshot().notes[0].content).toBe('Texto digitado sem conexão');
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Texto digitado sem conexão']);
      session.dispose();
    });

    it('criação cuja resposta se perdeu: a exclusão posterior chega ao servidor', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      ana.mode = 'lose-response';
      const id = session.addNote('problema', 'rascunho')!;
      await session.flushNow();
      session.deleteNote(id);
      ana.mode = 'ok';
      await session.flushNow();

      expect(session.getSnapshot().notes).toHaveLength(0);
      expect(await stored(base, projectId)).toHaveLength(0);
      session.dispose();

      const again = await open(ana, projectId);
      expect(again.getSnapshot().notes).toHaveLength(0);
      again.dispose();
    });

    it('atualização cuja resposta se perdeu não vira conflito consigo mesmo', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      ana.mode = 'lose-response';
      session.editNote(id, 'AB');
      await session.flushNow();
      expect((await stored(base, projectId))[0].content).toBe('AB');

      ana.mode = 'ok';
      session.editNote(id, 'ABC');
      await session.flushNow();

      expect(session.getSnapshot().conflicts).toEqual({});
      expect((await stored(base, projectId))[0].content).toBe('ABC');
      session.dispose();
    });

    for (const code of ['unknown', 'unauthenticated'] as const) {
      it(`falha passageira (${code}) não descarta o que foi digitado`, async () => {
        const { base, projectId, ana } = await setup();
        const notices: SessionNotice[] = [];
        const session = await open(ana, projectId, notices);
        const id = session.addNote('problema', 'Texto inicial')!;
        await session.flushNow();

        ana.failOnce.set('updateNote', new AppError(code));
        session.editNote(id, 'Parágrafo digitado pelo usuário');
        await session.flushNow();

        const snapshot = session.getSnapshot();
        expect(snapshot.notes[0].content).toBe('Parágrafo digitado pelo usuário');
        expect(snapshot.save).toMatchObject({ status: code === 'unknown' ? 'error' : 'paused', pending: 1 });
        expect(outboxes()).toHaveLength(1);
        expect(notices).toEqual([]);

        await session.flushNow();
        expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
        expect((await stored(base, projectId))[0].content).toBe('Parágrafo digitado pelo usuário');
        session.dispose();
      });
    }

    it('falha do servidor em uma nota não impede a gravação das demais', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const first = session.addNote('problema', 'Primeira')!;
      const second = session.addNote('mercado', 'Segunda')!;
      await session.flushNow();

      ana.failOnce.set('updateNote', new AppError('unknown'));
      session.editNote(first, 'Primeira alterada');
      session.editNote(second, 'Segunda alterada');
      await session.flushNow();

      const contents = (await stored(base, projectId)).map((note) => note.content).sort();
      expect(contents).toEqual(['Primeira', 'Segunda alterada']);
      expect(session.getSnapshot().save).toMatchObject({ status: 'error', pending: 1 });
      session.dispose();
    });

    it('recusa definitiva do servidor descarta a alteração, avisa e volta ao estado gravado', async () => {
      const { base, projectId, ana } = await setup();
      const notices: SessionNotice[] = [];
      const session = await open(ana, projectId, notices);
      const id = session.addNote('problema', 'Texto inicial')!;
      await session.flushNow();

      ana.failOnce.set('updateNote', new AppError('forbidden'));
      session.editNote(id, 'Texto sem permissão');
      await session.flushNow();

      expect(notices.map((notice) => notice.level)).toEqual(['error']);
      expect(session.getSnapshot().notes[0].content).toBe('Texto inicial');
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect((await stored(base, projectId))[0].content).toBe('Texto inicial');
      session.dispose();
    });

    it('sem sessão de usuário as alterações aguardam o novo login', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'Texto inicial')!;
      await session.flushNow();

      ana.setAuth('signed_out');
      session.editNote(id, 'Digitado com a sessão expirada');
      await session.flushNow();
      expect(session.getSnapshot().save).toMatchObject({ status: 'paused', pending: 1 });
      expect((await stored(base, projectId))[0].content).toBe('Texto inicial');

      ana.setAuth('signed_in');
      await vi.waitFor(() => expect(session.getSnapshot().save.status).toBe('saved'));
      expect((await stored(base, projectId))[0].content).toBe('Digitado com a sessão expirada');
      session.dispose();
    });

    it('recarga concorrente com uma gravação não faz a tela regredir', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'v1')!;
      await session.flushNow();

      ana.holdAfter.add('getProject');
      const refreshing = session.refresh();
      await tick();
      session.editNote(id, 'v2 digitado');
      const flushing = session.flushNow();
      ana.release();
      await Promise.all([refreshing, flushing]);

      expect(session.getSnapshot().notes[0].content).toBe('v2 digitado');
      expect((await stored(base, projectId))[0].content).toBe('v2 digitado');

      session.editNote(id, 'v3');
      await session.flushNow();
      expect(session.getSnapshot().conflicts).toEqual({});
      expect((await stored(base, projectId))[0].content).toBe('v3');
      session.dispose();
    });
  });

  describe('cópia para uso sem conexão (modo nuvem)', () => {
    it('abre a última cópia conhecida, com o que foi gravado na sessão anterior', async () => {
      const { base, projectId } = await setup();
      const ana = connect(base, { id: 'ana', name: 'Ana' }, true);
      const online = await open(ana, projectId);
      online.addNote('mercado', 'PMEs de TIC');
      await online.flushNow();
      online.dispose();

      ana.mode = 'offline';
      const offline = await open(ana, projectId);

      expect(offline.getSnapshot()).toMatchObject({ phase: 'ready', stale: true });
      expect(offline.getSnapshot().save.status).toBe('offline');
      expect(offline.getSnapshot().notes.map((note) => note.content)).toEqual(['PMEs de TIC']);
      offline.dispose();
    });

    it('edições feitas sobre a cópia são enviadas quando a conexão volta', async () => {
      const { base, projectId } = await setup();
      const ana = connect(base, { id: 'ana', name: 'Ana' }, true);
      const online = await open(ana, projectId);
      const id = online.addNote('mercado', 'PMEs')!;
      await online.flushNow();
      online.dispose();

      ana.mode = 'offline';
      const offline = await open(ana, projectId);
      offline.editNote(id, 'PMEs de TIC');
      await offline.flushNow();

      ana.mode = 'ok';
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(offline.getSnapshot()).toMatchObject({ stale: false, save: { status: 'saved' } }));
      expect((await stored(base, projectId))[0].content).toBe('PMEs de TIC');
      offline.dispose();
    });

    it('não guarda cópia quando os dados já estão no navegador (modo local)', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId);
      session.addNote('mercado', 'PMEs de TIC');
      await session.flushNow();
      session.dispose();

      expect(Object.keys(localStorage).some((key) => key.startsWith('agitar.cache.'))).toBe(false);
    });
  });

  describe('colaboração', () => {
    it('recebe alterações feitas por outra pessoa', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);
      const bruno = await open(connect(base, BRUNO), projectId);

      const id = ana.addNote('geracao', 'Ideia da Ana')!;
      await ana.flushNow();
      await tick();
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Ideia da Ana']);

      ana.deleteNote(id);
      await ana.flushNow();
      await tick();
      expect(bruno.getSnapshot().notes).toHaveLength(0);

      ana.dispose();
      bruno.dispose();
    });

    it('não sobrescreve a edição de outra pessoa: expõe o conflito e o mantém gravado no navegador', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe('Versão da Ana');
      const snapshot = bruno.getSnapshot();
      expect(snapshot.conflicts[id]).toMatchObject({ content: 'Versão da Ana' });
      expect(snapshot.notes.find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      expect(snapshot.save).toMatchObject({ status: 'conflict', pending: 0 });
      expect(outboxes()).toHaveLength(1);

      ana.dispose();
      bruno.dispose();
    });

    it('resolve o conflito mantendo a versão local', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      bruno.resolveConflict(id, 'mine');
      await bruno.flushNow();

      expect(bruno.getSnapshot().conflicts).toEqual({});
      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      ana.dispose();
      bruno.dispose();
    });

    it('resolve o conflito adotando a versão do servidor', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      bruno.resolveConflict(id, 'theirs');

      expect(bruno.getSnapshot().notes.find((note) => note.id === id)!.content).toBe('Versão da Ana');
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe('Versão da Ana');
      expect(outboxes()).toEqual([]);
      ana.dispose();
      bruno.dispose();
    });

    it('texto digitado durante o conflito não é enviado sem decisão, mas fica guardado', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      bruno.editNote(id, 'Versão do Bruno, continuando');
      await bruno.flushNow();
      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe('Versão da Ana');

      bruno.resolveConflict(id, 'mine');
      await bruno.flushNow();
      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe(
        'Versão do Bruno, continuando',
      );
      ana.dispose();
      bruno.dispose();
    });

    it('recarregar o projeto não apaga o texto de um conflito em aberto', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      await bruno.refresh();
      expect(bruno.getSnapshot().notes.find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      expect(id in bruno.getSnapshot().conflicts).toBe(true);

      bruno.resolveConflict(id, 'mine');
      await bruno.flushNow();
      expect((await stored(base, projectId)).find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      ana.dispose();
      bruno.dispose();
    });

    it('o conflito em aberto sobrevive ao fechamento do navegador', async () => {
      const { projectId, ana, bruno, brunoConnection, id } = await conflictingEdits();
      bruno.dispose();

      const reopened = await open(brunoConnection, projectId);
      const snapshot = reopened.getSnapshot();
      expect(snapshot.notes.find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      expect(snapshot.conflicts[id]).toMatchObject({ content: 'Versão da Ana' });
      ana.dispose();
      reopened.dispose();
    });

    it('reordenar a nota vizinha não apaga o texto de um conflito em aberto', async () => {
      const { ana, bruno, id, neighbour } = await conflictingEdits();

      bruno.reorderNote(neighbour, -1);
      await bruno.flushNow();

      expect(bruno.getSnapshot().notes.find((note) => note.id === id)!.content).toBe('Versão do Bruno');
      expect(id in bruno.getSnapshot().conflicts).toBe(true);
      ana.dispose();
      bruno.dispose();
    });

    it('excluir uma nota em conflito exclui a nota no servidor', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      bruno.deleteNote(id);
      await bruno.flushNow();

      expect(bruno.getSnapshot().conflicts).toEqual({});
      expect((await stored(base, projectId)).map((note) => note.id)).not.toContain(id);
      ana.dispose();
      bruno.dispose();
    });

    it('alterações em campos diferentes são combinadas sem conflito', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('geracao', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      // O movimento do Bruno fica retido; a edição da Ana chega primeiro.
      brunoConnection.holdBefore.add('updateNote');
      expect(bruno.moveNote(id, 'selecionadas')).toBe(true);
      await tick();
      ana.editNote(id, 'Ana digitando');
      await ana.flushNow();
      brunoConnection.release();
      await bruno.flushNow();
      await tick();

      const note = (await stored(base, projectId))[0];
      expect(note).toMatchObject({ block: 'selecionadas', content: 'Ana digitando' });
      expect(bruno.getSnapshot().conflicts).toEqual({});
      expect(ana.getSnapshot().notes[0]).toMatchObject({ block: 'selecionadas', content: 'Ana digitando' });
      ana.dispose();
      bruno.dispose();
    });

    it('reordenação feita por outra pessoa não gera conflito para quem está digitando', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);
      const x = ana.addNote('geracao', 'X original')!;
      const y = ana.addNote('geracao', 'Y')!;
      await ana.flushNow();
      const bruno = await open(connect(base, BRUNO), projectId);

      ana.editNote(x, 'X digitado pela Ana');
      bruno.reorderNote(y, -1);
      await bruno.flushNow();
      await tick();
      await ana.flushNow();

      expect(ana.getSnapshot().conflicts).toEqual({});
      const notes = await stored(base, projectId);
      expect(notes.find((note) => note.id === x)!.content).toBe('X digitado pela Ana');
      expect(ana.getSnapshot().notes.map((note) => note.id)).toEqual([y, x]);
      ana.dispose();
      bruno.dispose();
    });

    it('exclusão pedida enquanto uma edição em conflito estava em envio prevalece', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.holdBefore.add('updateNote');
      bruno.editNote(id, 'b');
      const flushing = bruno.flushNow();
      await tick();
      ana.editNote(id, 'a');
      await ana.flushNow();
      await tick();
      bruno.deleteNote(id);
      brunoConnection.release();
      await flushing;
      await bruno.flushNow();

      expect(bruno.getSnapshot()).toMatchObject({ notes: [], conflicts: {} });
      expect(await stored(base, projectId)).toHaveLength(0);
      ana.dispose();
      bruno.dispose();
    });

    it('nota excluída por outra pessoa durante uma gravação não permanece na tela', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.holdAfter.add('updateNote');
      bruno.editNote(id, 'edição do Bruno');
      const flushing = bruno.flushNow();
      await tick();
      await tick();
      ana.deleteNote(id);
      await ana.flushNow();
      await tick();
      brunoConnection.release();
      await flushing;

      expect(bruno.getSnapshot().notes).toHaveLength(0);
      expect(await stored(base, projectId)).toHaveLength(0);
      ana.dispose();
      bruno.dispose();
    });

    it('edição pendente em nota excluída por outra pessoa vira conflito com o texto à vista', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();

      const bruno = await open(brunoConnection, projectId);
      brunoConnection.mode = 'offline';
      bruno.editNote(id, 'Texto do Bruno sem conexão');
      await bruno.flushNow();
      bruno.dispose();

      ana.deleteNote(id);
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      const reopened = await open(brunoConnection, projectId);
      const snapshot = reopened.getSnapshot();
      expect(snapshot.notes.map((note) => note.content)).toEqual(['Texto do Bruno sem conexão']);
      expect(snapshot.conflicts).toEqual({ [id]: null });

      reopened.resolveConflict(id, 'mine');
      await reopened.flushNow();
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Texto do Bruno sem conexão']);
      expect(reopened.getSnapshot().conflicts).toEqual({});
      ana.dispose();
      reopened.dispose();
    });

    it('desfazer uma exclusão feita sem conexão preserva a edição que outra pessoa gravou', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.mode = 'offline';
      const undo = bruno.deleteNote(id)!;
      await bruno.flushNow();
      ana.editNote(id, 'Edição da Ana feita depois');
      await ana.flushNow();
      await tick();

      undo();
      brunoConnection.mode = 'ok';
      await bruno.flushNow();

      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Edição da Ana feita depois']);
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Edição da Ana feita depois']);
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      ana.dispose();
      bruno.dispose();
    });

    it('conflito descoberto ao sair da página fica guardado para a próxima sessão', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('geracao', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      // A gravação do Bruno fica retida; a da Ana chega primeiro e ele sai da página.
      brunoConnection.holdBefore.add('updateNote');
      bruno.editNote(id, 'Texto do Bruno');
      const flushing = bruno.flushNow();
      await tick();
      // O aviso em tempo real não chega: o Bruno já saiu da página.
      bruno.dispose();
      ana.editNote(id, 'Versão da Ana');
      await ana.flushNow();
      brunoConnection.release();
      await flushing;
      await sleep(5);

      expect((await stored(base, projectId))[0].content).toBe('Versão da Ana');
      const reopened = await open(brunoConnection, projectId);
      expect(reopened.getSnapshot().notes[0].content).toBe('Texto do Bruno');
      expect(reopened.getSnapshot().conflicts[id]).toMatchObject({ content: 'Versão da Ana' });
      ana.dispose();
      reopened.dispose();
    });
  });

  describe('pendências guardadas no navegador', () => {
    it('duas abas do mesmo usuário não apagam as pendências uma da outra', async () => {
      const { base, projectId, ana } = await setup();
      const otherTab = connect(base);
      const tabA = await open(ana, projectId);
      const tabB = await open(otherTab, projectId);

      ana.mode = 'offline';
      tabA.addNote('resultados', 'Nota sem conexão da aba A');
      await tabA.flushNow();
      expect(outboxes()).toHaveLength(1);

      tabB.addNote('resultados', 'Nota da aba B');
      await tabB.flushNow();
      expect(outboxes()).toHaveLength(1);
      expect(tabA.getSnapshot().save.pending).toBe(1);

      // A aba A é fechada ainda sem conexão; a aba seguinte assume o que ficou.
      tabA.dispose();
      const reopened = await open(connect(base), projectId);
      await vi.waitFor(() => expect(reopened.getSnapshot().save.status).toBe('saved'));

      expect((await stored(base, projectId)).map((note) => note.content).sort()).toEqual([
        'Nota da aba B',
        'Nota sem conexão da aba A',
      ]);
      tabB.dispose();
      reopened.dispose();
    });

    it('uma aba aberta não assume as pendências de outra aba viva', async () => {
      const { base, projectId, ana } = await setup();
      const tabA = await open(ana, projectId);
      ana.mode = 'offline';
      tabA.addNote('resultados', 'Pendente na aba A');
      await tabA.flushNow();

      const tabB = await open(connect(base), projectId);
      expect(tabB.getSnapshot().notes).toHaveLength(0);
      expect(tabB.getSnapshot().save.pending).toBe(0);
      tabA.dispose();
      tabB.dispose();
    });

    it('contas diferentes no mesmo navegador não compartilham pendências', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      ana.mode = 'offline';
      session.addNote('resultados', 'Rascunho da Ana');
      await session.flushNow();
      session.dispose();

      const bruno = await open(connect(base, BRUNO), projectId);
      expect(bruno.getSnapshot().notes).toHaveLength(0);
      expect(await stored(base, projectId)).toHaveLength(0);
      expect(outboxes()).toHaveLength(1);
      bruno.dispose();
    });

    it('sessão encerrada antes de carregar não envia nada (montagem dupla em desenvolvimento)', async () => {
      const { base, projectId, ana } = await setup();
      const first = await open(ana, projectId);
      const id = first.addNote('problema', 'a')!;
      await first.flushNow();
      ana.mode = 'offline';
      first.editNote(id, 'abc');
      await first.flushNow();
      first.dispose();
      await tick();
      ana.mode = 'ok';
      ana.writes = 0;

      const discarded = new ProjectSession(ana.repo, projectId, { debounceMs: 60_000 });
      void discarded.start();
      discarded.dispose();
      const session = await open(ana, projectId);
      await vi.waitFor(() => expect(session.getSnapshot().save.status).toBe('saved'));

      expect(ana.writes).toBe(1);
      expect((await stored(base, projectId))[0].content).toBe('abc');
      session.dispose();
    });

    it('ignora conteúdo inválido guardado no navegador', async () => {
      const { projectId, ana } = await setup();
      localStorage.setItem(`${OUTBOX_PREFIX}ana.${projectId}.quebrado`, '{"beat":0,"entries":[{"noteId":7},null,"x"]}');
      localStorage.setItem(`${OUTBOX_PREFIX}ana.${projectId}.ilegivel`, 'isto não é JSON');

      const session = await open(ana, projectId);
      expect(session.getSnapshot()).toMatchObject({ phase: 'ready', notes: [], save: { status: 'saved' } });
      expect(outboxes()).toEqual([]);
      session.dispose();
    });
  });

  describe('envios de resultado desconhecido', () => {
    it('voltar ao texto anterior enquanto a gravação está a caminho não é desfeito pela gravação', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      ana.holdBefore.add('updateNote');
      session.editNote(id, 'AB');
      const flushing = session.flushNow();
      await tick();
      session.editNote(id, 'A');
      expect(session.getSnapshot().notes[0].content).toBe('A');
      expect(session.getSnapshot().save.status).not.toBe('saved');

      ana.release();
      await flushing;
      await session.flushNow();
      await tick();

      expect(session.getSnapshot().notes[0].content).toBe('A');
      expect((await stored(base, projectId))[0].content).toBe('A');
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      session.dispose();
    });

    it('gravação com resposta perdida seguida de volta ao texto anterior: tela e servidor terminam iguais', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      ana.mode = 'lose-response';
      session.editNote(id, 'AB');
      await session.flushNow();
      expect((await stored(base, projectId))[0].content).toBe('AB');

      session.editNote(id, 'A');
      expect(session.getSnapshot().save.status).not.toBe('saved');
      ana.mode = 'ok';
      await session.flushNow();

      expect(session.getSnapshot().notes[0].content).toBe('A');
      expect((await stored(base, projectId))[0].content).toBe('A');
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      session.dispose();
    });

    it('voltar e redigitar durante a gravação não gera conflito com a própria gravação', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      ana.holdBefore.add('updateNote');
      session.editNote(id, 'AB');
      const flushing = session.flushNow();
      await tick();
      session.editNote(id, 'A');
      session.editNote(id, 'AC');

      ana.release();
      await flushing;
      await session.flushNow();
      await tick();

      expect(session.getSnapshot().conflicts).toEqual({});
      expect((await stored(base, projectId))[0].content).toBe('AC');
      session.dispose();
    });

    it('texto de uma gravação própria não confirmada, já desfeito pelo usuário, não volta à tela', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const x = session.addNote('geracao', 'A')!;
      session.addNote('geracao', 'Y');
      await session.flushNow();

      ana.mode = 'lose-response';
      session.editNote(x, 'AB');
      await session.flushNow();

      session.reorderNote(x, 1);
      session.editNote(x, 'A');
      ana.mode = 'ok';
      await session.flushNow();

      expect(session.getSnapshot().notes.find((note) => note.id === x)!.content).toBe('A');
      expect((await stored(base, projectId)).find((note) => note.id === x)!.content).toBe('A');
      session.dispose();
    });

    it('criação com resposta perdida não sobrescreve a edição que outra pessoa fez na nota', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);

      anaConnection.mode = 'lose-response';
      const id = ana.addNote('geracao', 'Ideia')!;
      await ana.flushNow();
      expect(await stored(base, projectId)).toHaveLength(1);

      const bruno = await open(connect(base, BRUNO), projectId);
      bruno.editNote(id, 'Ideia reescrita pelo Bruno');
      await bruno.flushNow();

      anaConnection.mode = 'ok';
      await ana.flushNow();
      await tick();

      expect((await stored(base, projectId))[0].content).toBe('Ideia reescrita pelo Bruno');
      expect(ana.getSnapshot().notes[0].content).toBe('Ideia reescrita pelo Bruno');
      expect(ana.getSnapshot().conflicts).toEqual({});
      ana.dispose();
      bruno.dispose();
    });

    it('criação com resposta perdida e texto novo dos dois lados vira conflito', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);

      anaConnection.mode = 'lose-response';
      const id = ana.addNote('geracao', 'Ideia')!;
      await ana.flushNow();

      const bruno = await open(connect(base, BRUNO), projectId);
      bruno.editNote(id, 'Ideia reescrita pelo Bruno');
      await bruno.flushNow();

      ana.editNote(id, 'Ideia continuada pela Ana');
      anaConnection.mode = 'ok';
      await ana.flushNow();

      expect((await stored(base, projectId))[0].content).toBe('Ideia reescrita pelo Bruno');
      expect(ana.getSnapshot().conflicts[id]).toMatchObject({ content: 'Ideia reescrita pelo Bruno' });
      expect(ana.getSnapshot().notes[0].content).toBe('Ideia continuada pela Ana');
      ana.dispose();
      bruno.dispose();
    });

    it('nota excluída por outra pessoa enquanto a resposta da criação estava a caminho não volta como fantasma', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.holdAfter.add('createNote');
      const id = bruno.addNote('geracao', 'Nota do Bruno')!;
      const flushing = bruno.flushNow();
      await tick();
      await tick();
      expect(ana.getSnapshot().notes).toHaveLength(1);

      ana.deleteNote(id);
      await ana.flushNow();
      await tick();
      expect(bruno.getSnapshot().notes).toHaveLength(0);

      brunoConnection.release();
      await flushing;

      expect(await stored(base, projectId)).toHaveLength(0);
      expect(bruno.getSnapshot().notes).toHaveLength(0);
      ana.dispose();
      bruno.dispose();
    });

    it('resposta atrasada "nota excluída" não esconde uma nota que já foi restaurada', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.holdBefore.add('updateNote');
      bruno.editNote(id, 'Texto do Bruno');
      const flushing = bruno.flushNow();
      await tick();

      // A Ana exclui; a gravação do Bruno chega ao servidor com a nota excluída
      // e a resposta fica retida; a Ana desfaz a exclusão.
      const undo = ana.deleteNote(id)!;
      await ana.flushNow();
      await tick();
      brunoConnection.release();
      brunoConnection.holdAfter.add('updateNote');
      await tick();
      await tick();
      undo();
      await ana.flushNow();
      await tick();
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Texto inicial']);

      brunoConnection.release();
      await flushing;
      await bruno.flushNow();
      await bruno.refresh();

      // A nota voltou sem mudança de texto: a edição do Bruno é uma edição comum.
      expect(bruno.getSnapshot().conflicts).toEqual({});
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Texto do Bruno']);
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Texto do Bruno']);
      ana.dispose();
      bruno.dispose();
    });
  });

  describe('agendamento', () => {
    it('com a rede de volta e a digitação em andamento, o agendador não gira em falso', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId, [], 400);

      ana.mode = 'offline';
      const id = session.addNote('problema', 'a')!;
      await session.flushNow();
      expect(session.getSnapshot().save.status).toBe('offline');

      ana.mode = 'ok';
      session.editNote(id, 'ab');
      let emits = 0;
      const unsubscribe = session.subscribe(() => {
        emits += 1;
      });
      window.dispatchEvent(new Event('online'));
      await sleep(300);
      unsubscribe();

      expect(emits).toBeLessThan(10);
      await vi.waitFor(() => expect(session.getSnapshot().save.status).toBe('saved'));
      session.dispose();
    });

    it('digitar sem conexão depois que o intervalo de espera vence não dispara um laço de temporizador', async () => {
      const { projectId, ana } = await setup();
      const session = await open(ana, projectId, [], 400);

      ana.mode = 'offline';
      const id = session.addNote('problema', 'a')!;
      await session.flushNow();

      let emits = 0;
      const unsubscribe = session.subscribe(() => {
        emits += 1;
      });
      let text = 'a';
      let keystrokes = 0;
      const started = Date.now();
      while (Date.now() - started < 2_700) {
        text += 'x';
        keystrokes += 1;
        session.editNote(id, text);
        await sleep(100);
      }
      unsubscribe();

      expect(emits).toBeLessThan(keystrokes + 20);
      session.dispose();
    }, 10_000);

    it('recarga que falha é tentada de novo', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);
      const bruno = await open(connect(base, BRUNO), projectId);

      // A Ana fica sem tempo real; o Bruno cria uma nota nesse intervalo.
      anaConnection.mode = 'offline';
      bruno.addNote('geracao', 'Nota do Bruno');
      await bruno.flushNow();

      anaConnection.mode = 'ok';
      anaConnection.failOnce.set('getProject', new AppError('network'));
      await ana.refresh();
      expect(ana.getSnapshot().notes).toHaveLength(0);
      expect(ana.getSnapshot().save.status).toBe('offline');

      await vi.waitFor(() => expect(ana.getSnapshot().notes.map((note) => note.content)).toEqual(['Nota do Bruno']), {
        timeout: 4_000,
      });
      expect(ana.getSnapshot().save.status).toBe('saved');
      ana.dispose();
      bruno.dispose();
    }, 10_000);

    it('depois de uma recarga bem sucedida o indicador não continua em "sem conexão"', async () => {
      const { projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);

      anaConnection.failOnce.set('getProject', new AppError('network'));
      await ana.refresh();
      await ana.refresh();

      ana.addNote('geracao', 'Nova nota');
      expect(ana.getSnapshot().save.status).toBe('saving');
      ana.dispose();
    });
  });

  describe('fusão e resolução', () => {
    it('"manter a minha" em conflito de texto não desfaz o movimento de bloco feito pela outra pessoa', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('geracao', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.mode = 'offline';
      bruno.editNote(id, 'Texto do Bruno');
      await bruno.flushNow();

      expect(ana.moveNote(id, 'selecionadas')).toBe(true);
      ana.editNote(id, 'Texto da Ana');
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();
      expect(id in bruno.getSnapshot().conflicts).toBe(true);
      expect(bruno.getSnapshot().notes[0].block).toBe('selecionadas');

      bruno.resolveConflict(id, 'mine');
      await bruno.flushNow();

      expect((await stored(base, projectId))[0]).toMatchObject({ content: 'Texto do Bruno', block: 'selecionadas' });
      ana.dispose();
      bruno.dispose();
    });

    it('"manter a minha" não descarta o texto quando o bloco antigo da nota ficou cheio', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const notices: SessionNotice[] = [];
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('mercado', 'Texto inicial')!;
      ana.addNote('mercado', 'Outra nota do bloco');
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId, notices);

      brunoConnection.mode = 'offline';
      bruno.editNote(id, 'Texto do Bruno');
      await bruno.flushNow();

      expect(ana.moveNote(id, 'geracao')).toBe(true);
      ana.editNote(id, 'Texto da Ana');
      await ana.flushNow();
      ana.addNote('mercado', 'Nova nota no lugar');
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();
      bruno.resolveConflict(id, 'mine');
      await bruno.flushNow();

      expect((await stored(base, projectId)).find((note) => note.id === id)).toMatchObject({
        content: 'Texto do Bruno',
        block: 'geracao',
      });
      expect(notices).toEqual([]);
      ana.dispose();
      bruno.dispose();
    });

    it('exclusão feita sem conexão não apaga o texto que outra pessoa escreveu depois', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const notices: SessionNotice[] = [];
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId, notices);

      brunoConnection.mode = 'offline';
      bruno.deleteNote(id);
      await bruno.flushNow();
      ana.editNote(id, 'Parágrafo importante escrito pela Ana');
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();
      await tick();

      expect((await stored(base, projectId)).map((note) => note.content)).toEqual([
        'Parágrafo importante escrito pela Ana',
      ]);
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Parágrafo importante escrito pela Ana']);
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect(notices.map((notice) => notice.level)).toEqual(['info']);
      ana.dispose();
      bruno.dispose();
    });

    it('exclusão de nota que outra pessoa apenas reposicionou continua valendo', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('geracao', 'Texto inicial')!;
      const other = ana.addNote('geracao', 'Outra')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      brunoConnection.mode = 'offline';
      bruno.deleteNote(id);
      await bruno.flushNow();
      ana.reorderNote(other, -1);
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();

      expect((await stored(base, projectId)).map((note) => note.id)).toEqual([other]);
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      ana.dispose();
      bruno.dispose();
    });

    it('desfazer uma exclusão ainda não confirmada não grava o texto local sobre a edição de outra pessoa', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      bruno.editNote(id, 'Texto do Bruno');
      brunoConnection.failOnce.set('deleteNote', new AppError('unknown'));
      const undo = bruno.deleteNote(id)!;
      await bruno.flushNow();

      ana.editNote(id, 'Texto da Ana');
      await ana.flushNow();
      await tick();

      undo();
      await bruno.flushNow();

      expect((await stored(base, projectId))[0].content).toBe('Texto da Ana');
      expect(bruno.getSnapshot().conflicts[id]).toMatchObject({ content: 'Texto da Ana' });
      expect(bruno.getSnapshot().notes[0].content).toBe('Texto do Bruno');
      ana.dispose();
      bruno.dispose();
    });

    it('nota escrita sem conexão em bloco que lotou nesse intervalo continua guardada', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const notices: SessionNotice[] = [];
      const ana = await open(anaConnection, projectId);
      ana.addNote('mercado', 'Primeira');
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId, notices);

      brunoConnection.mode = 'offline';
      const id = bruno.addNote('mercado', 'Parágrafo que o Bruno escreveu sem conexão')!;
      await bruno.flushNow();
      ana.addNote('mercado', 'Segunda');
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();
      await tick();

      expect(bruno.getSnapshot().notes.some((note) => note.id === id)).toBe(true);
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'error', pending: 1 });
      expect(outboxText()).toContain('Parágrafo que o Bruno escreveu sem conexão');
      expect(notices).toHaveLength(1);

      // Movida para um bloco com lugar, a nota é gravada.
      expect(bruno.moveNote(id, 'geracao')).toBe(true);
      await bruno.flushNow();
      expect((await stored(base, projectId)).find((note) => note.id === id)).toMatchObject({
        block: 'geracao',
        content: 'Parágrafo que o Bruno escreveu sem conexão',
      });
      expect(bruno.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      ana.dispose();
      bruno.dispose();
    });

    it('falha passageira na exclusão que abria vaga não faz a nota nova do mesmo bloco ser descartada', async () => {
      const { base, projectId, ana } = await setup();
      const notices: SessionNotice[] = [];
      const session = await open(ana, projectId, notices);
      const first = session.addNote('mercado', 'Primeira')!;
      session.addNote('mercado', 'Segunda');
      await session.flushNow();

      ana.failOnce.set('deleteNote', new AppError('unknown'));
      session.deleteNote(first);
      session.addNote('mercado', 'Texto da nota que substitui a primeira');
      await session.flushNow();
      await session.flushNow();

      expect(notices).toEqual([]);
      expect((await stored(base, projectId)).map((note) => note.content).sort()).toEqual([
        'Segunda',
        'Texto da nota que substitui a primeira',
      ]);
      session.dispose();
    });
  });

  describe('adoção de pendências e cópia local', () => {
    it('desfazer uma exclusão cuja resposta se perdeu sobrevive a reabrir o projeto sem conexão', async () => {
      const { base, projectId } = await setup();
      const ana = connect(base, { id: 'ana', name: 'Ana' }, true);
      const first = await open(ana, projectId);
      const id = first.addNote('parceiros', 'Universidade')!;
      await first.flushNow();

      ana.mode = 'lose-response';
      const undo = first.deleteNote(id)!;
      await first.flushNow();
      expect(await stored(base, projectId)).toHaveLength(0);

      ana.mode = 'offline';
      undo();
      expect(first.getSnapshot().notes).toHaveLength(1);
      first.dispose();
      await tick();

      const second = await open(ana, projectId);
      expect(second.getSnapshot()).toMatchObject({ stale: true });
      expect(second.getSnapshot().notes).toHaveLength(1);

      ana.mode = 'ok';
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(second.getSnapshot()).toMatchObject({ stale: false, save: { status: 'saved' } }));

      expect(second.getSnapshot().notes.map((note) => note.content)).toEqual(['Universidade']);
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Universidade']);
      second.dispose();
    });

    it('texto pendente de uma aba fechada não some quando a aba que o adota já alterou a mesma nota', async () => {
      const { base, projectId, ana } = await setup();
      const otherTab = connect(base);
      const tabA = await open(ana, projectId);
      const id = tabA.addNote('resultados', 'Texto inicial')!;
      await tabA.flushNow();
      const tabB = await open(otherTab, projectId);

      ana.mode = 'offline';
      otherTab.mode = 'offline';
      tabA.editNote(id, 'Parágrafo escrito na aba A');
      await tabA.flushNow();
      tabB.editNote(id, 'Texto da aba B');
      await tabB.flushNow();

      tabA.dispose();
      (tabB as unknown as { beat(): void }).beat();
      await tick();
      expect(outboxText()).toContain('Parágrafo escrito na aba A');

      // A aba B grava o seu texto; o da aba A é então examinado e vira conflito.
      otherTab.mode = 'ok';
      await tabB.flushNow();
      expect((await stored(base, projectId))[0].content).toBe('Texto da aba B');
      (tabB as unknown as { beat(): void }).beat();
      await tick();

      expect(tabB.getSnapshot().conflicts[id]).toMatchObject({ content: 'Texto da aba B' });
      expect(tabB.getSnapshot().notes[0].content).toBe('Parágrafo escrito na aba A');
      tabB.dispose();
    });

    it('encerrar a sessão do projeto depois da saída da conta não recria a cópia local', async () => {
      const { base, projectId } = await setup();
      const ana = connect(base, { id: 'ana', name: 'Ana' }, true);
      const session = await open(ana, projectId);
      session.addNote('mercado', 'Dado do projeto');
      await session.flushNow();
      session.addNote('geracao', 'Rascunho ainda não enviado');

      removeByPrefix(CACHE_PREFIX);
      ana.setAuth('signed_out');
      session.dispose();
      await tick();

      expect(Object.keys(localStorage).filter((key) => key.startsWith(CACHE_PREFIX))).toEqual([]);
      // O que ainda não havia sido enviado continua guardado para a volta.
      expect(outboxText()).toContain('Rascunho ainda não enviado');
    });

    it('perder o acesso ao projeto não apaga o que ainda não havia sido enviado', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      ana.mode = 'offline';
      session.addNote('geracao', 'Texto ainda não enviado');
      await session.flushNow();

      ana.mode = 'ok';
      ana.failOnce.set('getProject', new AppError('not_found'));
      await session.refresh();

      expect(session.getSnapshot().phase).toBe('not_found');
      expect(outboxText()).toContain('Texto ainda não enviado');
      session.dispose();
      expect(outboxText()).toContain('Texto ainda não enviado');
      expect(await stored(base, projectId)).toHaveLength(0);
    });

    describe('com travas entre abas (Web Locks)', () => {
      let removeLocks: () => void;
      beforeEach(() => {
        removeLocks = installLocks();
      });
      afterEach(() => removeLocks());

      it('aba viva com temporizadores atrasados não tem as pendências assumidas; aba fechada, sim', async () => {
        const { base, projectId, ana } = await setup();
        const tabA = await open(ana, projectId);
        const id = tabA.addNote('resultados', 'Texto inicial')!;
        await tabA.flushNow();
        const tabB = await open(connect(base), projectId);

        ana.mode = 'offline';
        tabA.editNote(id, 'Edição pendente na aba A');
        await tabA.flushNow();

        // Aba A em segundo plano: o último sinal gravado já tem 20 s.
        const [key] = outboxes();
        const outbox = JSON.parse(localStorage.getItem(key)!);
        localStorage.setItem(key, JSON.stringify({ ...outbox, beat: Date.now() - 20_000 }));
        (tabB as unknown as { beat(): void }).beat();
        await tick();
        expect(tabB.getSnapshot().save.pending).toBe(0);
        expect(outboxes()).toEqual([key]);

        // Aba A fechada: a trava é liberada e a aba B assume.
        tabA.dispose();
        await tick();
        (tabB as unknown as { beat(): void }).beat();
        await vi.waitFor(async () =>
          expect((await stored(base, projectId))[0].content).toBe('Edição pendente na aba A'),
        );
        expect(tabB.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
        tabB.dispose();
      });

      it('reabrir o projeto assume de imediato o que a sessão anterior deixou', async () => {
        const { base, projectId, ana } = await setup();
        const first = await open(ana, projectId);
        ana.mode = 'offline';
        first.addNote('planejamento', 'Dobrar a base de clientes');
        await first.flushNow();
        first.dispose();
        await tick();

        ana.mode = 'ok';
        const second = await open(ana, projectId);
        await vi.waitFor(() => expect(second.getSnapshot().save.status).toBe('saved'));
        expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Dobrar a base de clientes']);
        second.dispose();
      });
    });
  });

  describe('exclusão, desfazer e conflitos em sequência', () => {
    it('pendência liberada de um conflito por um evento em tempo real é enviada sem depender de outra ação do usuário', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId, [], 50);

      // O Bruno edita sem conexão; a Ana exclui a nota nesse intervalo.
      brunoConnection.mode = 'offline';
      bruno.editNote(id, 'Texto do Bruno');
      await bruno.flushNow();
      const undo = ana.deleteNote(id)!;
      await ana.flushNow();

      brunoConnection.mode = 'ok';
      await bruno.flushNow();
      expect(bruno.getSnapshot().conflicts).toEqual({ [id]: null });

      // A Ana desfaz a exclusão: para o Bruno o conflito deixa de existir.
      undo();
      await ana.flushNow();
      await tick();
      expect(bruno.getSnapshot().conflicts).toEqual({});

      await sleep(300);
      expect({
        status: bruno.getSnapshot().save.status,
        server: (await stored(base, projectId))[0].content,
      }).toEqual({ status: 'saved', server: 'Texto do Bruno' });
      ana.dispose();
      bruno.dispose();
    });

    it('conflito de texto em aberto não é resolvido a favor do texto local quando a nota é excluída e restaurada', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      // A Ana exclui a nota por engano e desfaz.
      const undo = ana.deleteNote(id)!;
      await ana.flushNow();
      await tick();
      undo();
      await ana.flushNow();
      await tick();
      await bruno.flushNow();
      await tick();

      expect({
        server: (await stored(base, projectId)).find((note) => note.id === id)?.content,
        brunoStillDeciding: id in bruno.getSnapshot().conflicts,
      }).toEqual({ server: 'Versão da Ana', brunoStillDeciding: true });
      ana.dispose();
      bruno.dispose();
    });

    it('excluir uma nota em conflito e desfazer não grava o texto local sobre o da outra pessoa sem decisão', async () => {
      const { base, projectId, ana, bruno, id } = await conflictingEdits();

      const undo = bruno.deleteNote(id)!;
      await bruno.flushNow();
      expect((await stored(base, projectId)).map((note) => note.id)).not.toContain(id);
      undo();
      await bruno.flushNow();
      await tick();

      expect({
        server: (await stored(base, projectId)).find((note) => note.id === id)?.content,
        screen: bruno.getSnapshot().notes.find((note) => note.id === id)?.content,
        brunoStillDeciding: id in bruno.getSnapshot().conflicts,
      }).toEqual({ server: 'Versão da Ana', screen: 'Versão do Bruno', brunoStillDeciding: true });
      ana.dispose();
      bruno.dispose();
    });

    it('excluir uma nota de criação não confirmada não apaga o texto que outra pessoa escreveu nela', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const ana = await open(anaConnection, projectId);

      anaConnection.mode = 'lose-response';
      const id = ana.addNote('geracao', 'Ideia')!;
      await ana.flushNow();

      const bruno = await open(connect(base, BRUNO), projectId);
      bruno.editNote(id, 'Parágrafo que o Bruno escreveu na nota da Ana');
      await bruno.flushNow();

      // A Ana, que ainda vê "Ideia", exclui a nota e a conexão volta.
      ana.deleteNote(id);
      anaConnection.mode = 'ok';
      await ana.flushNow();
      await tick();

      expect((await stored(base, projectId)).map((note) => note.content)).toEqual([
        'Parágrafo que o Bruno escreveu na nota da Ana',
      ]);
      ana.dispose();
      bruno.dispose();
    });

    it('desfazer a exclusão de uma nota com gravação própria em andamento não gera conflito consigo mesmo', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      // "AB" está a caminho; o usuário continua ("ABC") e exclui a nota.
      ana.holdBefore.add('updateNote');
      session.editNote(id, 'AB');
      const flushing = session.flushNow();
      await tick();
      session.editNote(id, 'ABC');
      const undo = session.deleteNote(id)!;
      ana.release();
      await flushing;
      await session.flushNow();
      expect(await stored(base, projectId)).toHaveLength(0);

      undo();
      await session.flushNow();
      await tick();

      expect({
        conflicts: Object.keys(session.getSnapshot().conflicts).length,
        server: (await stored(base, projectId))[0]?.content,
      }).toEqual({ conflicts: 0, server: 'ABC' });
      session.dispose();
    });

    it('desfazer a exclusão não traz de volta um texto próprio (resposta perdida) que o usuário já havia desfeito', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      // "AB" chega ao servidor, a resposta se perde; o usuário volta para "A" e exclui a nota.
      ana.mode = 'lose-response';
      session.editNote(id, 'AB');
      await session.flushNow();
      session.editNote(id, 'A');
      const undo = session.deleteNote(id)!;
      ana.mode = 'ok';
      await session.flushNow();
      expect(await stored(base, projectId)).toHaveLength(0);

      // Desfazer deve devolver a nota como estava na tela ao excluir: "A".
      undo();
      expect(session.getSnapshot().notes[0].content).toBe('A');
      await session.flushNow();
      await tick();

      expect({
        screen: session.getSnapshot().notes[0]?.content,
        server: (await stored(base, projectId))[0]?.content,
      }).toEqual({ screen: 'A', server: 'A' });
      session.dispose();
    });

    it('nota que outra pessoa moveu e trouxe de volta não é movida de novo por esta sessão', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const bruno = await open(brunoConnection, projectId);

      // A criação do Bruno chega ao servidor; a resposta demora e ele continua digitando.
      brunoConnection.holdBefore.add('createNote');
      const id = bruno.addNote('geracao', 'Ideia')!;
      const flushing = bruno.flushNow();
      await tick();
      bruno.editNote(id, 'Ideia, continuando');
      brunoConnection.release();
      brunoConnection.holdAfter.add('createNote');
      await tick();
      await tick();
      expect((await stored(base, projectId))[0]).toMatchObject({ block: 'geracao', content: 'Ideia' });

      // A Ana move a nota para outro bloco e a traz de volta.
      expect(ana.moveNote(id, 'selecionadas')).toBe(true);
      await ana.flushNow();
      await tick();
      expect(ana.moveNote(id, 'geracao')).toBe(true);
      await ana.flushNow();
      await tick();

      brunoConnection.release();
      await flushing;
      await bruno.flushNow();
      await tick();

      // O Bruno só alterou o texto.
      expect((await stored(base, projectId))[0]).toMatchObject({ block: 'geracao', content: 'Ideia, continuando' });
      ana.dispose();
      bruno.dispose();
    });

    it('digitar por alguns minutos sem conexão depois de uma resposta perdida não vira conflito com o próprio texto', async () => {
      // As gravações no servidor levam a autoria do mesmo usuário da sessão.
      sessionStorage.setItem('agitar.local.user', JSON.stringify({ id: 'ana', name: 'Ana' }));
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);
      const id = session.addNote('problema', 'A')!;
      await session.flushNow();

      ana.mode = 'lose-response';
      session.editNote(id, 'A1');
      await session.flushNow();
      expect((await stored(base, projectId))[0].content).toBe('A1');

      // Sem conexão: a cada nova tentativa o texto já é outro.
      ana.mode = 'offline';
      for (let attempt = 2; attempt <= 10; attempt += 1) {
        session.editNote(id, `A${attempt}`);
        await session.flushNow();
      }

      ana.mode = 'ok';
      await session.flushNow();
      await session.flushNow();

      expect({
        conflicts: Object.keys(session.getSnapshot().conflicts).length,
        server: (await stored(base, projectId))[0].content,
      }).toEqual({ conflicts: 0, server: 'A10' });
      session.dispose();
    });

    it('resposta atrasada da própria exclusão não esconde a nota que outra pessoa já restaurou', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const brunoConnection = connect(base, BRUNO);
      const ana = await open(anaConnection, projectId);
      const id = ana.addNote('problema', 'Texto inicial')!;
      await ana.flushNow();
      const bruno = await open(brunoConnection, projectId);

      // A Ana tem texto ainda não enviado na nota.
      ana.editNote(id, 'Texto da Ana');

      // A exclusão do Bruno chega ao servidor; a resposta demora.
      brunoConnection.holdAfter.add('deleteNote');
      bruno.deleteNote(id);
      const flushing = bruno.flushNow();
      await tick();
      await tick();
      expect(ana.getSnapshot().conflicts).toEqual({ [id]: null });

      // A Ana escolhe manter a dela: a nota é restaurada e regravada.
      ana.resolveConflict(id, 'mine');
      await ana.flushNow();
      await tick();
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Texto da Ana']);

      brunoConnection.release();
      await flushing;
      await bruno.refresh();

      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Texto da Ana']);
      expect(bruno.getSnapshot().notes.map((note) => note.content)).toEqual(['Texto da Ana']);
      ana.dispose();
      bruno.dispose();
    });

    it('pendência de uma sessão encerrada, regravada depois da adoção, não volta como conflito contra o texto mais novo do próprio usuário', async () => {
      const { base, projectId, ana } = await setup();
      const first = await open(ana, projectId);
      const id = first.addNote('resultados', 'Texto inicial')!;
      await first.flushNow();

      // O usuário sai da tela com uma gravação que fica sem resposta.
      ana.holdBefore.add('updateNote');
      first.editNote(id, 'Texto novo');
      first.dispose();
      await tick();

      // Reabre o projeto: a nova sessão assume a pendência, grava e o usuário continua escrevendo.
      const again = connect(base);
      const second = await open(again, projectId);
      await second.flushNow();
      expect((await stored(base, projectId))[0].content).toBe('Texto novo');
      second.editNote(id, 'Texto novo, continuado');
      await second.flushNow();

      // A gravação antiga falha por tempo esgotado; a sessão encerrada regrava a sua chave.
      ana.mode = 'offline';
      ana.release();
      await tick();
      await tick();
      (second as unknown as { beat(): void }).beat();
      await tick();
      await second.flushNow();

      expect({
        conflicts: Object.keys(second.getSnapshot().conflicts).length,
        screen: second.getSnapshot().notes[0].content,
        server: (await stored(base, projectId))[0].content,
      }).toEqual({ conflicts: 0, screen: 'Texto novo, continuado', server: 'Texto novo, continuado' });
      second.dispose();
    });

    it('excluir uma nota de criação não confirmada, sem que ninguém a tenha alterado, exclui a nota no servidor', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      ana.mode = 'lose-response';
      const id = session.addNote('geracao', 'Ideia')!;
      await session.flushNow();
      expect(await stored(base, projectId)).toHaveLength(1);

      session.deleteNote(id);
      ana.mode = 'ok';
      ana.writes = 0;
      await session.flushNow();

      expect(await stored(base, projectId)).toHaveLength(0);
      expect(session.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      // Uma consulta sem efeito e a exclusão: nada é criado só para ser excluído.
      expect(ana.writes).toBe(2);
      session.dispose();
    });

    it('excluir uma nota cuja criação nunca chegou ao servidor não fica presa, mesmo com o bloco cheio lá', async () => {
      const { base, projectId, ana: anaConnection } = await setup();
      const notices: SessionNotice[] = [];
      const ana = await open(anaConnection, projectId, notices);
      const bruno = await open(connect(base, BRUNO), projectId);

      anaConnection.mode = 'offline';
      const id = ana.addNote('mercado', 'Nota da Ana que não chegou a ser enviada')!;
      await ana.flushNow();
      bruno.addNote('mercado', 'Primeira do Bruno');
      bruno.addNote('mercado', 'Segunda do Bruno');
      await bruno.flushNow();

      ana.deleteNote(id);
      anaConnection.mode = 'ok';
      await ana.flushNow();
      await ana.refresh();

      expect(ana.getSnapshot().save).toMatchObject({ status: 'saved', pending: 0 });
      expect(ana.getSnapshot().notes.map((note) => note.content)).toEqual(['Primeira do Bruno', 'Segunda do Bruno']);
      expect(notices).toEqual([]);
      ana.dispose();
      bruno.dispose();
    });

    it('desfazer a exclusão enquanto o servidor é consultado mantém a nota', async () => {
      const { base, projectId, ana } = await setup();
      const session = await open(ana, projectId);

      ana.mode = 'offline';
      const id = session.addNote('geracao', 'Ideia')!;
      await session.flushNow();
      const undo = session.deleteNote(id)!;

      ana.mode = 'ok';
      ana.holdBefore.add('updateNote');
      const flushing = session.flushNow();
      await tick();
      undo();
      ana.release();
      await flushing;
      await session.flushNow();

      expect(session.getSnapshot().notes.map((note) => note.content)).toEqual(['Ideia']);
      expect((await stored(base, projectId)).map((note) => note.content)).toEqual(['Ideia']);
      session.dispose();
    });
  });
});
