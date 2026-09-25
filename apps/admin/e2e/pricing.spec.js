// Phases 3 + 4 admin flows: pricing rules, test quote, offers, home content, customers.
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('pricing: rules per type, a new city markup version, history', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Pricing');
  await expect(page.getByRole('row', { name: /Pizza Point/ }).first()).toContainText('+10%');
  await shot(page, '30-pricing-markup');

  await page.getByRole('button', { name: 'Add rule' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: 'Applies to' }).click();
  await page.getByRole('option', { name: 'City' }).click();
  await dlg.locator('#r-target').click();
  await page.getByRole('option', { name: 'Unjha' }).click();
  await dlg.getByLabel('Markup', { exact: true }).fill('5');
  await dlg.getByLabel('Why (required)').fill('City-wide 5% (E2E)');
  await dlg.getByRole('button', { name: 'Save new version' }).click();
  await expectToast(page, 'New rule version saved');
  const row = page.getByRole('row', { name: /Unjha/ }).first();
  await expect(row).toContainText('+5%');

  await page.getByRole('tab', { name: 'Tax' }).click();
  await expect(page.getByText('Pending CA review').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Delivery fee' }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Delivery fee' }).getByRole('row', { name: /All cities/ }),
  ).toContainText('free above ₹499.00');
  await shot(page, '31-pricing-delivery');
});

test('pricing: test quote shows customer, restaurant and platform side adding up', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Pricing');
  await page.getByRole('tab', { name: 'Test quote' }).click();
  await page.getByRole('combobox', { name: 'Restaurant' }).click();
  await page.getByRole('option', { name: 'Pizza Point' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('combobox', { name: 'Item 1' }).click();
  await page.getByRole('option', { name: 'Garlic Bread' }).click();
  await page.getByLabel('Quantity 1').fill('3');
  await page.getByRole('button', { name: 'Price this cart' }).click();
  await expect(page.getByRole('cell', { name: 'Total payable', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Restaurant payable', exact: true })).toBeVisible();
  await expect(page.getByText('Jamzo net').first()).toBeVisible();
  await expect(page.getByText('These add up to exactly the total payable')).toBeVisible();
  await shot(page, '32-test-quote');
});

test('offers: create a coupon', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Offers & coupons');
  await expect(page.getByRole('row', { name: /WELCOME50/ })).toBeVisible();
  await page.getByRole('button', { name: 'New coupon' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Code').fill('unjha20');
  await dlg.getByLabel('Percentage').fill('20');
  await dlg.getByLabel('Maximum discount (optional)').fill('60');
  await dlg.getByLabel('Minimum order (optional)').fill('249');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Coupon saved');
  await expect(page.getByRole('row', { name: /UNJHA20/ })).toContainText('20% off up to ₹60.00');
  await shot(page, '33-offers');
});

test('home & content: sections are listed and a text section can be added', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Home & content');
  await expect(page.getByText('What are you craving?')).toBeVisible();
  await page.getByRole('button', { name: 'Add section' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: 'Section type' }).click();
  await page.getByRole('option', { name: 'Text' }).click();
  await dlg.getByLabel('Title', { exact: true }).fill('Order from Unjha’s favourites');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Home section saved');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await expect(page.getByRole('row', { name: /Terms of use/ })).toContainText('Draft');
  await shot(page, '34-content');
});

test('restaurant pricing tab: rules in force and a markup preview', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Restaurants');
  await page.getByRole('row', { name: 'Open Pizza Point' }).click();
  await page.getByRole('tab', { name: 'Pricing' }).click();
  await expect(page.getByText('Rules in force')).toBeVisible();
  await page.getByLabel('Try markup (%) — optional').fill('15');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('columnheader', { name: 'With draft' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Garlic Bread/ })).toContainText('₹104.00'); // ₹90 + 15% → ₹103.50 → ₹104
  await shot(page, '35-restaurant-pricing');
});

test('customers: masked list (empty until customers sign in)', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Customers');
  await expect(page.getByText('Contact details are masked')).toBeVisible();
});
