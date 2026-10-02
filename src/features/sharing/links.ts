/** Endereço público de uma rota interna, considerando o caminho base da publicação. */
export function appUrl(route: string): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  return `${base}#${route}`;
}

export function projectUrl(projectId: string): string {
  return appUrl(`/projetos/${projectId}`);
}

export function joinUrl(token: string): string {
  return appUrl(`/entrar/${token}`);
}

/** Copia texto para a área de transferência, com alternativa para contextos sem a API moderna. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}
