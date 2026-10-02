import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowDown, ArrowRightLeft, ArrowUp, MoreHorizontal, PencilLine, Trash2, TriangleAlert } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import type { Note, Person } from '@/domain/types';
import { LIMITS } from '@/domain/validation';
import { cx } from '@/lib/cx';
import { BLOCKS_BY_STEP, type BlockId } from '@/methodology/agitar';
import styles from './NoteCard.module.css';

export interface NoteCardProps {
  note: Note;
  readOnly: boolean;
  editing: boolean;
  /** Outra pessoa que está editando esta nota agora. */
  lockedBy: Person | null;
  /** Presente quando há conflito: versão atual no servidor, ou null se a nota foi excluída. */
  conflict?: Note | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Blocos que ainda têm espaço para receber a nota. */
  openBlocks: ReadonlySet<BlockId>;
  onStartEdit: () => void;
  onStopEdit: (finalContent: string) => void;
  onChange: (content: string) => void;
  onDelete: () => void;
  onMove: (block: BlockId) => void;
  onReorder: (direction: -1 | 1) => void;
  onResolve: (choice: 'mine' | 'theirs') => void;
}

export function NoteCard({
  note,
  readOnly,
  editing,
  lockedBy,
  conflict,
  canMoveUp,
  canMoveDown,
  openBlocks,
  onStartEdit,
  onStopEdit,
  onChange,
  onDelete,
  onMove,
  onReorder,
  onResolve,
}: NoteCardProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hasConflict = conflict !== undefined;

  // A altura acompanha o conteúdo, sem barra de rolagem interna.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [note.content, editing]);

  useEffect(() => {
    if (editing && textarea.current && document.activeElement !== textarea.current) {
      const element = textarea.current;
      element.focus({ preventScroll: false });
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [editing]);

  const menu: MenuItem[] = [
    { label: 'Editar', icon: <PencilLine size={16} aria-hidden />, onSelect: onStartEdit },
    { type: 'separator' },
    { label: 'Mover para cima', icon: <ArrowUp size={16} aria-hidden />, disabled: !canMoveUp, onSelect: () => onReorder(-1) },
    { label: 'Mover para baixo', icon: <ArrowDown size={16} aria-hidden />, disabled: !canMoveDown, onSelect: () => onReorder(1) },
    { type: 'separator' },
    { type: 'label', label: 'Mover para o bloco' },
    ...BLOCKS_BY_STEP.filter((block) => block.id !== note.block).map<MenuItem>((block) => ({
      label: block.title,
      icon: <ArrowRightLeft size={16} aria-hidden />,
      disabled: !openBlocks.has(block.id),
      hint: openBlocks.has(block.id) ? undefined : 'cheio',
      onSelect: () => onMove(block.id),
    })),
    { type: 'separator' },
    { label: 'Excluir', icon: <Trash2 size={16} aria-hidden />, danger: true, onSelect: onDelete },
  ];

  return (
    <li
      className={cx(styles.note, editing && styles.editing, hasConflict && styles.conflicted, lockedBy && styles.locked)}
      data-note-id={note.id}
    >
      {editing ? (
        <textarea
          ref={textarea}
          className={styles.textarea}
          value={note.content}
          maxLength={LIMITS.note}
          rows={2}
          placeholder="Escreva a nota…"
          aria-label="Texto da nota"
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onStopEdit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : readOnly || lockedBy ? (
        <p className={styles.text}>{note.content || <span className={styles.blank}>Nota em branco</span>}</p>
      ) : (
        <button type="button" className={styles.textButton} onClick={onStartEdit} aria-label={`Editar nota: ${note.content || 'em branco'}`}>
          <span className={styles.text}>{note.content || <span className={styles.blank}>Nota em branco</span>}</span>
        </button>
      )}

      {lockedBy && !editing && (
        <p className={styles.lock}>
          <Avatar person={lockedBy} size={18} />
          <span>{lockedBy.name} está editando</span>
        </p>
      )}

      {!readOnly && !editing && !hasConflict && (
        <div className={styles.actions}>
          <Menu
            trigger={
              <IconButton label="Ações da nota" size="sm">
                <MoreHorizontal size={16} aria-hidden />
              </IconButton>
            }
            items={lockedBy ? [{ ...menu[0], label: 'Editar mesmo assim' } as MenuItem, ...menu.slice(1)] : menu}
          />
        </div>
      )}

      {hasConflict && (
        <div className={styles.conflict} role="alert">
          <p className={styles.conflictTitle}>
            <TriangleAlert size={14} aria-hidden />
            Edição simultânea
          </p>
          {conflict ? (
            <>
              <p>Outra pessoa alterou esta nota enquanto você editava. Versão dela:</p>
              <blockquote>{conflict.content || 'Nota em branco'}</blockquote>
            </>
          ) : (
            <p>Outra pessoa excluiu esta nota enquanto você editava.</p>
          )}
          <div className={styles.conflictActions}>
            <Button size="sm" variant="primary" onClick={() => onResolve('mine')}>
              Manter a minha
            </Button>
            <Button size="sm" onClick={() => onResolve('theirs')}>
              {conflict ? 'Usar a outra' : 'Aceitar exclusão'}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
