import { Link } from 'react-router';
import { Archive, ArchiveRestore, Copy, LogOut, MoreHorizontal, PencilLine, Trash2, Users } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Feedback';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { MiniCanvas } from '@/components/MiniCanvas';
import { filledBlocks, progressPercent } from '@/domain/progress';
import { ROLE_LABEL, STATUS_LABEL, canEdit, canManage, type ProjectStatus, type ProjectSummary } from '@/domain/types';
import { formatRelative } from '@/lib/dates';
import { BLOCKS } from '@/methodology/agitar';
import styles from './ProjectCard.module.css';

export const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'primary',
  done: 'success',
};

export type ProjectAction = 'edit' | 'duplicate' | 'archive' | 'unarchive' | 'delete' | 'leave';

interface ProjectCardProps {
  project: ProjectSummary;
  canShare: boolean;
  onAction: (action: ProjectAction, project: ProjectSummary) => void;
}

export function ProjectCard({ project, canShare, onAction }: ProjectCardProps) {
  const filled = filledBlocks(project.noteCounts);
  const archived = project.archivedAt !== null;

  const items: MenuItem[] = [];
  if (canEdit(project.role) && !archived) {
    items.push({ label: 'Editar dados', icon: <PencilLine size={16} aria-hidden />, onSelect: () => onAction('edit', project) });
  }
  items.push({ label: 'Duplicar', icon: <Copy size={16} aria-hidden />, onSelect: () => onAction('duplicate', project) });
  if (canManage(project.role)) {
    items.push(
      archived
        ? { label: 'Desarquivar', icon: <ArchiveRestore size={16} aria-hidden />, onSelect: () => onAction('unarchive', project) }
        : { label: 'Arquivar', icon: <Archive size={16} aria-hidden />, onSelect: () => onAction('archive', project) },
      { type: 'separator' },
      { label: 'Excluir', icon: <Trash2 size={16} aria-hidden />, danger: true, onSelect: () => onAction('delete', project) },
    );
  } else if (canShare) {
    items.push(
      { type: 'separator' },
      { label: 'Sair do projeto', icon: <LogOut size={16} aria-hidden />, danger: true, onSelect: () => onAction('leave', project) },
    );
  }

  return (
    <article className={styles.card} data-archived={archived || undefined}>
      <Link to={`/projetos/${project.id}`} className={styles.link} aria-label={`Abrir ${project.name}`}>
        <div className={styles.preview}>
          <MiniCanvas counts={project.noteCounts} />
        </div>

        <div className={styles.body}>
          <div className={styles.badges}>
            {archived ? <Badge tone="warning">Arquivado</Badge> : <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>}
            {project.role !== 'owner' && <Badge>{ROLE_LABEL[project.role]}</Badge>}
          </div>
          <h2 className={styles.name}>{project.name}</h2>
          {project.organization && <p className={styles.organization}>{project.organization}</p>}
          {project.description && <p className={styles.description}>{project.description}</p>}
        </div>

        <div className={styles.progress}>
          <div className={styles.progressLabel}>
            <span>
              {filled} de {BLOCKS.length} blocos preenchidos
            </span>
            <span>{progressPercent(project.noteCounts)}%</span>
          </div>
          <ProgressBar value={progressPercent(project.noteCounts)} label="Progresso do preenchimento" />
        </div>
      </Link>

      <footer className={styles.footer}>
        <span className={styles.meta} title={new Date(project.updatedAt).toLocaleString('pt-BR')}>
          Atualizado {formatRelative(project.updatedAt)}
        </span>
        {project.memberCount > 1 && (
          <span className={styles.meta} title={`${project.memberCount} pessoas com acesso`}>
            <Users size={14} aria-hidden /> {project.memberCount}
          </span>
        )}
        <Menu
          trigger={
            <IconButton label={`Ações do projeto ${project.name}`} size="sm">
              <MoreHorizontal size={18} aria-hidden />
            </IconButton>
          }
          items={items}
        />
      </footer>
    </article>
  );
}
