// Phase 5 admin flows: orders list and views, order detail, admin cancellation with override, cancellation
// rules, notification templates. Orders were placed through the real API in global-setup.js.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
const orders = () => JSON.parse(process.env.E2E_ORDERS);

test('orders: views, search and the full order detail', async ({ page }) => {
  const { waiting, ready } = orders();
  await signIn(page);
  await nav(page, 'Orders');
  await expect(page.getByRole('row', { name: new RegExp(waiting) })).toContainText('Placed');
  await expect(page.getByRole('row', { name: new RegExp(ready) })).toContainText('Finding rider'); // ready; dispatch started (Phase 6)
  await page.getByRole('combobox', { name: 'View' }).click();
  await page.getByRole('option', { name: 'Waiting for restaurant' }).click();
  await expect(page.getByRole('row', { name: new RegExp(ready) })).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(waiting) })).toBeVisible();
  await shot(page, '40-orders');

  await page.getByRole('row', { name: new RegExp(waiting) }).click();
  await expect(page.getByRole('heading', { name: `Order ${waiting}` })).toBeVisible();
  await expect(page.getByText('Garlic Bread')).toBeVisible();
  await expect(page.getByText('Kitchen note: Extra oregano')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Restaurant payable (estimate)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Jamzo net' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total payable' })).toBeVisible();
  await page.getByLabel('Add a note').fill('Customer called about oregano');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expectToast(page, 'Note added');
  await expect(page.getByText('Customer called about oregano')).toBeVisible();
  await shot(page, '41-order-detail');
});

test('orders: an admin cancels an accepted order and overrides the compensation', async ({ page }) => {
  const { toCancel } = orders();
  await signIn(page);
  await nav(page, 'Orders');
  await page.getByPlaceholder('Order number, restaurant, customer or partner name, or phone').fill(toCancel);
  await page.getByRole('row', { name: new RegExp(toCancel) }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('What happened (required)').fill('Customer phoned support to cancel');
  await dlg.getByRole('switch', { name: 'Override the computed amounts' }).click();
  await dlg.getByLabel('Restaurant gets').fill('40');
  await dlg.getByRole('button', { name: 'Cancel order' }).click();
  await expectToast(page, 'Order cancelled');
  await expect(page.getByText('Cancelled by Jamzo').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Restaurant compensation/ })).toContainText('₹40.00');
  await expect(page.getByRole('row', { name: /Platform loss/ })).toContainText('₹40.00');
  await expect(page.getByText('Amounts overridden by an admin')).toBeVisible();
  await shot(page, '42-order-cancelled');
});

test('pricing: cancellation rules are listed and a new version can be saved', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Pricing');
  await page.getByRole('tab', { name: 'Cancellations' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Cancellations' });
  // Owner rule OD-38: the customer may cancel after acceptance, without a refund; Jamzo pays the restaurant.
  await expect(panel.getByRole('row', { name: /All cities/ })).toContainText(
    'Customer can cancel: before the restaurant accepts, after acceptance, after preparation starts · no refund after acceptance, after preparation starts · restaurant paid its food value',
  );
  await panel
    .getByRole('button', { name: /New version|Edit/ })
    .first()
    .click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('switch', { name: 'After preparation starts: Customer may cancel' }).click();
  await dlg.getByLabel('Why (required)').fill('No customer cancellation once cooking starts (E2E)');
  await dlg.getByRole('button', { name: 'Save new version' }).click();
  await expectToast(page, 'New rule version saved');
  await expect(panel.getByRole('row', { name: /All cities/ }).first()).toContainText(
    'Customer can cancel: before the restaurant accepts, after acceptance ·',
  );
  await shot(page, '43-cancellation-rules');
});

test('notifications: templates can be edited', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Notifications');
  await page.getByRole('button', { name: 'Edit Ready for pickup for Customer app' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Title', { exact: true }).fill('Your food is packed');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Template saved');
  await expect(page.getByText('Your food is packed')).toBeVisible();
  await shot(page, '44-notifications');
});

test('customers: cash on delivery can be switched off and on with a reason', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Customers');
  await page.getByRole('row', { name: /Meera Joshi/ }).click();
  await expect(page.getByText(/UNJ-\d{6}-\d{5}/).first()).toBeVisible(); // recent orders
  await page.getByRole('button', { name: 'Switch cash on delivery off' }).click();
  await page.getByRole('alertdialog').getByRole('textbox').fill('Repeated late cancellations (E2E)');
  await page.getByRole('button', { name: 'Switch off' }).click();
  await expectToast(page, 'Cash on delivery switched off');
  await expect(page.getByText('COD disabled')).toBeVisible();
  await page.getByRole('button', { name: 'Switch cash on delivery back on' }).click();
  await page.getByRole('alertdialog').getByRole('textbox').fill('Customer called, explained (E2E)');
  await page.getByRole('button', { name: 'Switch on' }).click();
  await expectToast(page, 'Cash on delivery switched on');
});
