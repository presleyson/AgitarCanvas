import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRepository } from './RepositoryContext';
import { ProjectSession, type SessionNotice, type SessionSnapshot } from './ProjectSession';

const LOADING: SessionSnapshot = {
  phase: 'loading',
  error: null,
  project: null,
  notes: [],
  conflicts: {},
  save: { status: 'saved', pending: 0, lastSavedAt: null },
  presence: [],
  readOnly: true,
  stale: false,
  revision: 0,
};

const noopSubscribe = () => () => undefined;
const loadingSnapshot = () => LOADING;

/** Abre uma sessão de trabalho no projeto e a encerra ao sair da tela. */
export function useProjectSession(
  projectId: string,
  onNotice: (notice: SessionNotice) => void,
): { session: ProjectSession | null; snapshot: SessionSnapshot } {
  const repository = useRepository();
  const [session, setSession] = useState<ProjectSession | null>(null);

  useEffect(() => {
    const created = new ProjectSession(repository, projectId, { onNotice });
    setSession(created);
    void created.start();
    return () => {
      created.dispose();
      setSession(null);
    };
    // onNotice é estável (vem do provedor de avisos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, projectId]);

  const snapshot = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : loadingSnapshot,
  );

  return { session, snapshot };
}
