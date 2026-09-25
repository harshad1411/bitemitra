// Phase 9 admin flows: the support queue (reply, internal note, resolve), orders filters with a saved view
// and CSV export, analytics, and the audit log export. The ticket was raised through the real API in
// global-setup.js.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
const orders = () => JSON.parse(process.env.E2E_ORDERS);

test('support: answer a customer, add an internal note, resolve with the order at hand', async ({ page }) => {
  const { waiting } = orders();
  await signIn(page);
  await nav(page, 'Support');
  // Rows are named "Open ticket …"; find the one about the waiting order by its text.
  const row = page.getByRole('row').filter({ hasText: waiting });
  await expect(row).toContainText('Payment');
  await expect(row).toContainText('Open');
  await shot(page, '90-support');
  await row.click();
  await expect(page.getByText('Can I pay by UPI instead of cash?')).toBeVisible();
  await expect(page.getByText(`Order ${waiting}`, { exact: true })).toBeVisible(); // the order, alongside
  await expect(page.getByRole('link', { name: 'Open the full order' })).toBeVisible();
  await page.getByLabel('Internal note').click();
  await page.getByLabel('Reply').fill('Online payment exists now; the order was placed as cash.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expectToast(page, 'Internal note added');
  await expect(page.getByText('internal note (customer cannot see it)')).toBeVisible();
  await page
    .getByLabel('Reply')
    .fill('Yes — cancel and place it again choosing Pay online, or pay the partner in cash.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expectToast(page, 'Reply sent — the customer gets a notification');
  await expect(page.getByText('Waiting for the customer')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page
    .getByRole('alertdialog')
    .getByLabel('Reason (recorded in the audit log)')
    .fill('Explained both ways to pay');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Resolve' }).click();
  await expectToast(page, 'Ticket updated');
  await expect(page.getByText('Resolution:')).toContainText('Explained both ways to pay');
  await expect(page.getByText('Resolved', { exact: true })).toBeVisible();
  await shot(page, '91-ticket');
});

test('orders: filter, save a view, re-apply it; export CSV', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Orders');
  await page.getByRole('combobox', { name: 'Payment method' }).click();
  await page.getByRole('option', { name: 'Cash on delivery' }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Cash orders');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expectToast(page, 'View saved');
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved filters' }).click();
  await page.getByRole('option', { name: 'Cash orders' }).click();
  await expect(page.getByRole('combobox', { name: 'Payment method' })).toContainText('Cash on delivery');
  await expect(page.getByRole('row', { name: /UPI/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('jamzo-orders.csv');
  await shot(page, '92-orders-filters');
});

test('analytics: KPIs and a breakdown by payment method', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Analytics');
  await expect(page.getByText('GMV (delivered)')).toBeVisible();
  await page.getByRole('combobox', { name: 'Breakdown' }).click();
  await page.getByRole('option', { name: 'Payment method' }).click();
  await expect(page.getByRole('cell', { name: 'COD' })).toBeVisible();
  await shot(page, '93-analytics');
});

test('audit log: export the filtered log', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Audit log');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV (these filters)' }).click();
  expect((await download).suggestedFilename()).toBe('jamzo-audit-log.csv');
});
