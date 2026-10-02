import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BLOCKS_BY_STEP, GROUPS, getBlock, type BlockId } from '@/methodology/agitar';
import { cx } from '@/lib/cx';
import { BlockGuide } from './BlockGuide';
import { NoteList } from './NoteList';
import { useWorkspace } from './WorkspaceContext';
import styles from './StepsView.module.css';

interface StepsViewProps {
  active: BlockId;
  onSelect: (block: BlockId) => void;
}

/**
 * Preenchimento guiado: um bloco por vez, na ordem recomendada pela
 * metodologia, com a orientação e as perguntas norteadoras ao lado das notas.
 */
export function StepsView({ active, onSelect }: StepsViewProps) {
  const workspace = useWorkspace();
  const block = getBlock(active);
  const index = BLOCKS_BY_STEP.findIndex((candidate) => candidate.id === active);
  const previous = BLOCKS_BY_STEP[index - 1];
  const next = BLOCKS_BY_STEP[index + 1];

  return (
    <div className={styles.layout}>
      <nav className={styles.rail} aria-label="Etapas do canvas">
        <ol>
          {BLOCKS_BY_STEP.map((step) => {
            const count = workspace.notesByBlock[step.id].length;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={cx(styles.step, step.id === active && styles.current)}
                  data-group={step.group}
                  aria-current={step.id === active ? 'step' : undefined}
                  onClick={() => onSelect(step.id)}
                >
                  <span className={cx(styles.number, count > 0 && styles.done)}>
                    {count > 0 ? <Check size={12} aria-hidden /> : step.step}
                  </span>
                  <span className={styles.stepTitle}>{step.shortTitle}</span>
                  <span className={styles.stepCount}>
                    {count}/{step.limit}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className={styles.panel} data-group={block.group} aria-labelledby="etapa-titulo" data-testid={`etapa-${block.id}`}>
        <header className={styles.panelHeader}>
          <p className={styles.meta}>
            Etapa {block.step} de {BLOCKS_BY_STEP.length} · {GROUPS[block.group].label}
          </p>
          <h2 id="etapa-titulo">{block.title}</h2>
        </header>

        <div className={styles.columns}>
          <div className={styles.notes}>
            <NoteList block={block} />
          </div>
          <aside className={styles.guide} aria-label="Orientação metodológica">
            <BlockGuide block={block} />
          </aside>
        </div>

        <footer className={styles.pager}>
          <Button
            variant="ghost"
            icon={<ArrowLeft size={16} aria-hidden />}
            disabled={!previous}
            onClick={() => previous && onSelect(previous.id)}
          >
            {previous ? previous.shortTitle : 'Anterior'}
          </Button>
          <Button
            variant={next ? 'primary' : 'ghost'}
            iconRight={next ? <ArrowRight size={16} aria-hidden /> : undefined}
            disabled={!next}
            onClick={() => next && onSelect(next.id)}
          >
            {next ? next.shortTitle : 'Última etapa'}
          </Button>
        </footer>
      </section>
    </div>
  );
}
