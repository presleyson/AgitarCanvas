/**
 * Acesso tolerante a falhas ao armazenamento do navegador. Em janelas
 * privadas ou com armazenamento bloqueado, as leituras retornam o valor
 * padrão e as escritas são ignoradas.
 */
export function readJson<T>(key: string, fallback: T, storage: Storage | undefined = safeLocalStorage()): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, storage: Storage | undefined = safeLocalStorage()): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, storage: Storage | undefined = safeLocalStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* sem armazenamento disponível */
  }
}

/** Chaves do armazenamento que começam com o prefixo informado. */
export function listKeys(prefix: string, storage: Storage | undefined = safeLocalStorage()): string[] {
  const keys: string[] = [];
  try {
    if (!storage) return keys;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    /* sem armazenamento disponível */
  }
  return keys;
}

export function removeByPrefix(prefix: string, storage: Storage | undefined = safeLocalStorage()): void {
  for (const key of listKeys(prefix, storage)) removeKey(key, storage);
}

/** Alterações ainda não enviadas, por usuário, projeto e sessão de trabalho. */
export const OUTBOX_PREFIX = 'agitar.outbox.';
/** Cópia do último estado conhecido de cada projeto, para leitura sem conexão. */
export const CACHE_PREFIX = 'agitar.cache.';

export function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function safeSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
