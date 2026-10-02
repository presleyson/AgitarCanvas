import { createContext, useContext } from 'react';
import type { Note, PresenceState } from '@/domain/types';
import type { BlockId } from '@/methodology/agitar';

/** Estado e ações do canvas compartilhados entre as visões (Canvas e Etapas). */
export interface WorkspaceValue {
  notesByBlock: Record<BlockId, Note[]>;
  conflicts: Record<string, Note | null>;
  presence: PresenceState[];
  readOnly: boolean;
  editingNoteId: string | null;
  /** Blocos que ainda podem receber notas. */
  openBlocks: ReadonlySet<BlockId>;
  addNote: (block: BlockId) => void;
  startEdit: (note: Note) => void;
  stopEdit: (note: Note, finalContent: string) => void;
  changeNote: (noteId: string, content: string) => void;
  deleteNote: (note: Note) => void;
  moveNote: (noteId: string, block: BlockId) => void;
  reorderNote: (noteId: string, direction: -1 | 1) => void;
  resolveConflict: (noteId: string, choice: 'mine' | 'theirs') => void;
  openGuide: (block: BlockId) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace deve ser usado dentro de WorkspaceProvider.');
  return value;
}
