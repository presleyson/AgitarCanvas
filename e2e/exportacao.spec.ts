import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addNote, createProject } from './helpers';

async function exportPdf(page: Page, item: RegExp): Promise<Buffer> {
  await page.getByRole('button', { name: 'Exportar e imprimir' }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/^agitar-canvas_.+\.pdf$/);
  return readFile(await download.path());
}

/** Lê o número de páginas e o tamanho da primeira página direto do PDF. */
function inspect(pdf: Buffer): { pages: number; width: number; height: number } {
  const text = pdf.toString('latin1');
  const pages = Number(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/.exec(text)?.[1] ?? /\/Count\s+(\d+)/.exec(text)?.[1]);
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { pages, width: Math.round(Number(box?.[1])), height: Math.round(Number(box?.[2])) };
}

test.describe('Exportação em PDF', () => {
  test('gera relatório A4, canvas A3 e canvas A4', async ({ page }) => {
    await createProject(page, 'Projeto para exportar', { organization: 'Empresa Ç & Filhos' });
    await addNote(page, 'planejamento', 'Objetivo estratégico com acentuação: inovação, gestão, ação');
    await addNote(page, 'mercado', 'PMEs de TIC');

    const report = await exportPdf(page, /^Relatório A4/);
    expect(report.subarray(0, 5).toString()).toBe('%PDF-');
    expect(inspect(report)).toMatchObject({ width: 595, height: 842 });

    const a3 = await exportPdf(page, /^Canvas A3/);
    expect(inspect(a3)).toEqual({ pages: 1, width: 1191, height: 842 });

    const a4 = await exportPdf(page, /^Canvas A4/);
    expect(inspect(a4)).toEqual({ pages: 1, width: 842, height: 595 });
  });

  test('canvas cabe em uma página mesmo com todos os blocos cheios de texto longo', async ({ page }) => {
    test.slow();
    await createProject(page, 'Projeto no limite');

    // Preenche direto no armazenamento local para montar o pior caso rapidamente.
    await page.evaluate(() => {
      const limits: Record<string, number> = {
        planejamento: 6, problema: 2, mercado: 2, geracao: 5, selecionadas: 5,
        financeiros: 5, tecnicos: 5, parceiros: 5, resultados: 6,
      };
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('agitar.local.project.'))!;
      const entry = JSON.parse(localStorage.getItem(key)!) as { project: { id: string }; notes: unknown[] };
      const now = new Date().toISOString();
      const long = 'Texto extenso para exercitar o ajuste de fonte e a abreviação no canvas de página única. '.repeat(18);
      for (const [block, limit] of Object.entries(limits)) {
        for (let i = 0; i < limit; i += 1) {
          entry.notes.push({
            id: crypto.randomUUID(), projectId: entry.project.id, block, content: long.slice(0, 1500),
            position: i + 1, version: 1, createdBy: 'local-user', updatedBy: 'local-user',
            createdAt: now, updatedAt: now, deletedAt: null,
          });
        }
      }
      localStorage.setItem(key, JSON.stringify(entry));
    });
    await page.reload();
    await expect(page.getByTestId('bloco-planejamento').locator('li')).toHaveCount(6);

    expect(inspect(await exportPdf(page, /^Canvas A3/)).pages).toBe(1);
    expect(inspect(await exportPdf(page, /^Canvas A4/)).pages).toBe(1);
    expect(inspect(await exportPdf(page, /^Relatório A4/)).pages).toBeGreaterThan(3);
  });
});
