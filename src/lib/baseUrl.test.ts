import { afterEach, describe, expect, it, vi } from 'vitest';
import { appBaseUrl } from './baseUrl';
import { joinUrl, projectUrl } from '@/features/sharing/links';

function visit(path: string) {
  window.history.replaceState(null, '', path);
}

describe('appBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    visit('/');
  });

  it('mantém o subdiretório da publicação quando o caminho base é relativo', () => {
    vi.stubEnv('BASE_URL', './');
    visit('/agitarcanvas/');
    expect(appBaseUrl()).toBe(`${window.location.origin}/agitarcanvas/`);
  });

  it('descarta rota interna, parâmetros e arquivo de entrada', () => {
    vi.stubEnv('BASE_URL', './');
    visit('/agitarcanvas/index.html?code=abc#/projetos/123');
    expect(appBaseUrl()).toBe(`${window.location.origin}/agitarcanvas/`);
  });

  it('respeita um caminho base absoluto', () => {
    vi.stubEnv('BASE_URL', '/outro/');
    visit('/outro/#/projetos');
    expect(appBaseUrl()).toBe(`${window.location.origin}/outro/`);
  });

  it('gera endereços de projeto e de convite dentro do subdiretório', () => {
    vi.stubEnv('BASE_URL', './');
    visit('/agitarcanvas/#/projetos');
    expect(projectUrl('p1')).toBe(`${window.location.origin}/agitarcanvas/#/projetos/p1`);
    expect(joinUrl('t1')).toBe(`${window.location.origin}/agitarcanvas/#/entrar/t1`);
  });
});
