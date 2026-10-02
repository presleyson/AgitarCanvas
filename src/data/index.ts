import { createClient } from '@supabase/supabase-js';
import { appBaseUrl } from '@/lib/baseUrl';
import { LocalRepository } from './local/LocalRepository';
import type { Repository } from './repository';
import { SupabaseRepository } from './supabase/SupabaseRepository';

/**
 * Escolhe a origem dos dados pela configuração de ambiente.
 *
 * Com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY definidos, a aplicação usa o
 * Supabase (contas, colaboração, sincronização entre dispositivos). Sem eles,
 * funciona em modo local, com dados apenas neste navegador.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Requisição com tempo limite. Sem ele, uma conexão que para de responder
 * deixaria uma gravação pendente para sempre; com ele, a falha vira erro de
 * rede e a alteração volta para a fila de envio.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), REQUEST_TIMEOUT_MS);

  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function createRepository(): Repository {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (url && anonKey) {
    const client = createClient(url, anonKey, {
      global: { fetch: fetchWithTimeout },
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    const redirectUrl = appBaseUrl();
    return new SupabaseRepository(client, redirectUrl);
  }

  return new LocalRepository();
}
