import { isBlockId, type BlockId } from '@/methodology/agitar';
import type {
  HistoryEvent,
  HistoryKind,
  Invite,
  Member,
  Note,
  Person,
  Project,
  ProjectStatus,
  Role,
  ShareLink,
  VersionKind,
  VersionSummary,
} from '@/domain/types';

/** Formato das linhas devolvidas pelo banco e sua conversão para o domínio. */

export interface ProfileRow {
  id: string;
  full_name: string;
  email?: string | null;
  avatar_url?: string | null;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  organization: string;
  responsible: string;
  participants: string[] | null;
  status: ProjectStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  project_id: string;
  block: string;
  content: string;
  position: number;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EventRow {
  id: number;
  project_id: string;
  actor_id: string | null;
  actor_name: string;
  at: string;
  kind: string;
  block: string | null;
  note_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor?: ProfileRow | null;
}

export interface VersionRow {
  id: string;
  project_id: string;
  label: string;
  kind: VersionKind;
  note_count: number;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  author?: ProfileRow | null;
}

export interface MemberRow {
  role: Role;
  created_at: string;
  user: ProfileRow | null;
}

export interface InviteRow {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  created_at: string;
}

export interface LinkRow {
  id: string;
  token: string;
  role: Exclude<Role, 'owner'>;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export function toPerson(row: ProfileRow): Person {
  return {
    id: row.id,
    name: row.full_name || row.email?.split('@')[0] || 'Participante',
    email: row.email ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
}

export function toProject(row: ProjectRow, role: Role): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    organization: row.organization,
    responsible: row.responsible,
    participants: row.participants ?? [],
    status: row.status,
    archivedAt: row.archived_at,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role,
  };
}

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    block: (isBlockId(row.block) ? row.block : 'planejamento') as BlockId,
    content: row.content,
    position: Number(row.position),
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEvent(row: EventRow): HistoryEvent {
  const actor: Person | null = row.actor
    ? toPerson(row.actor)
    : row.actor_name
      ? { id: row.actor_id ?? `removido-${row.id}`, name: row.actor_name }
      : null;

  return {
    id: String(row.id),
    projectId: row.project_id,
    actor,
    at: row.at,
    kind: row.kind as HistoryKind,
    block: isBlockId(row.block) ? row.block : null,
    noteId: row.note_id,
    before: row.before,
    after: row.after,
  };
}

export function toVersion(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    kind: row.kind,
    createdBy: row.author
      ? toPerson(row.author)
      : row.created_by_name
        ? { id: row.created_by ?? `removido-${row.id}`, name: row.created_by_name }
        : null,
    createdAt: row.created_at,
    noteCount: row.note_count,
  };
}

export function toMember(row: MemberRow): Member | null {
  if (!row.user) return null;
  return { user: toPerson(row.user), role: row.role, joinedAt: row.created_at };
}

export function toInvite(row: InviteRow): Invite {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

export function toLink(row: LinkRow): ShareLink {
  return { id: row.id, token: row.token, role: row.role, createdAt: row.created_at, expiresAt: row.expires_at };
}
