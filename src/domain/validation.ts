import type { ProjectInput, ProjectStatus } from './types';

export const LIMITS = {
  name: 160,
  description: 2000,
  organization: 160,
  responsible: 160,
  participants: 50,
  note: 2000,
  versionLabel: 160,
} as const;

export type ProjectErrors = Partial<Record<keyof ProjectInput, string>>;

export function emptyProjectInput(): ProjectInput {
  return { name: '', description: '', organization: '', responsible: '', participants: [], status: 'draft' };
}

export function normalizeProjectInput(input: ProjectInput): ProjectInput {
  const seen = new Set<string>();
  const participants: string[] = [];
  for (const raw of input.participants) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase('pt-BR');
    if (name && !seen.has(key)) {
      seen.add(key);
      participants.push(name);
    }
  }
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    organization: input.organization.trim(),
    responsible: input.responsible.trim(),
    participants,
    status: input.status,
  };
}

export function validateProjectInput(input: ProjectInput): ProjectErrors {
  const value = normalizeProjectInput(input);
  const errors: ProjectErrors = {};

  if (!value.name) errors.name = 'Informe o nome do projeto.';
  else if (value.name.length > LIMITS.name) errors.name = `Use no máximo ${LIMITS.name} caracteres.`;

  if (value.description.length > LIMITS.description) {
    errors.description = `Use no máximo ${LIMITS.description} caracteres.`;
  }
  if (value.organization.length > LIMITS.organization) {
    errors.organization = `Use no máximo ${LIMITS.organization} caracteres.`;
  }
  if (value.responsible.length > LIMITS.responsible) {
    errors.responsible = `Use no máximo ${LIMITS.responsible} caracteres.`;
  }
  if (value.participants.length > LIMITS.participants) {
    errors.participants = `Informe no máximo ${LIMITS.participants} participantes.`;
  }
  return errors;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const STATUS_ORDER: ProjectStatus[] = ['draft', 'active', 'done'];
