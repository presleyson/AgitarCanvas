import { expect, type Page } from '@playwright/test';

export async function createProject(page: Page, name: string, extra: { organization?: string } = {}): Promise<void> {
  await page.goto('./#/projetos');
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  await page.getByLabel('Nome do projeto').fill(name);
  if (extra.organization) await page.getByLabel('Empresa ou organização').fill(extra.organization);
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByTestId('canvas-board')).toBeVisible();
}

export async function addNote(page: Page, block: string, text: string): Promise<void> {
  await page.getByTestId(`bloco-${block}`).getByRole('button', { name: /Adicionar nota/ }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`bloco-${block}`).getByText(text, { exact: true })).toBeVisible();
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-indicator').filter({ visible: true })).toContainText('Salvo');
}

/** A página não deve rolar na horizontal em nenhuma largura. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'rolagem horizontal indesejada').toBeLessThanOrEqual(1);
}
