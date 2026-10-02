import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/data/local/LocalRepository';
import type { AuthSnapshot, ProjectChange, Repository } from '@/data/repository';
import { emptyProjectInput } from '@/domain/validation';
import { AppError } from '@/lib/errors';
import { ProjectSession, type SessionNotice } from './ProjectSession';

/**
 * Teste por propriedade da sincronização, com sequências aleatórias e
 * reproduzíveis de ações de um único usuário sobre uma conexão instável
 * (sem rede, respostas perdidas, chamadas retidas, fechar e reabrir).
 *
 * Propriedade: como ninguém mais altera o projeto, nunca pode surgir conflito
 * nem aviso de recusa do servidor, e ao final o servidor tem exatamente o que
 * o usuário deixou na tela.
 *
 * Para investigar uma falha, repita apenas a semente informada:
 *   FUZZ_FROM=<semente> FUZZ_COUNT=1 npx vitest run src/state/ProjectSession.fuzz.test.ts
 */

const SEEDS = Number(process.env.FUZZ_COUNT ?? 120);
const FIRST_SEED = Number(process.env.FUZZ_FROM ?? 1);
const STEPS = 40;

const WRITES = new Set(['createNote', 'updateNote', 'deleteNote', 'restoreNote']);
const NETWORK = new Set([...WRITES, 'getProject']);
const BLOCKS = ['planejamento', 'geracao'] as const;
const MODES = ['ok', 'ok', 'offline', 'lose-response'] as const;

const LOCAL_LIMIT = new AppError('block_full').message;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Connection {
  repo: Repository;
  mode: (typeof MODES)[number];
  holdBefore: boolean;
  holdAfter: boolean;
  release(): void;
}

function connect(base: LocalRepository, cloud: boolean): Connection {
  const waiting: Array<() => void> = [];
  const auth: AuthSnapshot = { status: 'signed_in', user: { id: 'ana', name: 'Ana' } };
  const connection: Connection = {
    repo: null as unknown as Repository,
    mode: 'ok',
    holdBefore: false,
    holdAfter: false,
    release() {
      this.holdBefore = false;
      this.holdAfter = false;
      waiting.splice(0).forEach((resume) => resume());
    },
  };
  const offline = () => connection.mode === 'offline';
  const authApi = { ...base.auth, getSnapshot: () => auth, subscribe: () => () => undefined };

  connection.repo = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'auth') return authApi;
      if (property === 'mode') return cloud ? 'cloud' : 'local';
      if (property === 'subscribe') {
        return (projectId: string, handler: (change: ProjectChange) => void) =>
          target.subscribe(projectId, (change) => {
            if (connection.mode === 'ok') handler(change);
          });
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      const name = String(property);
      return (...args: unknown[]) => {
        if (!NETWORK.has(name)) return value.apply(target, args);
        return (async () => {
          if (offline()) throw new AppError('network');
          if (connection.holdBefore && WRITES.has(name)) await new Promise<void>((resume) => waiting.push(resume));
          if (offline()) throw new AppError('network');
          const result = await value.apply(target, args);
          if (connection.holdAfter && WRITES.has(name)) await new Promise<void>((resume) => waiting.push(resume));
          if (connection.mode === 'lose-response' && WRITES.has(name)) throw new AppError('network');
          return result;
        })();
      };
    },
  }) as Repository;
  return connection;
}

/** Gerador congruente linear: a mesma semente produz sempre a mesma sequência. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Shape = Array<{ id: string; block: string; content: string; position: number }>;
const shape = (notes: Shape) =>
  notes
    .map((note) => `${note.id.slice(0, 4)}|${note.block}|${note.content}|${note.position}`)
    .sort()
    .join('\n');

async function run(seed: number, cloud: boolean): Promise<string[]> {
  localStorage.clear();
  const random = generator(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

  const base = new LocalRepository();
  const project = await base.createProject({ ...emptyProjectInput(), name: 'Projeto' });
  const connection = connect(base, cloud);
  const notices: SessionNotice[] = [];
  const open = async () => {
    const created = new ProjectSession(connection.repo, project.id, {
      debounceMs: 60_000,
      onNotice: (notice) => notices.push(notice),
    });
    await created.start();
    return created;
  };

  let session = await open();
  let undos: Array<() => void> = [];
  const earlier = new Map<string, string[]>();
  const running: Array<Promise<void>> = [];
  const problems: string[] = [];
  const log: string[] = [];
  let counter = 0;

  for (let step = 0; step < STEPS; step += 1) {
    const notes = session.getSnapshot().notes;
    const roll = random();

    if (roll < 0.08 && notes.length < 4) {
      const id = session.addNote(pick(BLOCKS), `n${(counter += 1)}`);
      log.push(`criar ${id?.slice(0, 4)}`);
    } else if (roll < 0.4 && notes.length > 0) {
      // Às vezes o usuário volta a um texto que a nota já teve.
      const note = pick(notes);
      const past = earlier.get(note.id) ?? [];
      const text = past.length > 0 && random() < 0.35 ? pick(past) : `t${(counter += 1)}`;
      earlier.set(note.id, [...past, note.content].slice(-3));
      session.editNote(note.id, text);
      log.push(`editar ${note.id.slice(0, 4)} ${text}`);
    } else if (roll < 0.47 && notes.length > 0) {
      const note = pick(notes);
      const undo = session.deleteNote(note.id);
      if (undo) undos.push(undo);
      log.push(`excluir ${note.id.slice(0, 4)}`);
    } else if (roll < 0.54 && undos.length > 0) {
      const index = Math.floor(random() * undos.length);
      undos.splice(index, 1)[0]();
      log.push(`desfazer ${index}`);
    } else if (roll < 0.59 && notes.length > 0) {
      const note = pick(notes);
      session.moveNote(note.id, pick(BLOCKS));
      log.push(`mover ${note.id.slice(0, 4)}`);
    } else if (roll < 0.64 && notes.length > 0) {
      const note = pick(notes);
      session.reorderNote(note.id, random() < 0.5 ? -1 : 1);
      log.push(`reordenar ${note.id.slice(0, 4)}`);
    } else if (roll < 0.78) {
      running.push(session.flushNow().catch(() => undefined));
      await tick();
      log.push('enviar');
    } else if (roll < 0.86) {
      connection.mode = pick(MODES);
      log.push(`rede ${connection.mode}`);
    } else if (roll < 0.9) {
      if (random() < 0.5) connection.holdBefore = true;
      else connection.holdAfter = true;
      log.push('reter');
    } else if (roll < 0.95) {
      connection.release();
      await tick();
      log.push('liberar');
    } else if (roll < 0.97 && (connection.mode !== 'offline' || (cloud && step > 3))) {
      // Fechar e reabrir: a tela deve voltar como estava.
      const before = shape(session.getSnapshot().notes);
      session.dispose();
      connection.release();
      await tick();
      session = await open();
      undos = [];
      if (session.getSnapshot().phase !== 'ready') problems.push(`reabrir falhou: ${session.getSnapshot().phase}`);
      const after = shape(session.getSnapshot().notes);
      if (before !== after) problems.push(`reabrir mudou a tela\nANTES\n${before}\nDEPOIS\n${after}`);
      log.push('reabrir');
    } else {
      running.push(session.refresh().catch(() => undefined));
      await tick();
      log.push('recarregar');
    }

    if (Object.keys(session.getSnapshot().conflicts).length > 0 && problems.length === 0) {
      problems.push(`conflito com um único usuário no passo ${step} (${log[log.length - 1]})`);
    }
  }

  // A rede volta e tudo o que ficou pendente é enviado.
  const intended = shape(session.getSnapshot().notes);
  connection.mode = 'ok';
  connection.release();
  await Promise.all(running);
  for (let round = 0; round < 8; round += 1) {
    await session.flushNow();
    await tick();
    await session.refresh();
    if (session.getSnapshot().save.pending === 0) break;
  }

  const server = shape((await base.getProject(project.id)).notes);
  const screen = shape(session.getSnapshot().notes);
  const { save } = session.getSnapshot();
  // Desfazer uma exclusão com o bloco já cheio na tela gera o aviso de limite,
  // que é esperado. Qualquer outro aviso indicaria uma recusa do servidor.
  const unexpected = notices.filter((notice) => notice.message !== LOCAL_LIMIT);
  if (unexpected.length > 0) problems.push(`avisos: ${unexpected.map((notice) => notice.message).join(' | ')}`);
  if (save.status !== 'saved') problems.push(`indicador final: ${save.status}`);
  if (server !== intended) problems.push(`servidor diferente do que ficou na tela\nTELA\n${intended}\nSERVIDOR\n${server}`);
  if (screen !== server) problems.push(`tela final diferente do servidor\nTELA\n${screen}\nSERVIDOR\n${server}`);
  session.dispose();

  return problems.length > 0 ? [`semente ${seed}`, ...problems, `AÇÕES ${log.join('; ')}`] : [];
}

describe('ProjectSession: sequências aleatórias de um único usuário', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  for (const cloud of [false, true]) {
    it(`o servidor termina igual à tela, sem conflitos nem avisos (${cloud ? 'modo nuvem' : 'modo local'})`, async () => {
      const failures: string[] = [];
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS && failures.length < 3; seed += 1) {
        const problems = await run(cloud ? seed + 1_000_000 : seed, cloud);
        if (problems.length > 0) failures.push(problems.join('\n'));
      }
      expect(failures.join('\n=====\n')).toBe('');
    }, Math.max(120_000, SEEDS * 500));
  }
});
