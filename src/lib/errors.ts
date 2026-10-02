/** Códigos de erro estáveis, compartilhados entre repositórios e interface. */
export type ErrorCode =
  | 'network'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated'
  | 'block_full'
  | 'project_archived'
  | 'invalid_email'
  | 'invalid_role'
  | 'invalid_link'
  | 'invalid_label'
  | 'invalid_expiration'
  | 'invite_limit'
  | 'version_limit'
  | 'owner_cannot_leave'
  | 'validation'
  | 'unknown';

const MESSAGES: Record<ErrorCode, string> = {
  network: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
  not_found: 'Não encontramos o que você procura. O item pode ter sido removido.',
  forbidden: 'Você não tem permissão para realizar esta ação.',
  unauthenticated: 'Sua sessão expirou. Entre novamente para continuar.',
  block_full: 'Este bloco atingiu o limite de notas.',
  project_archived: 'Este projeto está arquivado. Desarquive para voltar a editar.',
  invalid_email: 'Informe um email válido.',
  invalid_role: 'Papel de acesso inválido.',
  invalid_link: 'Este link de acesso não é válido ou expirou.',
  invalid_label: 'Informe um nome para a versão.',
  invalid_expiration: 'Escolha uma validade entre 1 e 365 dias.',
  invite_limit: 'Este projeto atingiu o limite de convites pendentes. Cancele convites antigos para criar novos.',
  version_limit: 'Este projeto atingiu o limite de versões salvas.',
  owner_cannot_leave: 'O proprietário não pode sair do projeto.',
  validation: 'Revise os dados informados.',
  unknown: 'Algo deu errado. Tente novamente em instantes.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return new AppError('network');
  }
  return new AppError('unknown', undefined, error instanceof Error ? error.message : String(error));
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
