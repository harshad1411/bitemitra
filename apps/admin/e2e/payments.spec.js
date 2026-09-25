// Phase 7 admin flows: payments list and detail, "Check with gateway", a partial refund from the order that
// the worker sends to the (fake) gateway, and the refunds list. The online order was paid through the fake
// gateway's signed webhook in global-setup.js.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
const orders = () => JSON.parse(process.env.E2E_ORDERS);

test('payments: the paid online order, its gateway tries and messages; check with the gateway', async ({
  page,
}) => {
  const { online } = orders();
  await signIn(page);
  await nav(page, 'Payments');
  const row = page.getByRole('row', { name: new RegExp(online) });
  await expect(row).toContainText('Paid');
  await expect(row).toContainText('UPI');
  await shot(page, '70-payments');
  await row.click();
  await expect(page.getByRole('heading', { name: `Payment for ${online}` })).toBeVisible();
  await expect(page.getByText('Online (fake)')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'payment.captured' })).toBeVisible();
  await expect(page.getByText('Gateway fee (incl. tax)')).toBeVisible();
  await page.getByRole('button', { name: 'Check with gateway' }).click();
  await expectToast(page, 'Already up to date.');
  await shot(page, '71-payment-detail');
});

test('refund: an amount from the order, processed by the worker; listed under Refunds', async ({ page }) => {
  const { online } = orders();
  await signIn(page);
  await nav(page, 'Orders');
  await page.getByPlaceholder('Order number, restaurant or customer name').fill(online);
  await page.getByRole('row', { name: new RegExp(online) }).click();
  await expect(page.getByRole('heading', { name: `Order ${online}` })).toBeVisible();
  await page.getByRole('button', { name: 'Refund', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/can still be refunded/)).toBeVisible();
  await dialog.getByLabel('Amount').fill('10');
  await dialog.getByLabel('Why (the customer may see this)').fill('Garlic dip was missing');
  await shot(page, '72-refund-dialog');
  await dialog.getByRole('button', { name: 'Create refund' }).click();
  await expectToast(page, 'Refund created');
  // The worker hands it to the gateway within a second or two; the page refreshes itself.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Refund: An amount · ₹10.00')).toBeVisible();
    await expect(page.getByText('Refunded', { exact: true })).toBeVisible();
  }).toPass({ timeout: 20_000 });
  await shot(page, '73-order-refunded');

  await nav(page, 'Refunds');
  const row = page.getByRole('row', { name: new RegExp(online) });
  await expect(row).toContainText('Refunded');
  await expect(row).toContainText('Garlic dip was missing');
  await shot(page, '74-refunds');
});
