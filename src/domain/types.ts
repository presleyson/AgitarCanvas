import type { BlockId } from '@/methodology/agitar';

export type Role = 'owner' | 'editor' | 'viewer';

export type ProjectStatus = 'draft' | 'active' | 'done';

export interface Person {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  organization: string;
  responsible: string;
  participants: string[];
  status: ProjectStatus;
  archivedAt: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Papel do usuário atual neste projeto. */
  role: Role;
}

/** Projeto com dados agregados para a lista "Meus Projetos". */
export interface ProjectSummary extends Project {
  /** Quantidade de notas ativas por bloco. */
  noteCounts: Partial<Record<BlockId, number>>;
  memberCount: number;
  owner: Person | null;
}

export interface ProjectInput {
  name: string;
  description: string;
  organization: string;
  responsible: string;
  participants: string[];
  status: ProjectStatus;
}

export interface Note {
  id: string;
  projectId: string;
  block: BlockId;
  content: string;
  /** Ordenação dentro do bloco (crescente). */
  position: number;
  /** Incrementada pelo servidor a cada gravação. Base do controle de concorrência. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type HistoryKind =
  | 'project_created'
  | 'project_updated'
  | 'project_archived'
  | 'project_unarchived'
  | 'note_created'
  | 'note_updated'
  | 'note_moved'
  | 'note_deleted'
  | 'note_restored'
  | 'member_added'
  | 'member_role_changed'
  | 'member_removed'
  | 'version_created'
  | 'version_restored';

export interface HistoryEvent {
  id: string;
  projectId: string;
  actor: Person | null;
  at: string;
  kind: HistoryKind;
  block: BlockId | null;
  noteId: string | null;
  /** Estado anterior do que foi alterado (campos relevantes). */
  before: Record<string, unknown> | null;
  /** Estado posterior. */
  after: Record<string, unknown> | null;
}

export type VersionKind = 'manual' | 'auto' | 'restore';

export interface VersionSummary {
  id: string;
  projectId: string;
  label: string;
  kind: VersionKind;
  createdBy: Person | null;
  createdAt: string;
  noteCount: number;
}

export interface Member {
  user: Person;
  role: Role;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  token: string;
  role: Exclude<Role, 'owner'>;
  createdAt: string;
  expiresAt: string | null;
}

/** Estado de presença de um participante conectado ao projeto. */
export interface PresenceState {
  /** Identificador da conexão (uma pessoa pode ter mais de uma aba aberta). */
  connectionId: string;
  user: Person;
  /** Nota em edição no momento, se houver. */
  editingNoteId: string | null;
  /** Bloco em foco no momento, se houver. */
  block: BlockId | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Proprietário',
  editor: 'Editor',
  viewer: 'Visualizador',
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Rascunho',
  active: 'Em andamento',
  done: 'Concluído',
};

export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

export function canManage(role: Role): boolean {
  return role === 'owner';
}
