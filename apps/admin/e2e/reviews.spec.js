// Ratings and reviews in Jamzo Admin (D-110). The rated order was delivered and rated through the real API in
// global-setup.js.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

const { rated } = JSON.parse(process.env.E2E_ORDERS);

test('reviews: a low rating is marked; hiding needs a reason and can be undone', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Reviews');
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(rated) });
  await expect(row).toContainText('Bread was cold and the rider was rude');
  await expect(row).toContainText('Low rating');
  await expect(row).toContainText('1★ · Demo Delivery Partner');
  await page.getByRole('tab', { name: 'Low ratings (1–2★)' }).click();
  await expect(page.getByRole('row', { name: new RegExp(rated) })).toBeVisible();
  await shot(page, '60-reviews');

  await page
    .getByRole('row', { name: new RegExp(rated) })
    .getByRole('button', { name: 'Hide' })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Hide review' })).toBeDisabled();
  await dialog.getByRole('textbox').fill('Abusive words about the partner');
  await dialog.getByRole('button', { name: 'Hide review' }).click();
  await expectToast(page, 'Review updated — averages recalculated');

  await page.getByRole('tab', { name: 'Hidden' }).click();
  const hidden = page.getByRole('row', { name: new RegExp(rated) });
  await expect(hidden).toContainText('Hidden: Abusive words about the partner');
  await hidden.getByRole('button', { name: 'Show again' }).click();
  await expectToast(page, 'Review updated — averages recalculated');
  await expect(page.getByRole('row', { name: new RegExp(rated) })).toHaveCount(0);
});
