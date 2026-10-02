import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProjectInput } from '@/domain/validation';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { LocalRepository } from './LocalRepository';

async function setup() {
  const repo = new LocalRepository();
  const project = await repo.createProject({ ...emptyProjectInput(), name: '  Projeto Alfa ', organization: 'Empresa X' });
  const add = (block: Parameters<typeof repo.createNote>[0]['block'], content: string, position = 1) =>
    repo.createNote({ id: newId(), projectId: project.id, block, content, position });
  return { repo, project, add };
}

describe('LocalRepository', () => {
  beforeEach(() => localStorage.clear());

  it('cria o projeto com nome normalizado e o lista com contagem por bloco', async () => {
    const { repo, project, add } = await setup();
    await add('mercado', 'PMEs de TIC');
    await add('geracao', 'Ideia 1');
    await add('geracao', 'Ideia 2', 2);

    const [summary] = await repo.listProjects();
    expect(project.name).toBe('Projeto Alfa');
    expect(summary.role).toBe('owner');
    expect(summary.noteCounts).toEqual({ mercado: 1, geracao: 2 });
  });

  it('persiste entre instâncias do repositório', async () => {
    const { project, add } = await setup();
    await add('problema', 'Persistir');

    const reopened = await new LocalRepository().getProject(project.id);
    expect(reopened.notes.map((note) => note.content)).toEqual(['Persistir']);
  });

  it('recusa nota além do limite do bloco', async () => {
    const { add } = await setup();
    await add('mercado', 'Um');
    await add('mercado', 'Dois', 2);
    await expect(add('mercado', 'Três', 3)).rejects.toMatchObject({ code: 'block_full' });
  });

  it('criação repetida com o mesmo id é idempotente', async () => {
    const { repo, project } = await setup();
    const draft = { id: newId(), projectId: project.id, block: 'mercado' as const, content: 'Único', position: 1 };
    await repo.createNote(draft);
    await repo.createNote(draft);
    expect((await repo.getProject(project.id)).notes).toHaveLength(1);
  });

  it('só grava quando a versão informada é a atual', async () => {
    const { repo, add } = await setup();
    const note = await add('problema', 'Original');

    const first = await repo.updateNote(note.id, { content: 'Primeira edição' }, note.version);
    expect(first).toMatchObject({ ok: true, note: { version: 2, content: 'Primeira edição' } });

    const stale = await repo.updateNote(note.id, { content: 'Edição atrasada' }, note.version);
    expect(stale).toMatchObject({ ok: false, current: { version: 2, content: 'Primeira edição' } });
  });

  it('respeita o limite ao mover e ao desfazer exclusão', async () => {
    const { repo, add } = await setup();
    const a = await add('mercado', 'A');
    await add('mercado', 'B', 2);
    const idea = await add('geracao', 'Ideia');

    await expect(repo.updateNote(idea.id, { block: 'mercado' }, idea.version)).rejects.toMatchObject({ code: 'block_full' });

    await repo.deleteNote(a.id);
    const moved = await repo.updateNote(idea.id, { block: 'mercado' }, idea.version);
    expect(moved.ok).toBe(true);
    await expect(repo.restoreNote(a.id)).rejects.toBeInstanceOf(AppError);
  });

  it('exclui de forma idempotente e, com versão informada, só se a nota não mudou', async () => {
    const { repo, add } = await setup();
    const note = await add('problema', 'Texto inicial');
    const edited = await repo.updateNote(note.id, { content: 'Editada por outra pessoa' }, note.version);
    expect(edited.ok).toBe(true);

    // Quem pede a exclusão ainda via a versão anterior: nada é excluído.
    expect(await repo.deleteNote(note.id, note.version)).toMatchObject({
      ok: false,
      current: { content: 'Editada por outra pessoa', version: note.version + 1 },
    });
    expect(await repo.deleteNote(note.id, note.version + 1)).toEqual({ ok: true });
    expect(await repo.deleteNote(note.id, note.version + 1)).toEqual({ ok: true });
    expect(await repo.deleteNote('nota-inexistente')).toEqual({ ok: true });

    // Recriar uma nota excluída não a traz de volta; restaurar, sim.
    await expect(
      repo.createNote({ id: note.id, projectId: note.projectId, block: 'problema', content: 'x', position: 1 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await repo.restoreNote(note.id)).content).toBe('Editada por outra pessoa');
  });

  it('projeto arquivado não aceita edição', async () => {
    const { repo, project, add } = await setup();
    const note = await add('problema', 'x');
    await repo.setArchived(project.id, true);
    await expect(repo.updateNote(note.id, { content: 'y' }, note.version)).rejects.toMatchObject({ code: 'project_archived' });
    await repo.setArchived(project.id, false);
    expect((await repo.updateNote(note.id, { content: 'y' }, note.version)).ok).toBe(true);
  });

  it('consolida edições seguidas em um único evento de histórico', async () => {
    const { repo, project, add } = await setup();
    const note = await add('problema', '');
    await repo.updateNote(note.id, { content: 'Baixa' }, 1);
    await repo.updateNote(note.id, { content: 'Baixa maturidade' }, 2);

    const events = await repo.listEvents(project.id);
    const noteEvents = events.filter((event) => event.noteId === note.id);
    expect(noteEvents).toHaveLength(1);
    expect(noteEvents[0]).toMatchObject({ kind: 'note_created', after: { content: 'Baixa maturidade' } });
  });

  it('registra apenas os campos alterados do projeto', async () => {
    const { repo, project } = await setup();
    await repo.updateProject(project.id, { status: 'active' });
    const [event] = (await repo.listEvents(project.id)).filter((candidate) => candidate.kind === 'project_updated');
    expect(event.before).toEqual({ status: 'draft' });
    expect(event.after).toEqual({ status: 'active' });
  });

  it('restaura uma versão e guarda o estado anterior', async () => {
    const { repo, project, add } = await setup();
    const kept = await add('problema', 'Estado do marco');
    const removed = await add('geracao', 'Será excluída');
    await repo.createVersion(project.id, 'Marco 1');

    await repo.updateNote(kept.id, { content: 'Alterada depois' }, kept.version);
    await repo.deleteNote(removed.id);
    await add('resultados', 'Criada depois');

    const [version] = await repo.listVersions(project.id);
    await repo.restoreVersion(version.id);

    const { notes } = await repo.getProject(project.id);
    expect(notes.map((note) => note.content).sort()).toEqual(['Estado do marco', 'Será excluída']);

    const versions = await repo.listVersions(project.id);
    expect(versions.map((item) => item.kind)).toContain('restore');
  });

  it('duplica o projeto com as notas ativas', async () => {
    const { repo, project, add } = await setup();
    await add('mercado', 'Mantida');
    const deleted = await add('problema', 'Excluída');
    await repo.deleteNote(deleted.id);

    const copyId = await repo.duplicateProject(project.id);
    const copy = await repo.getProject(copyId);
    expect(copy.project.name).toBe('Projeto Alfa (cópia)');
    expect(copy.notes.map((note) => note.content)).toEqual(['Mantida']);
    expect(copy.notes[0].id).not.toBe(deleted.id);
  });

  it('avisa os assinantes sobre alterações', async () => {
    const { repo, project, add } = await setup();
    const changes: string[] = [];
    repo.subscribe(project.id, (change) => changes.push(change.type));
    await add('mercado', 'x');
    await Promise.resolve();
    expect(changes).toEqual(['note']);
  });
});
