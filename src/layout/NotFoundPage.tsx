import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/Feedback';
import { AppShell } from './AppShell';

export function NotFoundPage() {
  return (
    <AppShell>
      <EmptyState
        icon={<Compass size={26} aria-hidden />}
        title="Página não encontrada"
        description="O endereço pode ter mudado ou o conteúdo não existe mais."
        action={<Link to="/projetos">Ir para Meus Projetos</Link>}
      />
    </AppShell>
  );
}
