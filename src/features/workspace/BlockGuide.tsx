import { GROUPS, type BlockDefinition } from '@/methodology/agitar';
import styles from './BlockGuide.module.css';

/** Orientação metodológica de um bloco: propósito e perguntas norteadoras. */
export function BlockGuide({ block, showHeading = false }: { block: BlockDefinition; showHeading?: boolean }) {
  return (
    <div className={styles.guide} data-group={block.group}>
      {showHeading && (
        <p className={styles.meta}>
          Etapa {block.step} de 9 · {GROUPS[block.group].label}
        </p>
      )}
      <p className={styles.guidance}>{block.guidance}</p>
      <p className={styles.questionsTitle}>Perguntas norteadoras</p>
      <ul className={styles.questions}>
        {block.questions.map((question) => (
          <li key={question.text}>
            {question.text} <cite>({question.source})</cite>
          </li>
        ))}
      </ul>
    </div>
  );
}
