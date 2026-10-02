import type { Note, Project } from '@/domain/types';
import { BLOCKS, type BlockId } from '@/methodology/agitar';

/** Dados necessários para gerar qualquer documento de exportação. */
export interface ExportData {
  project: Project;
  notes: Note[];
  /** Momento da emissão do documento. */
  issuedAt: Date;
}

export function notesByBlock(notes: Note[]): Record<BlockId, Note[]> {
  const grouped = Object.fromEntries(BLOCKS.map((block) => [block.id, [] as Note[]])) as Record<BlockId, Note[]>;
  for (const note of notes) {
    if (note.content.trim()) grouped[note.block]?.push(note);
  }
  return grouped;
}
