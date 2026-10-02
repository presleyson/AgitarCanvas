import { expect, test } from '@playwright/test';
import { addNote, createProject, expectSaved } from './helpers';

test.describe('Canvas', () => {
  test('edita, move, reordena e exclui notas, com desfazer', async ({ page }) => {
    await createProject(page, 'Edição de notas');
    await addNote(page, 'geracao', 'Primeira ideia');
    await addNote(page, 'geracao', 'Segunda ideia');

    // Editar
    const geracao = page.getByTestId('bloco-geracao');
    await geracao.getByRole('button', { name: 'Editar nota: Primeira ideia' }).click();
    await page.keyboard.insertText(' revisada');
    await page.keyboard.press('Escape');
    await expect(geracao.getByText('Primeira ideia revisada')).toBeVisible();

    // Reordenar
    await geracao.locator('li', { hasText: 'Segunda ideia' }).hover();
    await geracao.locator('li', { hasText: 'Segunda ideia' }).getByRole('button', { name: 'Ações da nota' }).click();
    await page.getByRole('menuitem', { name: 'Mover para cima' }).click();
    await expect(geracao.locator('li')).toHaveText([/Segunda ideia/, /Primeira ideia revisada/]);

    // Mover para outro bloco
    await geracao.locator('li', { hasText: 'Segunda ideia' }).hover();
    await geracao.locator('li', { hasText: 'Segunda ideia' }).getByRole('button', { name: 'Ações da nota' }).click();
    await page.getByRole('menuitem', { name: 'Ideias Selecionadas' }).click();
    await expect(page.getByTestId('bloco-selecionadas').getByText('Segunda ideia')).toBeVisible();
    await expect(geracao.locator('li')).toHaveCount(1);

    // Excluir e desfazer
    await geracao.locator('li').hover();
    await geracao.getByRole('button', { name: 'Ações da nota' }).click();
    await page.getByRole('menuitem', { name: 'Excluir' }).click();
    await expect(geracao.locator('li')).toHaveCount(0);
    await page.getByRole('button', { name: 'Desfazer' }).click();
    await expect(geracao.getByText('Primeira ideia revisada')).toBeVisible();

    await expectSaved(page);
    await page.reload();
    await expect(page.getByTestId('bloco-geracao').getByText('Primeira ideia revisada')).toBeVisible();
    await expect(page.getByTestId('bloco-selecionadas').getByText('Segunda ideia')).toBeVisible();
  });

  test('respeita o limite de notas do bloco', async ({ page }) => {
    await createProject(page, 'Limites');
    await addNote(page, 'mercado', 'Mercado um');
    await addNote(page, 'mercado', 'Mercado dois');

    const mercado = page.getByTestId('bloco-mercado');
    await expect(mercado.getByText('Limite de 2 notas atingido')).toBeVisible();
    await expect(mercado.getByRole('button', { name: /Adicionar nota/ })).toHaveCount(0);

    // Mover para um bloco cheio fica indisponível
    await addNote(page, 'problema', 'Um problema');
    await page.getByTestId('bloco-problema').locator('li').hover();
    await page.getByTestId('bloco-problema').getByRole('button', { name: 'Ações da nota' }).click();
    await expect(page.getByRole('menuitem', { name: /Mercado/ })).toBeDisabled();
  });

  test('nota deixada em branco é descartada', async ({ page }) => {
    await createProject(page, 'Em branco');
    await page.getByTestId('bloco-parceiros').getByRole('button', { name: /Adicionar nota/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bloco-parceiros').locator('li')).toHaveCount(0);
  });

  test('nota esvaziada é excluída com opção de desfazer, que devolve o texto anterior', async ({ page }) => {
    await createProject(page, 'Esvaziar nota');
    await addNote(page, 'parceiros', 'Universidade parceira');
    await expectSaved(page);

    const parceiros = page.getByTestId('bloco-parceiros');
    await parceiros.getByRole('button', { name: 'Editar nota: Universidade parceira' }).click();
    await page.getByLabel('Texto da nota').fill('');
    await page.keyboard.press('Escape');
    await expect(parceiros.locator('li')).toHaveCount(0);

    await page.getByRole('button', { name: 'Desfazer' }).click();
    await expect(parceiros.getByText('Universidade parceira')).toBeVisible();
    await expectSaved(page);
    await page.reload();
    await expect(page.getByTestId('bloco-parceiros').getByText('Universidade parceira')).toBeVisible();
  });

  test('texto digitado sobrevive ao recarregamento imediato da página', async ({ page }) => {
    await createProject(page, 'Recarregar durante a digitação');
    await page.getByTestId('bloco-problema').getByRole('button', { name: /Adicionar nota/ }).click();
    await page.keyboard.insertText('Digitado e recarregado em seguida');
    // Sem sair do campo e sem esperar a gravação automática.
    await page.reload();
    await expect(page.getByTestId('bloco-problema').getByText('Digitado e recarregado em seguida')).toBeVisible();
    await expectSaved(page);
  });

  test('modo Etapas guia o preenchimento com orientação metodológica', async ({ page }) => {
    await createProject(page, 'Etapas');
    await page.getByRole('tab', { name: 'Etapas' }).click();

    const etapa = page.getByTestId('etapa-planejamento');
    await expect(etapa.getByRole('heading', { name: 'Planejamento Estratégico' })).toBeVisible();
    await expect(etapa.getByText('Khurana e Rosenthal, 1998')).toBeVisible();

    await etapa.getByRole('button', { name: /Adicionar nota/ }).click();
    await page.keyboard.insertText('Definir objetivos de longo prazo');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Problema', exact: true }).last().click();
    await expect(page.getByTestId('etapa-problema')).toBeVisible();

    // O mesmo conteúdo aparece na visão Canvas.
    await page.getByRole('tab', { name: 'Canvas' }).click();
    await expect(page.getByTestId('bloco-planejamento').getByText('Definir objetivos de longo prazo')).toBeVisible();
  });

  test('histórico registra alterações e versões podem ser restauradas', async ({ page }) => {
    await createProject(page, 'Versionamento');
    await addNote(page, 'problema', 'Estado do marco');
    await expectSaved(page);

    await page.getByRole('button', { name: 'Histórico', exact: true }).click();
    await expect(page.getByText('adicionou uma nota em Problema')).toBeVisible();

    await page.getByRole('tab', { name: 'Versões' }).click();
    await page.getByLabel('Salvar o estado atual como versão').fill('Marco 1');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Marco 1')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('bloco-problema').getByRole('button', { name: /Editar nota/ }).click();
    await page.keyboard.insertText(' alterado');
    await page.keyboard.press('Escape');
    await addNote(page, 'mercado', 'Criada depois do marco');
    await expectSaved(page);

    await page.getByRole('button', { name: 'Histórico', exact: true }).click();
    await page.getByRole('tab', { name: 'Versões' }).click();
    await page.getByRole('button', { name: 'Restaurar' }).first().click();
    await page.getByRole('button', { name: 'Restaurar versão' }).click();
    await expect(page.getByText('Versão "Marco 1" restaurada.')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('bloco-problema').getByText('Estado do marco', { exact: true })).toBeVisible();
    await expect(page.getByTestId('bloco-mercado').locator('li')).toHaveCount(0);
  });
});
