import { expect, test } from '@playwright/test';
import { shot, signIn } from './helpers.js';

test('phone layout: navigation drawer and readable tables', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cities & zones' })).toBeHidden(); // sidebar collapsed
  await shot(page, 'm1-dashboard');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await shot(page, 'm2-nav');
  await page.getByRole('link', { name: 'Cities & zones' }).click();
  await expect(page.getByRole('row', { name: /Open Unjha/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false); // no horizontal page scroll
  await shot(page, 'm3-cities');
});
