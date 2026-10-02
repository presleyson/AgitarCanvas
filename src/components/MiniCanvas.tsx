import { CANVAS_LAYOUT, getBlock, type BlockId } from '@/methodology/agitar';
import { cx } from '@/lib/cx';
import styles from './MiniCanvas.module.css';

interface MiniCanvasProps {
  /** Quantidade de notas por bloco; blocos sem nota aparecem vazios. */
  counts: Partial<Record<BlockId, number>>;
  /** Quando informado, cada bloco vira um botão (mapa de navegação). */
  onSelect?: (block: BlockId) => void;
  active?: BlockId | null;
  /** Mostra título curto e contagem dentro de cada bloco. */
  detailed?: boolean;
}

const ORDER: BlockId[] = [...CANVAS_LAYOUT.columns, ...CANVAS_LAYOUT.side, ...CANVAS_LAYOUT.base];

/**
 * Miniatura do canvas na disposição original do modelo. Serve de assinatura
 * visual nos cartões de projeto e de mapa de navegação em telas pequenas.
 */
export function MiniCanvas({ counts, onSelect, active, detailed = false }: MiniCanvasProps) {
  return (
    <div className={cx(styles.canvas, detailed && styles.detailed)} role={onSelect ? 'navigation' : 'img'} aria-label="Visão geral do canvas">
      {ORDER.map((id) => {
        const block = getBlock(id);
        const count = counts[id] ?? 0;
        const className = cx(styles.cell, styles[id], count > 0 && styles.filled, active === id && styles.active);
        const content = detailed ? (
          <>
            <span className={styles.step}>{block.step}</span>
            <span className={styles.name}>{block.shortTitle}</span>
            <span className={styles.count}>
              {count}/{block.limit}
            </span>
          </>
        ) : null;

        return onSelect ? (
          <button
            key={id}
            type="button"
            className={className}
            data-group={block.group}
            onClick={() => onSelect(id)}
            aria-label={`${block.title}: ${count} de ${block.limit} notas`}
            aria-current={active === id || undefined}
          >
            {content}
          </button>
        ) : (
          <span key={id} className={className} data-group={block.group}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
