// Phase 8 admin flows: a manual ledger adjustment, a settlement run, approval and the recorded payout (no money
// moves), a partner's cash deposit verified, and the Finance checks.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10); // India date
const tomorrow = () => new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

test('ledger: a manual credit for a restaurant, with a reason', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Restaurants');
  await page.getByRole('row', { name: /Pizza Point/ }).click();
  await page.getByRole('link', { name: 'Ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Ledger · Pizza Point' })).toBeVisible();
  await page.getByRole('button', { name: 'Adjust' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount').fill('150');
  await dialog.getByLabel('Why').fill('Packaging charges agreed with the owner');
  await dialog.getByRole('button', { name: 'Post adjustment' }).click();
  await expectToast(page, 'Adjustment posted');
  await expect(page.getByText('Packaging charges agreed with the owner')).toBeVisible();
  // The balance also holds anything posted by other tests (e.g. a cancellation's compensation).
  await expect(page.getByText(/^Jamzo owes ₹\d/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Adjustment \(credit\).*₹150\.00/ })).toBeVisible();
  await shot(page, '80-ledger');
});

test('settlements: run, approve, record the payout made outside Jamzo', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Settlements');
  await page.getByRole('button', { name: 'Run settlements' }).click();
  const run = page.getByRole('dialog');
  await run.getByLabel('From (optional)').fill(today());
  await run.getByLabel('Until, not included').fill(tomorrow());
  await run.getByRole('button', { name: 'Run now' }).click();
  await expectToast(page, /1 created/);
  const row = page.getByRole('row', { name: /Pizza Point/ });
  await expect(row).toContainText('Draft — check it');
  await shot(page, '81-settlements');
  await row.click();
  await expect(page.getByText('Adjustment (credit)')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expectToast(page, 'Approved — pay it and record the reference');
  await page.getByRole('button', { name: 'Record payout' }).click();
  const paid = page.getByRole('dialog');
  await paid.getByLabel('Transfer reference (UTR / UPI id)').fill('NEFT-E2E-001');
  await paid.getByRole('button', { name: 'Mark paid' }).click();
  await expectToast(page, 'Recorded as paid');
  await expect(page.getByText('NEFT-E2E-001', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Paid out · Paid: NEFT-E2E-001' })).toBeVisible();
  await shot(page, '82-settlement-paid');
});

test('cash deposits: Finance verifies a partner’s UPI deposit', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Cash deposits');
  const row = page.getByRole('row', { name: /Demo Delivery Partner/ });
  await expect(row).toContainText('UPI-E2E-4821');
  await row.getByRole('button', { name: /^Verify ₹250\.00/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Verify' }).click();
  await expectToast(page, 'Deposit verified');
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Verified' }).click();
  await expect(page.getByRole('row', { name: /Demo Delivery Partner/ })).toContainText('Verified');
  await shot(page, '83-cash-deposits');
});

test('finance: Jamzo’s ledger and the checks', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(page.getByText('Net for Jamzo')).toBeVisible();
  await expect(page.getByText(/delivered orders add up/)).toBeVisible();
  await expect(page.getByText('Every balance matches its entries', { exact: true })).toBeVisible();
  await shot(page, '84-finance');
});
