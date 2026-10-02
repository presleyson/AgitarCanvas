import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthSnapshot, Repository } from '@/data/repository';

const RepositoryContext = createContext<Repository | null>(null);

export function RepositoryProvider({ repository, children }: { repository: Repository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): Repository {
  const repository = useContext(RepositoryContext);
  if (!repository) throw new Error('useRepository deve ser usado dentro de RepositoryProvider.');
  return repository;
}

/** Estado de autenticação atual, reativo. */
export function useAuth(): AuthSnapshot {
  const { auth } = useRepository();
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
}
