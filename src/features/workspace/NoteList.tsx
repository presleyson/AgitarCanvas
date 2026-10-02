import { Plus } from 'lucide-react';
import type { BlockDefinition } from '@/methodology/agitar';
import { NoteCard } from './NoteCard';
import { useWorkspace } from './WorkspaceContext';
import styles from './NoteList.module.css';

/** Notas de um bloco, com o texto de orientação quando vazio e o botão de adicionar. */
export function NoteList({ block }: { block: BlockDefinition }) {
  const workspace = useWorkspace();
  const notes = workspace.notesByBlock[block.id];
  const full = notes.length >= block.limit;

  return (
    <div className={styles.wrapper}>
      {notes.length === 0 ? (
        <p className={styles.placeholder}>{block.placeholder}</p>
      ) : (
        <ul className={styles.list}>
          {notes.map((note, index) => {
            const editor = workspace.presence.find((entry) => entry.editingNoteId === note.id)?.user ?? null;
            return (
              <NoteCard
                key={note.id}
                note={note}
                readOnly={workspace.readOnly}
                editing={workspace.editingNoteId === note.id}
                lockedBy={editor}
                conflict={note.id in workspace.conflicts ? workspace.conflicts[note.id] : undefined}
                canMoveUp={index > 0}
                canMoveDown={index < notes.length - 1}
                openBlocks={workspace.openBlocks}
                onStartEdit={() => workspace.startEdit(note)}
                onStopEdit={(content) => workspace.stopEdit(note, content)}
                onChange={(content) => workspace.changeNote(note.id, content)}
                onDelete={() => workspace.deleteNote(note)}
                onMove={(target) => workspace.moveNote(note.id, target)}
                onReorder={(direction) => workspace.reorderNote(note.id, direction)}
                onResolve={(choice) => workspace.resolveConflict(note.id, choice)}
              />
            );
          })}
        </ul>
      )}

      {!workspace.readOnly &&
        (full ? (
          <p className={styles.full}>Limite de {block.limit} notas atingido</p>
        ) : (
          <button type="button" className={styles.add} onClick={() => workspace.addNote(block.id)}>
            <Plus size={14} aria-hidden />
            Adicionar nota
            <span className="sr-only"> em {block.title}</span>
          </button>
        ))}
    </div>
  );
}
