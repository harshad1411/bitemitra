// Phase 6 admin flows: review a delivery partner's documents and approve them, the dispatch board, and a
// manual assignment. The applicant and the online demo partner were created through the real API in
// global-setup.js (prepareRiders).
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
const orders = () => JSON.parse(process.env.E2E_ORDERS);

test('delivery partners: verify documents, then approve the applicant', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Delivery partners');
  await expect(page.getByRole('row', { name: /Demo Delivery Partner/ })).toBeVisible();
  await page.getByRole('row', { name: /Kiran Desai/ }).click();
  await expect(page.getByRole('heading', { name: 'Kiran Desai' })).toBeVisible();
  // Only the last 4 characters of a document number are ever shown.
  await expect(page.getByText('ABCDE1234F')).toHaveCount(0);
  await expect(page.getByText(/234F/)).toBeVisible();
  await shot(page, '60-rider-review');

  for (const kind of ['PAN', 'Identity proof', 'Photo']) {
    await page.getByRole('button', { name: `Verify ${kind}` }).click();
    await expectToast(page, 'Document reviewed');
    await expect(page.getByRole('button', { name: `Verify ${kind}` })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Approve (go live)' }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByLabel('Reason (recorded in the audit log)').fill('All documents verified');
  await confirm.getByRole('button', { name: 'Approve (go live)' }).click();
  await expectToast(page, 'Status changed');
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await shot(page, '61-rider-active');
});

test('dispatch: the board shows the order and the online partner; an admin sends it to them', async ({
  page,
}) => {
  const { ready } = orders();
  await signIn(page);
  await nav(page, 'Dispatch');
  await expect(page.getByText(/Partners online \(1\)/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Demo Delivery Partner/ })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(ready) });
  await expect(row).toBeVisible();
  await shot(page, '62-dispatch');

  await row.getByRole('button', { name: `Assign ${ready}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Assign ${ready}` })).toBeVisible();
  await dialog.getByRole('button', { name: /Demo Delivery Partner/ }).click();
  await dialog.getByLabel('Why (required)').fill('Nearest partner is outside the automatic radius');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expectToast(page, 'Request sent to the partner');
  await expect(page.getByRole('row', { name: new RegExp(ready) })).toContainText(
    'Demo Delivery Partner (asked)',
  );
});

test('order detail: the delivery card lists the manual request', async ({ page }) => {
  const { ready } = orders();
  await signIn(page);
  await nav(page, 'Orders');
  await page.getByPlaceholder('Order number, restaurant or customer name').fill(ready);
  await page.getByRole('row', { name: new RegExp(ready) }).click();
  await expect(page.getByRole('heading', { name: `Order ${ready}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Demo Delivery Partner (manual)' })).toBeVisible();
  await expect(page.getByText('Offered')).toBeVisible();
  await shot(page, '63-order-delivery');
});
