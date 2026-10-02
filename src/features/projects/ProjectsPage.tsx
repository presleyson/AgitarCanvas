import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderOpen, HardDrive, Plus, Search, SearchX, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Banner, EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';
import type { ProjectInput, ProjectSummary } from '@/domain/types';
import { errorMessage } from '@/lib/errors';
import { AppShell } from '@/layout/AppShell';
import { ReceivedInvites } from '@/features/sharing/ReceivedInvites';
import { useRepository } from '@/state/RepositoryContext';
import { ProjectCard, type ProjectAction } from './ProjectCard';
import { ProjectFormDialog } from './ProjectFormDialog';
import styles from './ProjectsPage.module.css';

type Filter = 'active' | 'archived';
type Sort = 'updated' | 'name' | 'created';

const SORTERS: Record<Sort, (a: ProjectSummary, b: ProjectSummary) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR');
}

type Pending = { action: 'delete' | 'leave' | 'archive'; project: ProjectSummary } | null;

/** Lista os planejamentos do usuário e concentra as ações sobre eles. */
export function ProjectsPage() {
  const repository = useRepository();
  const navigate = useNavigate();
  const toast = useToast();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<Sort>('updated');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProjects(await repository.listProjects());
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [repository]);

  useEffect(() => {
    void load();
    // Ao voltar para a aba, a lista reflete mudanças feitas em outros dispositivos.
    const onFocus = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  const counts = useMemo(
    () => ({
      active: projects?.filter((project) => !project.archivedAt).length ?? 0,
      archived: projects?.filter((project) => project.archivedAt).length ?? 0,
    }),
    [projects],
  );

  const visible = useMemo(() => {
    if (!projects) return [];
    const term = normalize(query.trim());
    return projects
      .filter((project) => (filter === 'archived' ? project.archivedAt !== null : project.archivedAt === null))
      .filter(
        (project) =>
          !term ||
          [project.name, project.organization, project.responsible, project.description].some((field) =>
            normalize(field).includes(term),
          ),
      )
      .sort(SORTERS[sort]);
  }, [projects, query, filter, sort]);

  async function create(input: ProjectInput) {
    const project = await repository.createProject(input);
    navigate(`/projetos/${project.id}`);
  }

  async function update(input: ProjectInput) {
    if (!editing) return;
    await repository.updateProject(editing.id, input);
    toast({ message: 'Dados do projeto atualizados.', tone: 'success' });
    await load();
  }

  async function run(task: () => Promise<void>, success: string) {
    setWorking(true);
    try {
      await task();
      toast({ message: success, tone: 'success' });
      setPending(null);
      await load();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setWorking(false);
    }
  }

  function onAction(action: ProjectAction, project: ProjectSummary) {
    switch (action) {
      case 'edit':
        setEditing(project);
        break;
      case 'duplicate':
        void run(async () => {
          await repository.duplicateProject(project.id);
        }, `Cópia de "${project.name}" criada.`);
        break;
      case 'unarchive':
        void run(async () => {
          await repository.setArchived(project.id, false);
        }, 'Projeto desarquivado.');
        break;
      case 'archive':
      case 'delete':
      case 'leave':
        setPending({ action, project });
        break;
    }
  }

  const hasProjects = (projects?.length ?? 0) > 0;

  return (
    <AppShell>
      <div className={styles.heading}>
        <div>
          <h1>Meus Projetos</h1>
          <p className={styles.subtitle}>Planejamentos de inovação que você criou ou que foram compartilhados com você.</p>
        </div>
        <Button variant="primary" icon={<Plus size={18} aria-hidden />} onClick={() => setCreating(true)}>
          Novo projeto
        </Button>
      </div>

      {repository.mode === 'local' && (
        <div className={styles.banner}>
          <Banner icon={<HardDrive size={18} aria-hidden />}>
            <strong>Modo local.</strong> Os projetos ficam salvos apenas neste navegador. Contas, colaboração e
            sincronização entre dispositivos ficam disponíveis quando a plataforma é conectada ao servidor.
          </Banner>
        </div>
      )}

      <ReceivedInvites onAccepted={() => void load()} />

      {hasProjects && (
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} aria-hidden />
            <span className="sr-only">Pesquisar projetos</span>
            <input
              type="search"
              placeholder="Pesquisar por nome, organização ou responsável"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Segmented<Filter>
            label="Situação dos projetos"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Ativos', count: counts.active },
              { value: 'archived', label: 'Arquivados', count: counts.archived },
            ]}
          />
          <label className={styles.sort}>
            <span className="sr-only">Ordenar por</span>
            <Select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="updated">Atualização mais recente</option>
              <option value="created">Criação mais recente</option>
              <option value="name">Nome (A a Z)</option>
            </Select>
          </label>
        </div>
      )}

      {loadError ? (
        <EmptyState
          icon={<WifiOff size={26} aria-hidden />}
          title="Não foi possível carregar os projetos"
          description={loadError}
          action={<Button onClick={() => void load()}>Tentar novamente</Button>}
        />
      ) : projects === null ? (
        <div className={styles.grid} aria-busy="true" aria-label="Carregando projetos">
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeleton}>
              <Skeleton height={92} radius={10} />
              <Skeleton width="35%" height={18} radius={999} />
              <Skeleton width="80%" height={22} />
              <Skeleton width="55%" />
              <Skeleton height={6} radius={999} style={{ marginTop: 12 }} />
            </div>
          ))}
        </div>
      ) : !hasProjects ? (
        <EmptyState
          icon={<FolderOpen size={26} aria-hidden />}
          title="Comece seu primeiro planejamento"
          description="Crie um projeto para registrar as nove dimensões do AGITAR Canvas. Tudo o que você preencher é salvo automaticamente."
          action={
            <Button variant="primary" icon={<Plus size={18} aria-hidden />} onClick={() => setCreating(true)}>
              Novo projeto
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={<SearchX size={26} aria-hidden />}
          title={query ? 'Nenhum projeto encontrado' : filter === 'archived' ? 'Nenhum projeto arquivado' : 'Nenhum projeto ativo'}
          description={
            query
              ? `Não há projetos ${filter === 'archived' ? 'arquivados' : 'ativos'} correspondentes a "${query}".`
              : filter === 'archived'
                ? 'Projetos arquivados saem da lista principal e ficam somente para consulta.'
                : 'Todos os seus projetos estão arquivados.'
          }
          action={query ? <Button onClick={() => setQuery('')}>Limpar pesquisa</Button> : undefined}
        />
      ) : (
        <div className={styles.grid}>
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} canShare={repository.sharing !== null} onAction={onAction} />
          ))}
        </div>
      )}

      {creating && <ProjectFormDialog mode="create" onClose={() => setCreating(false)} onSubmit={create} />}
      {editing && (
        <ProjectFormDialog
          mode="edit"
          initial={{
            name: editing.name,
            description: editing.description,
            organization: editing.organization,
            responsible: editing.responsible,
            participants: editing.participants,
            status: editing.status,
          }}
          onClose={() => setEditing(null)}
          onSubmit={update}
        />
      )}

      <ConfirmDialog
        open={pending?.action === 'archive'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Arquivar projeto?"
        description={
          <>
            <strong>{pending?.project.name}</strong> sairá da lista de projetos ativos e ficará somente para consulta.
            Você pode desarquivar quando quiser.
          </>
        }
        confirmLabel="Arquivar"
        loading={working}
        onConfirm={() => pending && void run(async () => void (await repository.setArchived(pending.project.id, true)), 'Projeto arquivado.')}
      />
      <ConfirmDialog
        open={pending?.action === 'delete'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Excluir projeto?"
        description={
          <>
            <strong>{pending?.project.name}</strong> será excluído definitivamente, com todas as notas, o histórico e as
            versões. Esta ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir definitivamente"
        tone="danger"
        loading={working}
        onConfirm={() => pending && void run(() => repository.deleteProject(pending.project.id), 'Projeto excluído.')}
      />
      <ConfirmDialog
        open={pending?.action === 'leave'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Sair do projeto?"
        description={
          <>
            Você deixará de ter acesso a <strong>{pending?.project.name}</strong>. Para voltar, o proprietário precisará
            convidar você novamente.
          </>
        }
        confirmLabel="Sair do projeto"
        tone="danger"
        loading={working}
        onConfirm={() =>
          pending && repository.sharing && void run(() => repository.sharing!.leave(pending.project.id), 'Você saiu do projeto.')
        }
      />
    </AppShell>
  );
}
