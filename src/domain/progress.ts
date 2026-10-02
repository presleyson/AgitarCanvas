import { BLOCKS, type BlockId } from '@/methodology/agitar';

/** Quantos blocos do canvas têm pelo menos uma nota. */
export function filledBlocks(counts: Partial<Record<BlockId, number>>): number {
  return BLOCKS.filter((block) => (counts[block.id] ?? 0) > 0).length;
}

export function progressPercent(counts: Partial<Record<BlockId, number>>): number {
  return Math.round((filledBlocks(counts) / BLOCKS.length) * 100);
}

export function countByBlock(notes: ReadonlyArray<{ block: BlockId }>): Partial<Record<BlockId, number>> {
  const counts: Partial<Record<BlockId, number>> = {};
  for (const note of notes) {
    counts[note.block] = (counts[note.block] ?? 0) + 1;
  }
  return counts;
}
