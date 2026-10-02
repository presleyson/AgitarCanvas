import { Info } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { BLOCKS, type BlockDefinition } from '@/methodology/agitar';
import { cx } from '@/lib/cx';
import { NoteList } from './NoteList';
import { useWorkspace } from './WorkspaceContext';
import styles from './CanvasBoard.module.css';

/**
 * Visão geral do planejamento em formato canvas: as nove dimensões em uma
 * única tela, na disposição espacial do modelo. Em telas médias a grade é
 * rearranjada em três colunas; em telas pequenas, vira uma lista na ordem de
 * preenchimento.
 */
export function CanvasBoard() {
  return (
    <div className={styles.board} data-testid="canvas-board">
      {BLOCKS.map((block) => (
        <CanvasBlock key={block.id} block={block} />
      ))}
    </div>
  );
}

function CanvasBlock({ block }: { block: BlockDefinition }) {
  const workspace = useWorkspace();
  const count = workspace.notesByBlock[block.id].length;
  const here = workspace.presence.filter((entry) => entry.block === block.id);

  return (
    <section
      id={`bloco-${block.id}`}
      className={cx(styles.block, styles[block.id])}
      data-group={block.group}
      data-testid={`bloco-${block.id}`}
      aria-labelledby={`titulo-${block.id}`}
      style={{ order: block.step }}
    >
      <header className={styles.header}>
        <span className={styles.step} aria-hidden>
          {block.step}
        </span>
        <h2 id={`titulo-${block.id}`} className={styles.title}>
          {block.title}
        </h2>
        {here.length > 0 && (
          <span className={styles.presence}>
            {here.slice(0, 3).map((entry) => (
              <Avatar key={entry.connectionId} person={entry.user} size={18} title={`${entry.user.name} está neste bloco`} />
            ))}
          </span>
        )}
        <span className={styles.count} aria-label={`${count} de ${block.limit} notas`}>
          {count}/{block.limit}
        </span>
        <IconButton label={`Orientações para ${block.title}`} size="sm" onClick={() => workspace.openGuide(block.id)}>
          <Info size={15} aria-hidden />
        </IconButton>
      </header>
      <div className={styles.body}>
        <NoteList block={block} />
      </div>
    </section>
  );
}
