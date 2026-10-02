import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, GraduationCap, Building2, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { MiniCanvas } from '@/components/MiniCanvas';
import { ACRONYM } from '@/methodology/agitar';
import { errorMessage } from '@/lib/errors';
import { useRepository } from '@/state/RepositoryContext';
import { GoogleIcon } from './GoogleIcon';
import styles from './LandingPage.module.css';

const PREVIEW = { planejamento: 3, problema: 1, mercado: 2, geracao: 4, selecionadas: 2, financeiros: 1, tecnicos: 0, parceiros: 2, resultados: 0 };

/** Página de entrada para quem ainda não iniciou sessão. */
export function LandingPage() {
  const repository = useRepository();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    try {
      await repository.auth.signIn();
    } catch (cause) {
      setError(errorMessage(cause));
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <header className={styles.top}>
          <Logo inverted />
          <Link to="/metodologia" className={styles.topLink}>
            Metodologia
          </Link>
        </header>

        <div className={styles.heroBody}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Gestão da inovação tecnológica</p>
            <h1 className={styles.title}>Do planejamento estratégico aos resultados, em um único canvas.</h1>
            <p className={styles.lead}>
              O AGITAR Canvas organiza o processo de inovação de pequenas e médias empresas de tecnologia em nove
              dimensões. Planeje com sua equipe, registre decisões e acompanhe a evolução de cada projeto.
            </p>

            <div className={styles.cta}>
              <Button variant="secondary" size="lg" onClick={signIn} loading={loading} icon={<GoogleIcon />}>
                Entrar com Google
              </Button>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>

          <div className={styles.preview} aria-hidden>
            <div className={styles.previewCard}>
              <div className={styles.previewBar}>
                <span />
                <span />
                <span />
              </div>
              <MiniCanvas counts={PREVIEW} detailed />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.pillars}>
        <article>
          <GraduationCap size={22} aria-hidden />
          <h2>Fundamentação acadêmica</h2>
          <p>
            Modelo desenvolvido e validado em tese de doutorado, a partir de revisão da literatura e de estudos de caso
            com empresas de TIC.
          </p>
        </article>
        <article>
          <Building2 size={22} aria-hidden />
          <h2>Aplicabilidade empresarial</h2>
          <p>
            Projetos salvos automaticamente, histórico de alterações e relatórios em A4 e A3 prontos para reuniões e
            workshops.
          </p>
        </article>
        <article>
          <Users size={22} aria-hidden />
          <h2>Trabalho colaborativo</h2>
          <p>
            Convide a equipe, defina quem edita e quem apenas visualiza, e acompanhe as contribuições em tempo real.
          </p>
        </article>
      </section>

      <section className={styles.acronym} aria-labelledby="acronimo">
        <h2 id="acronimo">O que significa AGITAR</h2>
        <ol>
          {ACRONYM.map((item, index) => (
            <li key={index}>
              <span className={styles.letter}>{item.letter}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link to="/metodologia" className={styles.more}>
          Conhecer a metodologia <ArrowRight size={16} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
