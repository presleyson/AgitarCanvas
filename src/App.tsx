import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import type { Repository } from './data/repository';
import { ToastProvider } from './components/ui/Toast';
import { RepositoryProvider } from './state/RepositoryContext';
import { RequireAuth } from './features/auth/RequireAuth';
import { JoinPage } from './features/sharing/JoinPage';
import { MethodologyPage } from './features/methodology/MethodologyPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { NotFoundPage } from './layout/NotFoundPage';

/** Ao trocar de página, a nova tela começa no topo. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * Raiz da aplicação. As rotas usam o fragmento da URL (#/...), o que permite
 * hospedagem estática sem regras de reescrita no servidor.
 */
export function App({ repository }: { repository: Repository }) {
  return (
    <RepositoryProvider repository={repository}>
      <ToastProvider>
        <HashRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Navigate to="/projetos" replace />} />
            <Route path="/metodologia" element={<MethodologyPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/projetos" element={<ProjectsPage />} />
              <Route path="/projetos/:projectId" element={<WorkspacePage />} />
              <Route path="/entrar/:token" element={<JoinPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </RepositoryProvider>
  );
}
