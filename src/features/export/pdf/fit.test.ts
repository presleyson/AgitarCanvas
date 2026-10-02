import { describe, expect, it } from 'vitest';
import { contentHeight, fitCanvas, type BlockBox } from './fit';

const box = (notes: string[], overrides: Partial<BlockBox> = {}): BlockBox => ({
  width: 180,
  height: 300,
  columns: 1,
  notes,
  ...overrides,
});

describe('ajuste do texto ao canvas de página única', () => {
  it('usa a maior fonte quando o conteúdo é curto', () => {
    const result = fitCanvas([box(['PMEs de TIC']), box([])], [10, 9, 8, 7]);
    expect(result).toMatchObject({ fontSize: 10, truncated: false });
  });

  it('reduz a fonte quando o conteúdo não cabe na maior', () => {
    const long = 'Texto de tamanho médio para ocupar algumas linhas do bloco. '.repeat(6);
    const boxes = [box([long, long, long])];
    const result = fitCanvas(boxes, [10, 9, 8, 7, 6]);
    expect(result.fontSize).toBeLessThan(10);
    expect(result.truncated).toBe(false);
    expect(contentHeight(boxes[0], result.fontSize)).toBeLessThanOrEqual(300);
  });

  it('abrevia as notas como último recurso e sinaliza', () => {
    const huge = 'x'.repeat(2000);
    const result = fitCanvas([box([huge, huge, huge, huge, huge])], [8, 7]);
    expect(result.truncated).toBe(true);
    expect(result.fontSize).toBe(7);
    expect(result.notes[0].every((note) => note.endsWith('…'))).toBe(true);
    expect(contentHeight(box(result.notes[0]), 7)).toBeLessThanOrEqual(300);
  });

  it('considera a distribuição em colunas', () => {
    const notes = ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)];
    const single = contentHeight(box(notes, { width: 540, columns: 1 }), 9);
    const triple = contentHeight(box(notes, { width: 540, columns: 3 }), 9);
    expect(triple).toBeLessThan(single * 1.2);
  });
});
