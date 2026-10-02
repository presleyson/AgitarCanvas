import { expect, test } from '@playwright/test';
import { addNote, createProject, expectSaved } from './helpers';

test.describe('Meus Projetos', () => {
  test('cria um projeto e mantém o preenchimento depois de recarregar @essencial', async ({ page }) => {
    await createProject(page, 'Plataforma de atendimento', { organization: 'Prolinx' });
    await addNote(page, 'mercado', 'PMEs de TIC em Minas Gerais');
    await addNote(page, 'problema', 'Baixa maturidade em inovação');
    await expectSaved(page);

    await page.reload();

    await expect(page.getByTestId('bloco-mercado').getByText('PMEs de TIC em Minas Gerais')).toBeVisible();
    await expect(page.getByTestId('bloco-problema').getByText('Baixa maturidade em inovação')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plataforma de atendimento' })).toBeVisible();
  });

  test('lista, pesquisa e ordena projetos', async ({ page }) => {
    await createProject(page, 'Zeta Analytics');
    await createProject(page, 'Alfa Pagamentos', { organization: 'Fintech Minas' });
    await page.goto('./#/projetos');

    const names = page.locator('article h2');
    await expect(names).toHaveText(['Alfa Pagamentos', 'Zeta Analytics']);

    await page.getByLabel('Ordenar por').selectOption('name');
    await expect(names).toHaveText(['Alfa Pagamentos', 'Zeta Analytics']);
    await page.getByLabel('Ordenar por').selectOption('created');
    await expect(names).toHaveText(['Alfa Pagamentos', 'Zeta Analytics']);

    await page.getByPlaceholder(/Pesquisar/).fill('fintech');
    await expect(names).toHaveText(['Alfa Pagamentos']);

    await page.getByPlaceholder(/Pesquisar/).fill('inexistente');
    await expect(page.getByText('Nenhum projeto encontrado')).toBeVisible();
  });

  test('edita, duplica, arquiva e exclui', async ({ page }) => {
    await createProject(page, 'Projeto Original');
    await addNote(page, 'resultados', 'Reduzir custos');
    await expectSaved(page);
    await page.goto('./#/projetos');

    // Editar dados
    await page.getByRole('button', { name: 'Ações do projeto Projeto Original' }).click();
    await page.getByRole('menuitem', { name: 'Editar dados' }).click();
    await page.getByLabel('Nome do projeto').fill('Projeto Renomeado');
    await page.getByLabel('Status').selectOption('active');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('article h2')).toHaveText(['Projeto Renomeado']);
    await expect(page.locator('article').getByText('Em andamento')).toBeVisible();

    // Duplicar
    await page.getByRole('button', { name: 'Ações do projeto Projeto Renomeado' }).click();
    await page.getByRole('menuitem', { name: 'Duplicar' }).click();
    await expect(page.locator('article h2')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Projeto Renomeado (cópia)' })).toBeVisible();

    // A cópia traz as notas
    await page.getByRole('link', { name: 'Abrir Projeto Renomeado (cópia)' }).click();
    await expect(page.getByTestId('bloco-resultados').getByText('Reduzir custos')).toBeVisible();
    await page.goto('./#/projetos');

    // Arquivar
    await page.getByRole('button', { name: 'Ações do projeto Projeto Renomeado (cópia)' }).click();
    await page.getByRole('menuitem', { name: 'Arquivar' }).click();
    await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(page.locator('article h2')).toHaveText(['Projeto Renomeado']);
    await page.getByRole('tab', { name: /Arquivados/ }).click();
    await expect(page.locator('article h2')).toHaveText(['Projeto Renomeado (cópia)']);

    // Projeto arquivado abre somente para leitura
    await page.getByRole('link', { name: 'Abrir Projeto Renomeado (cópia)' }).click();
    await expect(page.getByText('Este projeto está arquivado')).toBeVisible();
    await expect(page.getByRole('button', { name: /Adicionar nota/ })).toHaveCount(0);
    await page.goto('./#/projetos');

    // Excluir
    await page.getByRole('tab', { name: /Arquivados/ }).click();
    await page.getByRole('button', { name: 'Ações do projeto Projeto Renomeado (cópia)' }).click();
    await page.getByRole('menuitem', { name: 'Excluir' }).click();
    await page.getByRole('button', { name: 'Excluir definitivamente' }).click();
    await expect(page.getByText('Nenhum projeto arquivado')).toBeVisible();
  });

  test('valida o nome obrigatório', async ({ page }) => {
    await page.goto('./#/projetos');
    await page.getByRole('button', { name: 'Novo projeto' }).first().click();
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await expect(page.getByText('Informe o nome do projeto.')).toBeVisible();
  });
});
