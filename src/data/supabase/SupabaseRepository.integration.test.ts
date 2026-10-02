// @vitest-environment node
import { createHmac } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyProjectInput } from '@/domain/validation';
import { newId } from '@/lib/id';
import { SupabaseRepository } from './SupabaseRepository';

/**
 * Testes de integração do modo nuvem. Rodam apenas por "npm run test:api",
 * que sobe Postgres e PostgREST com as migrações aplicadas. Tempo real e
 * login por provedor externo não são cobertos aqui.
 */

const API_URL = process.env.API_TEST_URL;
const JWT_SECRET = process.env.API_TEST_JWT_SECRET ?? '';

const USERS = {
  ana: { id: '00000000-0000-0000-0000-00000000000a', email: 'ana@exemplo.com' },
  bruno: { id: '00000000-0000-0000-0000-00000000000b', email: 'bruno@exemplo.com' },
  carla: { id: '00000000-0000-0000-0000-00000000000c', email: 'carla@exemplo.com' },
} as const;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function jwt(user: { id: string; email: string }): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ role: 'authenticated', sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

let proxy: Server;
let proxyUrl = '';

/** O cliente Supabase chama /rest/v1/...; o PostgREST atende na raiz. */
beforeAll(async () => {
  if (!API_URL) return;
  const target = new URL(API_URL);
  proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        host: target.hostname,
        port: target.port,
        method: incoming.method,
        path: (incoming.url ?? '/').replace(/^\/rest\/v1/, '') || '/',
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 500, response.headers);
        response.pipe(outgoing);
      },
    );
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

afterAll(() => {
  proxy?.close();
});

async function signedIn(user: { id: string; email: string }): Promise<SupabaseRepository> {
  const client = createClient(proxyUrl, 'chave-anonima', {
    global: { headers: { Authorization: `Bearer ${jwt(user)}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // A sessão é simulada: o que se testa aqui é o acesso a dados, não o login.
  const session = { user: { id: user.id, email: user.email, user_metadata: {} } };
  client.auth.getSession = (async () => ({ data: { session }, error: null })) as unknown as typeof client.auth.getSession;
  client.auth.onAuthStateChange = (() => ({
    data: { subscription: { unsubscribe: () => undefined } },
  })) as unknown as typeof client.auth.onAuthStateChange;

  const repository = new SupabaseRepository(client, 'http://localhost/');
  await new Promise<void>((resolve) => {
    const check = () => (repository.auth.getSnapshot().status === 'signed_in' ? resolve() : setTimeout(check, 5));
    check();
  });
  return repository;
}

describe.skipIf(!API_URL)('SupabaseRepository contra a API', () => {
  let ana: SupabaseRepository;
  let bruno: SupabaseRepository;
  let carla: SupabaseRepository;
  let projectId = '';

  beforeAll(async () => {
    [ana, bruno, carla] = await Promise.all([signedIn(USERS.ana), signedIn(USERS.bruno), signedIn(USERS.carla)]);
  });

  it('cria e lista projetos com papel, contagem por bloco e proprietário', async () => {
    const project = await ana.createProject({
      ...emptyProjectInput(),
      name: '  Projeto Alfa ',
      organization: 'Empresa X',
      participants: ['Ana', 'Bruno'],
    });
    projectId = project.id;
    expect(project).toMatchObject({ name: 'Projeto Alfa', role: 'owner', ownerId: USERS.ana.id, participants: ['Ana', 'Bruno'] });

    await ana.createNote({ id: newId(), projectId, block: 'mercado', content: 'PMEs de TIC', position: 1 });
    await ana.createNote({ id: newId(), projectId, block: 'geracao', content: 'Ideia', position: 1 });

    const [summary] = await ana.listProjects();
    expect(summary).toMatchObject({ id: projectId, role: 'owner', memberCount: 1, noteCounts: { mercado: 1, geracao: 1 } });
    expect(summary.owner).toMatchObject({ id: USERS.ana.id, name: 'Ana Proprietária' });
  });

  it('isola projetos de quem não participa', async () => {
    expect(await bruno.listProjects()).toEqual([]);
    await expect(bruno.getProject(projectId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(bruno.duplicateProject(projectId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      bruno.createNote({ id: newId(), projectId, block: 'mercado', content: 'invasão', position: 9 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('cria notas de forma idempotente e controla concorrência pela versão', async () => {
    const draft = { id: newId(), projectId, block: 'problema' as const, content: 'Texto inicial', position: 1 };
    const created = await ana.createNote(draft);
    const again = await ana.createNote(draft);
    expect(again).toMatchObject({ id: created.id, version: 1 });

    const first = await ana.updateNote(created.id, { content: 'Primeira edição' }, 1);
    expect(first).toMatchObject({ ok: true, note: { version: 2, content: 'Primeira edição', updatedBy: USERS.ana.id } });

    const stale = await ana.updateNote(created.id, { content: 'Edição atrasada' }, 1);
    expect(stale).toMatchObject({ ok: false, current: { version: 2, content: 'Primeira edição' } });

    // Exclusão condicionada à versão: quem ainda via a versão 1 não exclui a nota já editada.
    expect(await ana.deleteNote(created.id, 1)).toMatchObject({ ok: false, current: { version: 2 } });
    expect(await ana.deleteNote(created.id, 2)).toEqual({ ok: true });
    expect(await ana.updateNote(created.id, { content: 'x' }, 3)).toEqual({ ok: false, current: null });

    // Excluir de novo é aceito; recriar uma nota excluída não a traz de volta.
    expect(await ana.deleteNote(created.id)).toEqual({ ok: true });
    await expect(ana.createNote(draft)).rejects.toMatchObject({ code: 'not_found' });

    const restored = await ana.restoreNote(created.id);
    expect(restored.content).toBe('Primeira edição');
    expect((await ana.restoreNote(created.id)).version).toBe(restored.version);
    expect((await ana.getProject(projectId)).notes.map((note) => note.id)).toContain(created.id);

    await expect(ana.restoreNote(newId())).rejects.toMatchObject({ code: 'not_found' });
    expect(await ana.deleteNote(newId())).toEqual({ ok: true });
  });

  it('traduz o limite do bloco em erro compreensível', async () => {
    await ana.createNote({ id: newId(), projectId, block: 'mercado', content: 'Segundo', position: 2 });
    await expect(
      ana.createNote({ id: newId(), projectId, block: 'mercado', content: 'Terceiro', position: 3 }),
    ).rejects.toMatchObject({ code: 'block_full' });
  });

  it('atualiza dados do projeto e registra o histórico com autoria', async () => {
    const updated = await ana.updateProject(projectId, { status: 'active', responsible: ' Ana ' });
    expect(updated).toMatchObject({ status: 'active', responsible: 'Ana', role: 'owner', name: 'Projeto Alfa' });
    await expect(ana.updateProject(projectId, { name: '   ' })).rejects.toMatchObject({ code: 'validation' });

    const events = await ana.listEvents(projectId, { limit: 50 });
    const kinds = events.map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(['project_created', 'note_created', 'note_deleted', 'note_restored', 'project_updated']));
    expect(events[0].actor).toMatchObject({ id: USERS.ana.id, name: 'Ana Proprietária' });

    const older = await ana.listEvents(projectId, { limit: 2, before: events[1].at });
    expect(older.every((event) => event.at < events[1].at)).toBe(true);
  });

  it('salva e restaura versões', async () => {
    await ana.createVersion(projectId, 'Marco 1');
    const before = (await ana.getProject(projectId)).notes;
    const target = before.find((note) => note.block === 'geracao')!;
    await ana.updateNote(target.id, { content: 'Alterada depois do marco' }, target.version);

    const [version] = await ana.listVersions(projectId);
    expect(version).toMatchObject({ label: 'Marco 1', kind: 'manual', noteCount: before.length });
    expect(version.createdBy).toMatchObject({ name: 'Ana Proprietária' });

    await ana.restoreVersion(version.id);
    const after = (await ana.getProject(projectId)).notes;
    expect(after.find((note) => note.id === target.id)?.content).toBe('Ideia');
    expect((await ana.listVersions(projectId)).map((item) => item.kind)).toContain('restore');
    await expect(ana.createVersion(projectId, '  ')).rejects.toMatchObject({ code: 'invalid_label' });
  });

  it('convida por email e aplica os papéis', async () => {
    const sharing = ana.sharing;
    await expect(sharing.invite(projectId, 'sem-arroba', 'viewer')).rejects.toMatchObject({ code: 'invalid_email' });

    // O convite não concede acesso por si só, nem a quem já tem conta.
    expect(await sharing.invite(projectId, 'Bruno@Exemplo.com', 'viewer')).toBe('invited');
    await expect(bruno.getProject(projectId)).rejects.toMatchObject({ code: 'not_found' });
    expect(await bruno.listProjects()).toEqual([]);

    // Só a pessoa convidada vê e responde o convite.
    expect(await carla.sharing.listReceivedInvites()).toEqual([]);
    const received = await bruno.sharing.listReceivedInvites();
    expect(received).toMatchObject([{ projectId, projectName: expect.any(String), role: 'viewer' }]);
    await expect(carla.sharing.acceptInvite(received[0].id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await bruno.sharing.acceptInvite(received[0].id)).toBe(projectId);
    expect(await bruno.sharing.listReceivedInvites()).toEqual([]);
    expect(await sharing.invite(projectId, 'bruno@exemplo.com', 'viewer')).toBe('already_member');

    // Recusar remove o convite sem conceder acesso.
    await sharing.invite(projectId, 'carla@exemplo.com', 'editor');
    const [toCarla] = await carla.sharing.listReceivedInvites();
    await carla.sharing.declineInvite(toCarla.id);
    expect(await carla.sharing.listReceivedInvites()).toEqual([]);
    await expect(carla.getProject(projectId)).rejects.toMatchObject({ code: 'not_found' });

    const members = await sharing.listMembers(projectId);
    expect(members.map((member) => [member.user.email, member.role])).toEqual([
      ['ana@exemplo.com', 'owner'],
      ['bruno@exemplo.com', 'viewer'],
    ]);

    // Visualizador: lê, mas não grava.
    const asViewer = await bruno.getProject(projectId);
    expect(asViewer.project.role).toBe('viewer');
    const note = asViewer.notes[0];
    await expect(bruno.updateNote(note.id, { content: 'tentativa' }, note.version)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bruno.deleteNote(note.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bruno.updateProject(projectId, { name: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bruno.sharing.invite(projectId, 'carla@exemplo.com', 'editor')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await bruno.sharing.listLinks(projectId)).toEqual([]);

    // Editor: grava notas, mas não gerencia o projeto.
    await sharing.setRole(projectId, USERS.bruno.id, 'editor');
    const edited = await bruno.updateNote(note.id, { content: 'Editada pelo Bruno' }, note.version);
    expect(edited).toMatchObject({ ok: true, note: { updatedBy: USERS.bruno.id } });
    await expect(bruno.setArchived(projectId, true)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bruno.deleteProject(projectId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bruno.sharing.setRole(projectId, USERS.bruno.id, 'editor')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('gerencia convites pendentes e links de acesso', async () => {
    const sharing = ana.sharing;
    expect(await sharing.invite(projectId, 'dora@exemplo.com', 'editor')).toBe('invited');
    const [invite] = await sharing.listInvites(projectId);
    expect(invite).toMatchObject({ email: 'dora@exemplo.com', role: 'editor' });
    await sharing.revokeInvite(invite.id);
    expect(await sharing.listInvites(projectId)).toEqual([]);

    const link = await sharing.createLink(projectId, 'viewer', 7);
    expect(link.token).toMatch(/^[0-9a-f]{64}$/);
    expect(link.expiresAt).not.toBeNull();
    expect((await sharing.listLinks(projectId)).map((item) => item.id)).toEqual([link.id]);

    await expect(carla.sharing.joinViaLink('token-inexistente')).rejects.toMatchObject({ code: 'invalid_link' });
    expect(await carla.sharing.joinViaLink(link.token)).toBe(projectId);
    expect((await carla.getProject(projectId)).project.role).toBe('viewer');

    await sharing.revokeLink(link.id);
    expect(await sharing.listLinks(projectId)).toEqual([]);

    await carla.sharing.leave(projectId);
    await expect(carla.getProject(projectId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(ana.sharing.leave(projectId)).rejects.toMatchObject({ code: 'owner_cannot_leave' });

    await sharing.removeMember(projectId, USERS.bruno.id);
    expect(await bruno.listProjects()).toEqual([]);
  });

  it('duplica, arquiva e exclui', async () => {
    const copyId = await ana.duplicateProject(projectId);
    const copy = await ana.getProject(copyId);
    expect(copy.project).toMatchObject({ name: 'Projeto Alfa (cópia)', role: 'owner' });
    expect(copy.notes.length).toBe((await ana.getProject(projectId)).notes.length);

    const archived = await ana.setArchived(projectId, true);
    expect(archived.archivedAt).not.toBeNull();
    const note = (await ana.getProject(projectId)).notes[0];
    await expect(ana.updateNote(note.id, { content: 'x' }, note.version)).rejects.toMatchObject({ code: 'project_archived' });
    await ana.setArchived(projectId, false);

    await ana.deleteProject(projectId);
    await ana.deleteProject(copyId);
    expect(await ana.listProjects()).toEqual([]);
  });

  it('atualiza o nome do perfil', async () => {
    await ana.auth.updateName('Ana Lima');
    expect(ana.auth.getSnapshot().user?.name).toBe('Ana Lima');
  });
});
