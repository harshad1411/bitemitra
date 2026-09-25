import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test.describe.configure({ mode: 'serial' });

test('rejects a wrong password with a clear message', async ({ page }) => {
  await signIn(page, { email: 'e2e-super@jamzo.test', password: 'wrong-password' }, { expectSuccess: false });
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();
  await shot(page, '01-login-error');
});

test('signs in and shows an honest dashboard', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await expect(page.getByText('Waiting for a partner')).toBeVisible();
  await expect(page.getByText('Waiting for restaurant')).toBeVisible();
  await expect(page.getByText('Cities', { exact: true }).first()).toBeVisible();
  // Future modules are visibly not built yet
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByText('Settlements').locator('..'),
  ).toContainText('Phase 8');
  await shot(page, '02-dashboard');
});

test('cities: list, open Unjha, add a zone with GeoJSON', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Cities & zones');
  await expect(page.getByRole('row', { name: /Open Unjha/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Open Mehsana/ })).toContainText('Not launched');
  await shot(page, '03-cities');
  await page.getByRole('row', { name: /Open Unjha/ }).click();
  await expect(page.getByRole('heading', { name: 'Unjha' })).toBeVisible();
  await expect(page.getByText('Unjha North')).toBeVisible();
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unjha East');
  await page.getByLabel('Boundary (GeoJSON)').fill(
    JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [72.405, 23.795],
          [72.42, 23.795],
          [72.42, 23.815],
          [72.405, 23.815],
          [72.405, 23.795],
        ],
      ],
    }),
  );
  await expect(page.getByRole('img', { name: 'Shape preview' })).toBeVisible();
  await shot(page, '04-zone-dialog');
  await page.getByRole('button', { name: 'Save zone' }).click();
  await expectToast(page, 'Zone created');
  await expect(page.getByText('unjha-east')).toBeVisible();
  await shot(page, '05-city-detail');
});

test('configuration: override a setting for one city, then see it in history', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Configuration');
  await expect(page.getByText('Order limits')).toBeVisible();
  await expect(page.getByText('Placeholder amount').first()).toBeVisible();
  await expect(page.getByText('Legal review').first()).toBeVisible();
  await shot(page, '06-settings-global');
  await page.getByRole('combobox', { name: 'Scope' }).click();
  await page.getByRole('option', { name: 'City: Unjha' }).click();
  const row = page.locator('li', { hasText: 'Order limits' });
  await row.getByRole('button', { name: 'Override' }).click();
  await page.getByLabel('minOrderPaise').fill('9900');
  await expect(page.getByText('currently ₹99.00')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Order limits saved');
  await expect(row.getByText('Custom override')).toBeVisible();
  await shot(page, '07-settings-city-override');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('orders.limits').first()).toBeVisible();
  await page.getByRole('tab', { name: 'App versions' }).click();
  await expect(page.getByRole('cell', { name: 'Jamzo Delivery Partner' }).first()).toBeVisible();
  await shot(page, '08-app-versions');
});

test('roles and admin users', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Roles');
  await expect(page.getByRole('cell', { name: /City Manager/ })).toContainText('City Manager');
  await page
    .getByRole('row')
    .filter({ has: page.getByText('Operations', { exact: true }) })
    .click();
  await expect(page.getByLabel(/geo\.manage/)).toBeChecked();
  await expect(page.getByLabel(/admins\.manage/)).not.toBeChecked();
  await shot(page, '09-role-detail');

  await nav(page, 'Admin users');
  await page.getByRole('button', { name: 'Add admin' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Support Person');
  await page.getByLabel('Work email', { exact: true }).fill('support.person@jamzo.test');
  await page.getByLabel('Temporary password', { exact: true }).fill('Support-Temp-Pass-1');
  await page.getByRole('combobox', { name: 'Role 1', exact: true }).click();
  await page.getByRole('option', { name: 'Support', exact: true }).click();
  await page.getByRole('button', { name: 'Create admin' }).click();
  await expectToast(page, 'support.person@jamzo.test can now sign in');
  await expect(page.getByRole('heading', { name: 'Support Person' })).toBeVisible();
  await shot(page, '10-admin-user');
});

test('media: upload an image and see renditions generated by the worker', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Media');
  await expect(page.getByText('No images yet')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path.join(here, 'fixtures/banner.png'));
  await expectToast(page, 'banner.png uploaded');
  const row = page.getByRole('row', { name: /Open banner\.png/ });
  await expect(row).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row', { name: /Open banner\.png/ })).toContainText('Ready', {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await shot(page, '11-media');
});

test('audit log records what happened', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Audit log');
  for (const action of ['zone.create', 'setting.update', 'admin_user.create', 'media.upload']) {
    await expect(page.getByRole('cell', { name: action }).first()).toBeVisible();
  }
  await page.getByRole('cell', { name: 'setting.update' }).first().click();
  await expect(page.getByText('Before', { exact: true })).toBeVisible();
  await shot(page, '12-audit');
});

test('session survives a reload (httpOnly refresh cookie) and sign-out ends it', async ({
  page,
  context,
}) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === 'jz_admin_rt');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('jz_admin_rt');
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.getByRole('button', { name: /E2E|Super Admin/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/cities');
  await expect(page).toHaveURL(/\/login\?next=%2Fcities/);
});
