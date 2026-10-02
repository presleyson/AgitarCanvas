import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CloudOff,
  History,
  LayoutDashboard,
  ListOrdered,
  Lock,
  MoreHorizontal,
  PencilLine,
  SearchX,
  Settings2,
  Share2,
  TriangleAlert,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Banner, EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Menu } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';
import { MiniCanvas } from '@/components/MiniCanvas';
import { countByBlock } from '@/domain/progress';
import { ROLE_LABEL, STATUS_LABEL, canEdit, canManage, type Note, type Person, type ProjectInput } from '@/domain/types';
import { errorMessage } from '@/lib/errors';
import { readJson, writeJson } from '@/lib/storage';
import { AppFooter } from '@/layout/AppShell';
import { BLOCKS, getBlock, type BlockId } from '@/methodology/agitar';
import { useProjectSession } from '@/state/useProjectSession';
import { ExportMenu } from '../export/ExportMenu';
import { HistoryDrawer } from '../history/HistoryDrawer';
import { STATUS_TONE } from '../projects/ProjectCard';
import { ProjectFormDialog } from '../projects/ProjectFormDialog';
import { ShareDialog } from '../sharing/ShareDialog';
import { BlockGuide } from './BlockGuide';
import { CanvasBoard } from './CanvasBoard';
import { SaveIndicator } from './SaveIndicator';
import { StepsView } from './StepsView';
import { WorkspaceProvider, type WorkspaceValue } from './WorkspaceContext';
import styles from './WorkspacePage.module.css';

type View = 'canvas' | 'steps';

const VIEW_KEY = 'agitar.view';

function emptyGroups(): Record<BlockId, Note[]> {
  return Object.fromEntries(BLOCKS.map((block) => [block.id, [] as Note[]])) as Record<BlockId, Note[]>;
}

/** Área de trabalho de um projeto: o canvas, seu preenchimento e as ações do projeto. */
export function WorkspacePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const notify = useCallback(
    (notice: { level: 'error' | 'info'; message: string }) =>
      toast({ message: notice.message, tone: notice.level === 'error' ? 'error' : 'info' }),
    [toast],
  );
  const { session, snapshot } = useProjectSession(projectId, notify);
  const { project, notes, readOnly } = snapshot;

  const [view, setView] = useState<View>(() => readJson<View>(VIEW_KEY, 'canvas'));
  const [activeStep, setActiveStep] = useState<BlockId>('planejamento');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  /** Notas criadas nesta tela que ainda não receberam texto. */
  const createdBlank = useRef(new Set<string>());
  /** Texto de cada nota no momento em que a edição começou. */
  const textBeforeEdit = useRef(new Map<string, string>());
  const [guide, setGuide] = useState<BlockId | null>(null);
  const [dialog, setDialog] = useState<'info' | 'share' | 'history' | null>(null);

  useEffect(() => {
    if (project) document.title = `${project.name} · AGITAR Canvas`;
    return () => {
      document.title = 'AGITAR Canvas';
    };
  }, [project]);

  const changeView = (next: View) => {
    setView(next);
    writeJson(VIEW_KEY, next);
  };

  const notesByBlock = useMemo(() => {
    const groups = emptyGroups();
    for (const note of notes) groups[note.block]?.push(note);
    return groups;
  }, [notes]);

  const openBlocks = useMemo(
    () => new Set(BLOCKS.filter((block) => notesByBlock[block.id].length < block.limit).map((block) => block.id)),
    [notesByBlock],
  );

  const workspace = useMemo<WorkspaceValue>(
    () => ({
      notesByBlock,
      conflicts: snapshot.conflicts,
      presence: snapshot.presence,
      readOnly,
      editingNoteId,
      openBlocks,
      openGuide: setGuide,
      addNote: (block) => {
        const id = session?.addNote(block);
        if (id) {
          createdBlank.current.add(id);
          textBeforeEdit.current.clear();
          setEditingNoteId(id);
          session?.setActivity({ editingNoteId: id, block });
        }
      },
      startEdit: (note) => {
        // Só a nota em edição tem texto anterior guardado.
        if (editingNoteId !== note.id) {
          textBeforeEdit.current.clear();
          textBeforeEdit.current.set(note.id, note.content);
        }
        setEditingNoteId(note.id);
        session?.setActivity({ editingNoteId: note.id, block: note.block });
      },
      stopEdit: (note, finalContent) => {
        // A janela perdeu o foco (troca de aba ou de aplicativo): a edição
        // continua de onde parou quando a pessoa voltar. O que já foi digitado
        // é gravado, mas nada é descartado.
        if (!document.hasFocus()) {
          void session?.flushNow();
          return;
        }

        setEditingNoteId((current) => (current === note.id ? null : current));
        session?.setActivity({ editingNoteId: null, block: note.block });
        const before = textBeforeEdit.current.get(note.id);
        textBeforeEdit.current.delete(note.id);

        if (finalContent.trim() !== '') {
          createdBlank.current.delete(note.id);
        } else if (createdBlank.current.delete(note.id)) {
          // Nota criada agora, que nunca recebeu texto: descartada sem aviso.
          session?.deleteNote(note.id);
        } else {
          // Nota que já tinha texto e foi esvaziada: excluída, com a opção de
          // desfazer. Desfazer devolve o texto que havia antes da edição.
          if (before !== undefined && before.trim() !== '') session?.editNote(note.id, before);
          const undo = session?.deleteNote(note.id);
          if (undo) {
            toast({
              message: `Nota em branco excluída de ${getBlock(note.block).title}.`,
              action: { label: 'Desfazer', onClick: undo },
            });
          }
        }
        // Ao concluir a edição, grava de imediato em vez de aguardar a pausa de digitação.
        void session?.flushNow();
      },
      changeNote: (noteId, content) => session?.editNote(noteId, content),
      deleteNote: (note) => {
        const undo = session?.deleteNote(note.id);
        if (undo) {
          toast({
            message: `Nota excluída de ${getBlock(note.block).title}.`,
            action: { label: 'Desfazer', onClick: undo },
          });
        }
      },
      moveNote: (noteId, block) => {
        if (session?.moveNote(noteId, block)) {
          toast({ message: `Nota movida para ${getBlock(block).title}.`, tone: 'success' });
        }
      },
      reorderNote: (noteId, direction) => session?.reorderNote(noteId, direction),
      resolveConflict: (noteId, choice) => session?.resolveConflict(noteId, choice),
    }),
    [notesByBlock, snapshot.conflicts, snapshot.presence, readOnly, editingNoteId, openBlocks, session, toast],
  );

  // ---------------------------------------------------------------------------
  // Estados de carregamento e erro
  // ---------------------------------------------------------------------------

  if (snapshot.phase === 'loading') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.bar}>
            <Skeleton width={36} height={36} radius={8} />
            <div className={styles.titleBlock}>
              <Skeleton width={220} height={20} />
            </div>
          </div>
        </header>
        <div className={styles.loadingBoard} aria-busy="true" aria-label="Carregando o canvas">
          {BLOCKS.map((block) => (
            <Skeleton key={block.id} height="100%" radius={10} style={{ minHeight: 120 }} />
          ))}
        </div>
      </div>
    );
  }

  if (snapshot.phase === 'not_found' || !project) {
    const failed = snapshot.phase === 'error';
    return (
      <div className={styles.page}>
        <EmptyState
          icon={failed ? <CloudOff size={26} aria-hidden /> : <SearchX size={26} aria-hidden />}
          title={failed ? 'Não foi possível abrir o projeto' : 'Projeto não encontrado'}
          description={
            failed
              ? snapshot.error
              : 'O projeto foi excluído ou você não tem mais acesso a ele. Se recebeu um convite, confira se entrou com a conta correta.'
          }
          action={
            failed ? (
              <Button variant="primary" onClick={() => window.location.reload()}>
                Tentar novamente
              </Button>
            ) : (
              <Link to="/projetos">Voltar para Meus Projetos</Link>
            )
          }
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Projeto carregado
  // ---------------------------------------------------------------------------

  const archived = project.archivedAt !== null;
  const editor = canEdit(project.role);
  const owner = canManage(project.role);
  const counts = countByBlock(notes);
  const conflictCount = Object.keys(snapshot.conflicts).length;

  const people = new Map<string, Person>();
  for (const entry of snapshot.presence) people.set(entry.user.id + entry.connectionId, entry.user);
  const others = [...people.values()];

  const saveIndicator = (
    <SaveIndicator
      save={snapshot.save}
      readOnly={readOnly}
      readOnlyReason={archived ? 'Projeto arquivado' : 'Seu papel neste projeto é de visualizador'}
      onRetry={() => void session?.flushNow()}
    />
  );

  async function saveInfo(input: ProjectInput) {
    await session?.updateProject(input);
    toast({ message: 'Dados do projeto atualizados.', tone: 'success' });
  }

  async function toggleArchive() {
    try {
      await session?.setArchived(!archived);
      toast({ message: archived ? 'Projeto desarquivado.' : 'Projeto arquivado.', tone: 'success' });
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    }
  }

  function goToBlock(block: BlockId) {
    if (view === 'steps') {
      setActiveStep(block);
      return;
    }
    document.getElementById(`bloco-${block}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <WorkspaceProvider value={workspace}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.bar}>
            <IconButton label="Voltar para Meus Projetos" onClick={() => navigate('/projetos')}>
              <ArrowLeft size={18} aria-hidden />
            </IconButton>

            <div className={styles.titleBlock}>
              <h1 className={styles.title} title={project.name}>
                {project.name}
              </h1>
              <p className={styles.subtitle}>
                {archived ? (
                  <Badge tone="warning">Arquivado</Badge>
                ) : (
                  <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
                )}
                {project.organization && <span className={styles.organization}>{project.organization}</span>}
                {project.role !== 'owner' && <span className={styles.role}>{ROLE_LABEL[project.role]}</span>}
              </p>
            </div>

            <span className={styles.saveWide}>{saveIndicator}</span>

            {others.length > 0 && (
              <div className={styles.presence} aria-label={`${others.length} ${others.length === 1 ? 'pessoa conectada' : 'pessoas conectadas'}`}>
                {others.slice(0, 4).map((person, index) => (
                  <Avatar key={index} person={person} size={28} title={`${person.name} está no projeto`} />
                ))}
                {others.length > 4 && <span className={styles.more}>+{others.length - 4}</span>}
              </div>
            )}

            <div className={styles.actions}>
              <span className={styles.wide}>
                <Button icon={<Share2 size={16} aria-hidden />} onClick={() => setDialog('share')}>
                  Compartilhar
                </Button>
              </span>
              <span className={styles.wide}>
                <ExportMenu project={project} notes={notes} />
              </span>
              <span className={styles.wide}>
                <IconButton label="Histórico" onClick={() => setDialog('history')}>
                  <History size={18} aria-hidden />
                </IconButton>
              </span>
              <span className={styles.narrow}>
                <ExportMenu project={project} notes={notes} compact />
              </span>
              <Menu
                trigger={
                  <IconButton label="Mais ações do projeto">
                    <MoreHorizontal size={18} aria-hidden />
                  </IconButton>
                }
                items={[
                  {
                    label: editor && !archived ? 'Dados do projeto' : 'Ver dados do projeto',
                    icon: editor && !archived ? <PencilLine size={16} aria-hidden /> : <Settings2 size={16} aria-hidden />,
                    onSelect: () => setDialog('info'),
                  },
                  { label: 'Compartilhar', icon: <Share2 size={16} aria-hidden />, onSelect: () => setDialog('share') },
                  { label: 'Histórico e versões', icon: <History size={16} aria-hidden />, onSelect: () => setDialog('history') },
                  ...(owner
                    ? [
                        { type: 'separator' as const },
                        archived
                          ? { label: 'Desarquivar', icon: <ArchiveRestore size={16} aria-hidden />, onSelect: () => void toggleArchive() }
                          : { label: 'Arquivar', icon: <Archive size={16} aria-hidden />, onSelect: () => void toggleArchive() },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>

          <div className={styles.subbar}>
            <Segmented<View>
              label="Modo de visualização"
              value={view}
              onChange={changeView}
              options={[
                { value: 'canvas', label: 'Canvas', icon: <LayoutDashboard size={14} aria-hidden /> },
                { value: 'steps', label: 'Etapas', icon: <ListOrdered size={14} aria-hidden /> },
              ]}
            />
            <span className={styles.progress}>
              {BLOCKS.filter((block) => (counts[block.id] ?? 0) > 0).length} de {BLOCKS.length} blocos preenchidos
            </span>
            <span className={styles.saveNarrow}>{saveIndicator}</span>
          </div>
        </header>

        <div className={styles.banners}>
          {snapshot.stale && (
            <Banner tone="warning" icon={<CloudOff size={18} aria-hidden />}>
              Sem conexão. Você está vendo a última cópia guardada neste dispositivo; as alterações serão enviadas quando
              a conexão voltar.
            </Banner>
          )}
          {archived && (
            <Banner tone="warning" icon={<Lock size={18} aria-hidden />} action={owner ? <Button size="sm" onClick={() => void toggleArchive()}>Desarquivar</Button> : undefined}>
              Este projeto está arquivado e disponível somente para consulta.
            </Banner>
          )}
          {conflictCount > 0 && (
            <Banner tone="danger" icon={<TriangleAlert size={18} aria-hidden />}>
              {conflictCount === 1 ? 'Uma nota foi alterada' : `${conflictCount} notas foram alteradas`} por outra pessoa
              enquanto você editava. Escolha qual versão manter na própria nota.
            </Banner>
          )}
        </div>

        {view === 'canvas' ? (
          <>
            <div className={styles.map}>
              <MiniCanvas counts={counts} detailed onSelect={goToBlock} />
            </div>
            <CanvasBoard />
          </>
        ) : (
          <StepsView active={activeStep} onSelect={setActiveStep} />
        )}

        <AppFooter />
      </div>

      {guide && (
        <Dialog open onOpenChange={(open) => !open && setGuide(null)} title={getBlock(guide).title} size="sm">
          <BlockGuide block={getBlock(guide)} showHeading />
        </Dialog>
      )}

      {dialog === 'info' &&
        (editor && !archived ? (
          <ProjectFormDialog
            mode="edit"
            initial={{
              name: project.name,
              description: project.description,
              organization: project.organization,
              responsible: project.responsible,
              participants: project.participants,
              status: project.status,
            }}
            onClose={() => setDialog(null)}
            onSubmit={saveInfo}
          />
        ) : (
          <Dialog open onOpenChange={(open) => !open && setDialog(null)} title="Dados do projeto" size="sm">
            <dl className={styles.details}>
              <dt>Nome</dt>
              <dd>{project.name}</dd>
              <dt>Organização</dt>
              <dd>{project.organization || 'Não informada'}</dd>
              <dt>Responsável</dt>
              <dd>{project.responsible || 'Não informado'}</dd>
              <dt>Participantes</dt>
              <dd>{project.participants.length > 0 ? project.participants.join(', ') : 'Não informados'}</dd>
              <dt>Descrição</dt>
              <dd>{project.description || 'Sem descrição'}</dd>
              <dt>Status</dt>
              <dd>{STATUS_LABEL[project.status]}</dd>
            </dl>
          </Dialog>
        ))}

      {dialog === 'share' && <ShareDialog project={project} onClose={() => setDialog(null)} />}

      {dialog === 'history' && (
        <HistoryDrawer
          projectId={project.id}
          canEdit={editor && !archived}
          revision={snapshot.revision}
          onClose={() => setDialog(null)}
          onRestored={() => void session?.refresh()}
        />
      )}
    </WorkspaceProvider>
  );
}
