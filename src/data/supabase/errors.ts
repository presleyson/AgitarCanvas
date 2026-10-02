import { AppError, type ErrorCode } from '@/lib/errors';

interface ErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  status?: number;
}

const SERVER_MESSAGES: ErrorCode[] = [
  'block_full',
  'project_archived',
  'invalid_email',
  'invalid_role',
  'invalid_link',
  'invalid_label',
  'invalid_expiration',
  'invite_limit',
  'version_limit',
  'owner_cannot_leave',
  'not_found',
  'forbidden',
];

/**
 * Converte erros do Supabase (PostgREST, Auth, rede) em AppError.
 *
 * Falhas transitórias (sem rede, tempo esgotado, servidor indisponível ou
 * sobrecarregado) viram "network": a sessão do projeto mantém a alteração na
 * fila e tenta de novo. Informe o status HTTP da resposta quando disponível.
 */
export function fromSupabase(error: unknown, httpStatus?: number): AppError {
  if (error instanceof AppError) return error;

  const { message = '', code = '', details = '', status = httpStatus } = (error ?? {}) as ErrorLike;
  const text = `${message} ${details ?? ''}`;

  // Sem resposta do servidor, o navegador informando que está sem rede basta.
  // Havendo resposta, vale o que o servidor disse.
  const noResponse = status === undefined || status === 0;

  if (
    /failed to fetch|networkerror|load failed|network request failed|fetch failed|aborterror|aborted|timed out|timeout/i.test(text) ||
    (noResponse && !code && typeof navigator !== 'undefined' && navigator.onLine === false) ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    // Sem conexão com o banco, sem vaga de conexão ou consulta cancelada por tempo.
    /^PGRST00[0-3]$/.test(code) ||
    code === '57014' ||
    code === '53300' ||
    code.startsWith('08')
  ) {
    return new AppError('network');
  }

  for (const known of SERVER_MESSAGES) {
    if (message.includes(known)) return new AppError(known);
  }

  if (message.includes('owner_only') || message.includes('immutable_field')) return new AppError('forbidden');
  if (code === 'PGRST301' || status === 401 || /jwt expired|invalid jwt/i.test(message)) {
    return new AppError('unauthenticated');
  }
  if (code === '42501' || status === 403) return new AppError('forbidden');
  if (code === 'PGRST116') return new AppError('not_found');
  if (code === '23514' || code === '22001') return new AppError('validation');

  return new AppError('unknown', undefined, message || String(error));
}
