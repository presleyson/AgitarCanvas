/**
 * Ajuste do texto ao espaço fixo dos blocos no canvas de página única.
 *
 * O gerador de PDF não reduz fontes automaticamente. Estas funções estimam a
 * altura ocupada pelas notas e escolhem o maior tamanho de fonte com que todos
 * os blocos cabem. Se nem o menor tamanho bastar, as notas são abreviadas e o
 * documento informa que o conteúdo completo está no relatório A4.
 */

/** Largura média de um caractere em Inter, como fração do tamanho da fonte. */
const AVERAGE_CHAR_WIDTH = 0.54;
const LINE_HEIGHT = 1.32;

export const NOTE_PADDING_Y = 4;
export const NOTE_PADDING_X = 5;
export const NOTE_GAP = 3;

export interface BlockBox {
  /** Largura interna disponível para as notas. */
  width: number;
  /** Altura interna disponível para as notas. */
  height: number;
  /** Número de colunas em que as notas se distribuem. */
  columns: number;
  notes: string[];
}

export function estimateLines(text: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(8, Math.floor(width / (fontSize * AVERAGE_CHAR_WIDTH)));
  return text.split('\n').reduce((lines, paragraph) => lines + Math.max(1, Math.ceil(paragraph.length / charsPerLine)), 0);
}

export function noteHeight(text: string, width: number, fontSize: number): number {
  return estimateLines(text, width - NOTE_PADDING_X * 2, fontSize) * fontSize * LINE_HEIGHT + NOTE_PADDING_Y * 2;
}

/** Altura total das notas do bloco, considerando a distribuição em colunas. */
export function contentHeight(box: BlockBox, fontSize: number): number {
  if (box.notes.length === 0) return 0;
  const columnWidth = (box.width - NOTE_GAP * (box.columns - 1)) / box.columns;
  const heights = new Array<number>(box.columns).fill(0);
  box.notes.forEach((note, index) => {
    const column = index % box.columns;
    heights[column] += noteHeight(note, columnWidth, fontSize) + NOTE_GAP;
  });
  return Math.max(...heights) - NOTE_GAP;
}

export function fits(boxes: BlockBox[], fontSize: number): boolean {
  return boxes.every((box) => contentHeight(box, fontSize) <= box.height);
}

export interface FitResult {
  fontSize: number;
  /** Notas por bloco, possivelmente abreviadas, na mesma ordem de entrada. */
  notes: string[][];
  truncated: boolean;
}

/** Escolhe o maior tamanho de fonte que acomoda todos os blocos; abrevia como último recurso. */
export function fitCanvas(boxes: BlockBox[], sizes: number[]): FitResult {
  const candidates = [...sizes].sort((a, b) => b - a);
  for (const fontSize of candidates) {
    if (fits(boxes, fontSize)) {
      return { fontSize, notes: boxes.map((box) => box.notes), truncated: false };
    }
  }

  const fontSize = candidates[candidates.length - 1];
  let truncated = false;
  const notes = boxes.map((box) => {
    if (contentHeight(box, fontSize) <= box.height) return box.notes;
    truncated = true;

    // Reduz progressivamente o tamanho máximo de cada nota até caber.
    let limit = Math.max(...box.notes.map((note) => note.length));
    let current = box.notes;
    while (limit > 24) {
      limit = Math.floor(limit * 0.85);
      current = box.notes.map((note) => (note.length > limit ? `${note.slice(0, limit).trimEnd()}…` : note));
      if (contentHeight({ ...box, notes: current }, fontSize) <= box.height) break;
    }
    return current;
  });

  return { fontSize, notes, truncated };
}
