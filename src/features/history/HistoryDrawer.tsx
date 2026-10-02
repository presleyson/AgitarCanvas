import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, History, RotateCcw, Save } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';
import type { HistoryEvent, VersionKind, VersionSummary } from '@/domain/types';
import { LIMITS } from '@/domain/validation';
import { formatDateTime, formatDayLabel, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useRepository } from '@/state/RepositoryContext';
import { describeEvent } from './describe';
import styles from './HistoryDrawer.module.css';

const PAGE = 40;

const KIND_LABEL: Record<VersionKind, string> = {
  manual: 'Salva manualmente',
  auto: 'Automática',
  restore: 'Antes de restauração',
};

interface HistoryDrawerProps {
  projectId: string;
  canEdit: boolean;
  /** Muda a cada alteração do projeto; usado para manter o painel atualizado. */
  revision: number;
  onClose: () => void;
  /** Chamado depois de restaurar uma versão, para recarregar o canvas. */
  onRestored: () => void;
}

/** Painel de histórico: quem alterou o quê e quando, e versões restauráveis. */
export function HistoryDrawer({ projectId, canEdit, revision, onClose, onRestored }: HistoryDrawerProps) {
  const [tab, setTab] = useState<'activity' | 'versions'>('activity');

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Histórico"
      description="Alterações registradas e versões que podem ser restauradas."
      variant="drawer"
    >
      <div className={styles.tabs}>
        <Segmented
          label="Seções do histórico"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'activity', label: 'Atividade', icon: <Clock size={14} aria-hidden /> },
            { value: 'versions', label: 'Versões', icon: <History size={14} aria-hidden /> },
          ]}
        />
      </div>
      {tab === 'activity' ? (
        <Activity projectId={projectId} revision={revision} />
      ) : (
        <Versions projectId={projectId} canEdit={canEdit} revision={revision} onRestored={onRestored} />
      )}
    </Dialog>
  );
}

function Activity({ projectId, revision }: { projectId: string; revision: number }) {
  const repository = useRepository();
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaded = useRef(PAGE);

  const load = useCallback(async () => {
    try {
      const result = await repository.listEvents(projectId, { limit: loaded.current + 1 });
      setHasMore(result.length > loaded.current);
      setEvents(result.slice(0, loaded.current));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [repository, projectId]);

  // Recarrega pouco depois de cada alteração, sem disparar a cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => void load(), events === null ? 0 : 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, revision]);

  async function more() {
    setLoadingMore(true);
    loaded.current += PAGE;
    await load();
    setLoadingMore(false);
  }

  if (error && !events) {
    return <EmptyState compact title="Não foi possível carregar o histórico" description={error} action={<Button onClick={() => void load()}>Tentar novamente</Button>} />;
  }
  if (!events) {
    return (
      <div className={styles.loading} aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={styles.loadingRow}>
            <Skeleton width={28} height={28} radius="50%" />
            <div>
              <Skeleton width="80%" />
              <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (events.length === 0) {
    return <EmptyState compact icon={<Clock size={24} aria-hidden />} title="Sem atividade registrada" description="As alterações do projeto aparecerão aqui." />;
  }

  const groups: Array<{ day: string; items: HistoryEvent[] }> = [];
  for (const event of events) {
    const day = formatDayLabel(event.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(event);
    else groups.push({ day, items: [event] });
  }

  return (
    <div className={styles.activity}>
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className={styles.day}>{group.day}</h3>
          <ol className={styles.events}>
            {group.items.map((event) => {
              const description = describeEvent(event);
              const actor = event.actor ?? { id: 'sistema', name: 'Alguém' };
              return (
                <li key={event.id} className={styles.event}>
                  <Avatar person={actor} size={28} />
                  <div className={styles.eventBody}>
                    <p>
                      <strong>{actor.name}</strong> {description.action}
                    </p>
                    {description.changes.map((change, index) => (
                      <div key={index} className={styles.change}>
                        {change.label && <span className={styles.changeLabel}>{change.label}</span>}
                        {change.before !== undefined && <del>{change.before}</del>}
                        {change.after !== undefined && <ins>{change.after}</ins>}
                      </div>
                    ))}
                    <time dateTime={event.at} title={formatDateTime(event.at)}>
                      {formatTime(event.at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {hasMore && (
        <Button variant="ghost" block onClick={() => void more()} loading={loadingMore}>
          Carregar alterações anteriores
        </Button>
      )}
    </div>
  );
}

function Versions({
  projectId,
  canEdit,
  revision,
  onRestored,
}: {
  projectId: string;
  canEdit: boolean;
  revision: number;
  onRestored: () => void;
}) {
  const repository = useRepository();
  const toast = useToast();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<VersionSummary | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      setVersions(await repository.listVersions(projectId));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [repository, projectId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), versions === null ? 0 : 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, revision]);

  async function save() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await repository.createVersion(projectId, label);
      setLabel('');
      toast({ message: 'Versão salva.', tone: 'success' });
      await load();
    } catch (cause) {
      toast({ message: errorMessage(cause), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (!restoring) return;
    setWorking(true);
    try {
      await repository.restoreVersion(restoring.id);
      toast({ message: `Versão "${restoring.label}" restaurada.`, tone: 'success' });
      setRestoring(null);
      onRestored();
      await load();
    } catch (cause) {
      toast({ message: errorMessage(cause), tone: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.versions}>
      {canEdit && (
        <form
          className={styles.saveForm}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="versao-nome" className={styles.saveLabel}>
            Salvar o estado atual como versão
          </label>
          <div className={styles.saveRow}>
            <Input
              id="versao-nome"
              value={label}
              maxLength={LIMITS.versionLabel}
              placeholder="Ex.: Após o workshop de ideação"
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button type="submit" variant="primary" icon={<Save size={16} aria-hidden />} loading={saving} disabled={!label.trim()}>
              Salvar
            </Button>
          </div>
          <p className={styles.hint}>
            Além das versões que você salvar, uma versão automática é guardada antes da primeira alteração de cada dia.
          </p>
        </form>
      )}

      {error && !versions ? (
        <EmptyState compact title="Não foi possível carregar as versões" description={error} action={<Button onClick={() => void load()}>Tentar novamente</Button>} />
      ) : !versions ? (
        <div className={styles.loading} aria-busy="true">
          <Skeleton height={64} radius={10} />
          <Skeleton height={64} radius={10} />
        </div>
      ) : versions.length === 0 ? (
        <EmptyState
          compact
          icon={<History size={24} aria-hidden />}
          title="Nenhuma versão salva"
          description="Salve uma versão em marcos importantes para poder voltar a ela depois."
        />
      ) : (
        <ul className={styles.versionList}>
          {versions.map((version) => (
            <li key={version.id} className={styles.version}>
              <div className={styles.versionBody}>
                <p className={styles.versionLabel}>{version.label}</p>
                <p className={styles.versionMeta}>
                  {formatDateTime(version.createdAt)}
                  {version.createdBy && ` · ${version.createdBy.name}`} · {version.noteCount}{' '}
                  {version.noteCount === 1 ? 'nota' : 'notas'}
                </p>
                <Badge tone={version.kind === 'manual' ? 'primary' : 'neutral'}>{KIND_LABEL[version.kind]}</Badge>
              </div>
              {canEdit && (
                <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => setRestoring(version)}>
                  Restaurar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="Restaurar esta versão?"
        description={
          <>
            As notas do canvas voltarão ao estado de <strong>{restoring?.label}</strong>
            {restoring && ` (${formatDateTime(restoring.createdAt)})`}. O estado atual será guardado como uma nova
            versão, de modo que a restauração também pode ser desfeita.
          </>
        }
        confirmLabel="Restaurar versão"
        loading={working}
        onConfirm={() => void restore()}
      />
    </div>
  );
}
