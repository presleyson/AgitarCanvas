import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addNote, createProject, expectSaved } from './helpers';

/**
 * No modo local, abas do mesmo navegador se sincronizam em tempo real. Cada
 * aba assume uma identidade diferente para exercitar presença e conflitos,
 * que usam o mesmo código da colaboração entre contas.
 */
async function openAs(context: BrowserContext, name: string, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript((user) => {
    sessionStorage.setItem('agitar.local.user', JSON.stringify(user));
  }, { id: `usuario-${name.toLowerCase()}`, name });
  await page.goto(url);
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  return page;
}

test.describe('Colaboração em tempo real', () => {
  test('alterações e presença aparecem para os demais participantes', async ({ page, context }) => {
    await createProject(page, 'Projeto compartilhado');
    const url = page.url();

    const ana = await openAs(context, 'Ana', url);
    const bruno = await openAs(context, 'Bruno', url);

    // Presença
    await expect(ana.getByRole('img', { name: 'Bruno está no projeto' })).toBeVisible();
    await expect(bruno.getByRole('img', { name: 'Ana está no projeto' })).toBeVisible();

    // Nota criada por Ana aparece para Bruno sem recarregar
    await addNote(ana, 'geracao', 'Ideia da Ana');
    await expect(bruno.getByTestId('bloco-geracao').getByText('Ideia da Ana')).toBeVisible();

    // Bruno vê quando Ana está editando a nota
    await ana.getByTestId('bloco-geracao').getByRole('button', { name: /Editar nota/ }).click();
    await expect(bruno.getByText('Ana está editando')).toBeVisible();
    await ana.keyboard.insertText(', revisada');
    await ana.keyboard.press('Escape');
    await expect(bruno.getByTestId('bloco-geracao').getByText('Ideia da Ana, revisada')).toBeVisible();
    await expect(bruno.getByText('Ana está editando')).toHaveCount(0);

    // Exclusão propaga
    await ana.getByTestId('bloco-geracao').locator('li').hover();
    await ana.getByTestId('bloco-geracao').getByRole('button', { name: 'Ações da nota' }).click();
    await ana.getByRole('menuitem', { name: 'Excluir' }).click();
    await expect(bruno.getByTestId('bloco-geracao').locator('li')).toHaveCount(0);

    // O histórico identifica quem fez cada alteração
    await bruno.getByRole('button', { name: 'Histórico', exact: true }).click();
    await expect(bruno.getByText('Ana excluiu uma nota de Geração de Ideias')).toBeVisible();
  });

  test('edição simultânea da mesma nota não sobrescreve: o conflito é apresentado', async ({ page, context }) => {
    await createProject(page, 'Conflito');
    await addNote(page, 'problema', 'Texto inicial');
    await expectSaved(page);
    const url = page.url();

    const ana = await openAs(context, 'Ana', url);
    const bruno = await openAs(context, 'Bruno', url);

    // Os dois começam a editar a partir da mesma versão.
    await ana.getByTestId('bloco-problema').getByRole('button', { name: /Editar nota/ }).click();
    await bruno.getByTestId('bloco-problema').locator('li').hover();
    await bruno.getByTestId('bloco-problema').getByRole('button', { name: 'Ações da nota' }).click();
    await bruno.getByRole('menuitem', { name: 'Editar mesmo assim' }).click();

    // Ana digita e conclui primeiro; Bruno conclui depois, com base na versão antiga.
    await ana.keyboard.insertText(' (Ana)');
    await bruno.keyboard.insertText(' (Bruno)');
    await ana.keyboard.press('Escape');
    await expectSaved(ana);
    await bruno.keyboard.press('Escape');

    // Bruno é avisado e vê a versão da Ana; nada foi sobrescrito.
    await expect(bruno.getByText('Edição simultânea')).toBeVisible();
    await expect(bruno.getByRole('alert').getByText('Texto inicial (Ana)')).toBeVisible();
    await expect(ana.getByTestId('bloco-problema').getByText('Texto inicial (Ana)')).toBeVisible();

    // Bruno decide manter a própria versão.
    await bruno.getByRole('button', { name: 'Manter a minha' }).click();
    await expect(ana.getByTestId('bloco-problema').getByText('Texto inicial (Bruno)')).toBeVisible();
    await expect(bruno.getByText('Edição simultânea')).toHaveCount(0);
  });
});
