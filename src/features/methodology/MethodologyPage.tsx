import { MiniCanvas } from '@/components/MiniCanvas';
import { AppShell } from '@/layout/AppShell';
import { ACRONYM, BLOCKS_BY_STEP, GROUPS, REFERENCES, THESIS_REFERENCE } from '@/methodology/agitar';
import styles from './MethodologyPage.module.css';

const ALL_FILLED = Object.fromEntries(BLOCKS_BY_STEP.map((block) => [block.id, 1]));

/** Apresenta o modelo AGITAR Canvas, sua origem e as referências que o sustentam. */
export function MethodologyPage() {
  return (
    <AppShell>
      <article className={styles.article}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>Metodologia</p>
          <h1>AGITAR Canvas</h1>
          <p className={styles.lead}>
            Modelo de gestão da inovação tecnológica para pequenas e médias empresas de Tecnologia da Informação e
            Comunicação. Foi construído a partir de revisão bibliográfica e validado por pesquisa qualitativa com
            empresas do setor, em tese de doutorado defendida na Universidade FUMEC em 2024.
          </p>
        </header>

        <section aria-labelledby="acronimo" className={styles.section}>
          <h2 id="acronimo">O acrônimo</h2>
          <p className={styles.sectionLead}>
            Cada letra representa uma fase do processo de inovação, da identificação de oportunidades ao
            aperfeiçoamento das soluções.
          </p>
          <ol className={styles.acronym}>
            {ACRONYM.map((item, index) => (
              <li key={index}>
                <span className={styles.letter}>{item.letter}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="canvas" className={styles.section}>
          <h2 id="canvas">O canvas</h2>
          <p className={styles.sectionLead}>
            O quadro reúne nove dimensões. A disposição abaixo segue a figura do framework na tese; os números indicam
            a ordem de preenchimento recomendada.
          </p>
          <div className={styles.canvas}>
            <MiniCanvas counts={ALL_FILLED} detailed />
          </div>
          <ul className={styles.legend}>
            {Object.entries(GROUPS).map(([id, group]) => (
              <li key={id} data-group={id}>
                {group.label}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            O agrupamento por cores é um recurso desta interface para facilitar a leitura e não integra a formulação
            original do modelo.
          </p>
        </section>

        <section aria-labelledby="dimensoes" className={styles.section}>
          <h2 id="dimensoes">As nove dimensões</h2>
          <ol className={styles.blocks}>
            {BLOCKS_BY_STEP.map((block) => (
              <li key={block.id} data-group={block.group}>
                <span className={styles.step}>{block.step}</span>
                <div>
                  <h3>{block.title}</h3>
                  <p>{block.guidance}</p>
                  <p className={styles.questionsTitle}>Perguntas norteadoras</p>
                  <ul className={styles.questions}>
                    {block.questions.map((question) => (
                      <li key={question.text}>
                        {question.text} <cite>({question.source})</cite>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="referencias" className={styles.section}>
          <h2 id="referencias">Referências</h2>
          <p className={styles.sectionLead}>Obra de origem do modelo:</p>
          <p className={styles.reference}>{THESIS_REFERENCE}</p>
          <p className={styles.sectionLead}>
            Obras citadas nas perguntas norteadoras, conforme a lista de referências da tese:
          </p>
          <ul className={styles.references}>
            {REFERENCES.map((reference) => (
              <li key={reference} className={styles.reference}>
                {reference}
              </li>
            ))}
          </ul>
        </section>
      </article>
    </AppShell>
  );
}
