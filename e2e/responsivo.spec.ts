import { expect, test } from '@playwright/test';
import { addNote, createProject, expectNoHorizontalOverflow, expectSaved } from './helpers';

test.describe('Responsividade', () => {
  test('fluxo principal funciona e não há rolagem horizontal @responsivo', async ({ page }) => {
    await page.goto('./#/projetos');
    await expectNoHorizontalOverflow(page);

    await createProject(page, 'Projeto em qualquer tela', { organization: 'Organização com nome bastante extenso para testar quebra' });
    await expectNoHorizontalOverflow(page);

    await addNote(page, 'planejamento', 'Meta com um texto razoavelmente longo para verificar a quebra de linha dentro da nota');
    await addNote(page, 'mercado', 'PMEs');
    await expectSaved(page);
    await expectNoHorizontalOverflow(page);

    // Os nove blocos estão presentes na visão geral.
    await expect(page.locator('[data-testid^="bloco-"]')).toHaveCount(9);

    await page.getByRole('tab', { name: 'Etapas' }).click();
    await expect(page.getByTestId('etapa-planejamento')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Mais ações do projeto' }).click();
    await page.getByRole('menuitem', { name: 'Histórico e versões' }).click();
    await expect(page.getByRole('dialog', { name: 'Histórico' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('./#/metodologia');
    await expect(page.getByRole('heading', { name: 'AGITAR Canvas', level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('./#/projetos');
    await expect(page.getByRole('heading', { name: 'Projeto em qualquer tela' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('em telas pequenas o mapa do canvas leva ao bloco escolhido @responsivo', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 700, 'O mapa só existe em telas pequenas.');
    await createProject(page, 'Mapa');
    const map = page.getByRole('navigation', { name: 'Visão geral do canvas' });
    await expect(map).toBeVisible();
    await map.getByRole('button', { name: /^Resultados/ }).click();
    await expect(page.getByTestId('bloco-resultados')).toBeInViewport();
  });
});
