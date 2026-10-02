import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { RETURN_TO_KEY } from '@/data/supabase/SupabaseRepository';
import { safeSessionStorage } from '@/lib/storage';
import { useAuth } from '@/state/RepositoryContext';
import { FullPageLoading } from '@/layout/FullPageLoading';
import { LandingPage } from './LandingPage';

/**
 * Protege as rotas internas. Sem sessão, mostra a página de entrada no lugar
 * do conteúdo; depois do login, devolve o usuário ao endereço que ele tentou
 * abrir (por exemplo, um link de convite).
 */
export function RequireAuth() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== 'signed_in') return;
    const storage = safeSessionStorage();
    const returnTo = storage?.getItem(RETURN_TO_KEY);
    if (returnTo) {
      storage?.removeItem(RETURN_TO_KEY);
      const path = returnTo.replace(/^#/, '');
      if (path && path !== '/' && path !== window.location.hash.replace(/^#/, '')) {
        navigate(path, { replace: true });
      }
    }
  }, [status, navigate]);

  if (status === 'loading') return <FullPageLoading label="Carregando sua sessão" />;
  if (status === 'signed_out') return <LandingPage />;
  return <Outlet />;
}
