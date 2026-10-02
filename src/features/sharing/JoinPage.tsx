import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LinkIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/Feedback';
import { errorMessage } from '@/lib/errors';
import { AppShell } from '@/layout/AppShell';
import { FullPageLoading } from '@/layout/FullPageLoading';
import { useRepository } from '@/state/RepositoryContext';

/** Destino dos links de acesso: associa o usuário ao projeto e abre o canvas. */
export function JoinPage() {
  const { token = '' } = useParams();
  const repository = useRepository();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!repository.sharing) {
      setError('Links de acesso funcionam apenas quando a plataforma opera conectada ao servidor.');
      return;
    }
    repository.sharing
      .joinViaLink(token)
      .then((projectId) => navigate(`/projetos/${projectId}`, { replace: true }))
      .catch((cause) => setError(errorMessage(cause)));
  }, [repository, token, navigate]);

  if (!error) return <FullPageLoading label="Abrindo o projeto" />;

  return (
    <AppShell>
      <EmptyState
        icon={<LinkIcon size={26} aria-hidden />}
        title="Não foi possível usar este link"
        description={`${error} Peça um novo link ao proprietário do projeto.`}
        action={<Link to="/projetos">Ir para Meus Projetos</Link>}
      />
    </AppShell>
  );
}
