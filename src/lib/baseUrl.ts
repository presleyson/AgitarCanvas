/**
 * Endereço em que a aplicação está publicada, sem rota interna, parâmetros ou
 * âncora. O caminho base pode ser absoluto ("/app/") ou relativo ("./"); por
 * isso é resolvido a partir do endereço do documento, e não apenas da origem.
 */
export function appBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.href).toString();
}
