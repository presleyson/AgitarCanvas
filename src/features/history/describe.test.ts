import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@/domain/types';
import { describeEvent } from './describe';

const event = (partial: Partial<HistoryEvent>): HistoryEvent => ({
  id: '1',
  projectId: 'p',
  actor: { id: 'ana', name: 'Ana' },
  at: new Date().toISOString(),
  kind: 'note_created',
  block: null,
  noteId: null,
  before: null,
  after: null,
  ...partial,
});

describe('descrição dos eventos do histórico', () => {
  it('descreve a edição de uma nota com antes e depois', () => {
    const result = describeEvent(
      event({ kind: 'note_updated', block: 'mercado', before: { content: 'PMEs' }, after: { content: 'PMEs de TIC' } }),
    );
    expect(result.action).toBe('editou uma nota em Mercado');
    expect(result.changes).toEqual([{ before: 'PMEs', after: 'PMEs de TIC' }]);
  });

  it('descreve a mudança de bloco', () => {
    const result = describeEvent(event({ kind: 'note_moved', before: { block: 'geracao' }, after: { block: 'selecionadas' } }));
    expect(result.action).toBe('moveu uma nota de Geração de Ideias para Ideias Selecionadas');
  });

  it('lista apenas os campos alterados do projeto, com rótulos legíveis', () => {
    const result = describeEvent(
      event({
        kind: 'project_updated',
        before: { status: 'draft', participants: [] },
        after: { status: 'active', participants: ['Ana', 'Bruno'] },
      }),
    );
    expect(result.changes).toEqual([
      { label: 'Status', before: 'Rascunho', after: 'Em andamento' },
      { label: 'Participantes', before: '(vazio)', after: 'Ana, Bruno' },
    ]);
  });

  it('distingue as formas de entrada e saída de pessoas', () => {
    expect(describeEvent(event({ kind: 'member_added', after: { email: 'b@x.com', role: 'editor' } })).action).toBe(
      'adicionou b@x.com como editor',
    );
    expect(describeEvent(event({ kind: 'member_added', after: { role: 'viewer', via: 'link' } })).action).toBe(
      'entrou no projeto por link, como visualizador',
    );
    expect(describeEvent(event({ kind: 'member_removed', before: { left: true } })).action).toBe('saiu do projeto');
    expect(describeEvent(event({ kind: 'member_removed', before: { name: 'Bruno' } })).action).toBe('removeu Bruno do projeto');
  });

  it('não falha com eventos de tipo desconhecido', () => {
    expect(describeEvent(event({ kind: 'futuro' as HistoryEvent['kind'] })).action).toBe('realizou uma alteração');
  });
});
