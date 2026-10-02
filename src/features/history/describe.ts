import { ROLE_LABEL, STATUS_LABEL, type HistoryEvent, type ProjectStatus, type Role } from '@/domain/types';
import { getBlock, isBlockId } from '@/methodology/agitar';

export interface EventDescription {
  /** Frase que completa "Fulano ...". */
  action: string;
  /** Alterações de conteúdo, para exibição de antes e depois. */
  changes: Array<{ label?: string; before?: string; after?: string }>;
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  description: 'Descrição',
  organization: 'Organização',
  responsible: 'Responsável',
  participants: 'Participantes',
  status: 'Status',
};

function blockTitle(id: unknown): string {
  return isBlockId(id) ? getBlock(id).title : 'bloco removido';
}

function roleLabel(role: unknown): string {
  return ROLE_LABEL[role as Role] ?? 'participante';
}

function fieldValue(field: string, value: unknown): string {
  if (field === 'status') return STATUS_LABEL[value as ProjectStatus] ?? String(value);
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(vazio)';
  const text = value == null ? '' : String(value);
  return text.trim() === '' ? '(vazio)' : text;
}

function text(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Traduz um evento do histórico em uma frase e em suas alterações de conteúdo. */
export function describeEvent(event: HistoryEvent): EventDescription {
  const { kind, before, after, block } = event;

  switch (kind) {
    case 'project_created':
      return { action: 'criou o projeto', changes: [] };
    case 'project_archived':
      return { action: 'arquivou o projeto', changes: [] };
    case 'project_unarchived':
      return { action: 'desarquivou o projeto', changes: [] };
    case 'project_updated': {
      const fields = Object.keys(after ?? {});
      return {
        action: 'alterou os dados do projeto',
        changes: fields.map((field) => ({
          label: FIELD_LABEL[field] ?? field,
          before: fieldValue(field, before?.[field]),
          after: fieldValue(field, after?.[field]),
        })),
      };
    }
    case 'note_created':
      return {
        action: `adicionou uma nota em ${blockTitle(block)}`,
        changes: text(after, 'content') ? [{ after: text(after, 'content') }] : [],
      };
    case 'note_updated':
      return {
        action: `editou uma nota em ${blockTitle(block)}`,
        changes: [{ before: text(before, 'content') || '(em branco)', after: text(after, 'content') || '(em branco)' }],
      };
    case 'note_moved':
      return {
        action: `moveu uma nota de ${blockTitle(before?.block)} para ${blockTitle(after?.block)}`,
        changes: [],
      };
    case 'note_deleted':
      return {
        action: `excluiu uma nota de ${blockTitle(block)}`,
        changes: text(before, 'content') ? [{ before: text(before, 'content') }] : [],
      };
    case 'note_restored':
      return {
        action: `recuperou uma nota em ${blockTitle(block)}`,
        changes: text(after, 'content') ? [{ after: text(after, 'content') }] : [],
      };
    case 'member_added': {
      const role = roleLabel(after?.role).toLocaleLowerCase('pt-BR');
      if (after?.via === 'link') return { action: `entrou no projeto por link, como ${role}`, changes: [] };
      if (after?.via === 'invite') return { action: `aceitou o convite e entrou como ${role}`, changes: [] };
      return { action: `adicionou ${text(after, 'email') ?? 'uma pessoa'} como ${role}`, changes: [] };
    }
    case 'member_role_changed':
      return {
        action: `alterou o papel de ${text(after, 'name') || 'um participante'} para ${roleLabel(after?.role).toLocaleLowerCase('pt-BR')}`,
        changes: [],
      };
    case 'member_removed':
      return before?.left
        ? { action: 'saiu do projeto', changes: [] }
        : { action: `removeu ${text(before, 'name') || 'um participante'} do projeto`, changes: [] };
    case 'version_created':
      return { action: `salvou a versão "${text(after, 'label') ?? ''}"`, changes: [] };
    case 'version_restored':
      return { action: `restaurou a versão "${text(after, 'label') ?? ''}"`, changes: [] };
    default:
      return { action: 'realizou uma alteração', changes: [] };
  }
}
