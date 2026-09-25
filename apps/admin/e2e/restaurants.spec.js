// Phase 2 admin flows against the real API with the seeded demo catalog (12 restaurants, 108 products).
import { expect, test } from '@playwright/test';
import { expectToast, nav, shot, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('restaurants list, filters and a live restaurant’s detail', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Restaurants');
  await expect(page.getByRole('row', { name: 'Open Umiya Thali House' })).toContainText('Live');
  await expect(page.getByRole('row', { name: 'Open Royal Bakery' })).toContainText('In review');
  await page.getByLabel('Search by name, slug or cuisine').fill('pizza');
  await expect(page.getByRole('row', { name: 'Open Pizza Point' })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Open Umiya Thali House' })).toHaveCount(0);
  await shot(page, '20-restaurants');

  await page.getByRole('row', { name: 'Open Pizza Point' }).click();
  await expect(page.getByRole('heading', { name: /Pizza Point/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Before going live' })).toContainText('At least one active, available product');
  await shot(page, '21-restaurant-overview');

  await page.getByRole('tab', { name: 'Branches & hours' }).click();
  await expect(page.getByText('Zone: Unjha Central')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Monday closes' })).toHaveValue('23:30');
  await shot(page, '22-restaurant-branches');

  await page.getByRole('tab', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: /Margherita/ })).toBeVisible();
  await expect(page.getByText('from ₹120.00 · 3 sizes').first()).toBeVisible();
  await shot(page, '23-restaurant-menu');

  await page.getByRole('tab', { name: 'Bank accounts' }).click();
  await expect(page.getByText('Primary · verified')).toBeVisible();
  await expect(page.getByText(/•••• \d{4}/)).toBeVisible();
});

test('onboards a new restaurant: draft, branch, hours, documents, bank account, submit for review', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Restaurants');
  await page.getByRole('button', { name: 'Add restaurant' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: 'City' }).click();
  await page.getByRole('option', { name: 'Unjha' }).click();
  await dlg.getByLabel('Name').fill('Shreeji Khaman House');
  await dlg.getByLabel('Cuisines').fill('Farsan, Gujarati');
  await dlg.getByLabel('Contact phone').fill('9876501234');
  await dlg.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: /Shreeji Khaman House/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();

  // Team
  await page.getByRole('tab', { name: 'Team' }).click();
  await page.getByRole('button', { name: 'Add member' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Mobile number').fill('9876501235');
  await dlg.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Owner' }).click();
  await dlg.getByRole('button', { name: 'Add member' }).click();
  await expectToast(page, 'Team member added');

  // Branch, hours, delivery area
  await page.getByRole('tab', { name: 'Branches & hours' }).click();
  await page.getByRole('button', { name: 'Add branch' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Branch name').fill('Ganj Bazar');
  await dlg.getByLabel('Address').fill('Ganj Bazar, Unjha');
  await dlg.getByLabel('Latitude').fill('23.806');
  await dlg.getByLabel('Longitude').fill('72.395');
  await dlg.getByRole('button', { name: 'Save branch' }).click();
  await expect(page.getByText('Zone: Unjha Central')).toBeVisible();
  const hours = page.getByRole('region', { name: 'Opening hours' });
  await hours.getByRole('button', { name: 'Add hours' }).nth(1).click(); // Monday
  await hours.getByRole('button', { name: 'Copy to every day' }).click();
  await hours.getByRole('button', { name: 'Save hours' }).click();
  await expectToast(page, 'Opening hours saved');
  await page.getByRole('region', { name: 'Delivery area' }).getByRole('button', { name: 'Save delivery area' }).click();
  await expectToast(page, 'Delivery area saved');
  await shot(page, '24-new-restaurant-branch');

  // Documents (numbers only) and a bank account
  await page.getByRole('tab', { name: /Documents/ }).click();
  for (const [kind, number] of [
    ['FSSAI licence / registration', '10026022009999'],
    ['PAN', 'ABCDE1234F'],
  ]) {
    await page.getByRole('button', { name: 'Add document' }).click();
    dlg = page.getByRole('dialog');
    await dlg.getByRole('combobox', { name: 'Document' }).click();
    await page.getByRole('option', { name: kind, exact: true }).click();
    await dlg.getByLabel('Number').fill(number);
    await dlg.getByRole('button', { name: 'Add document' }).click();
    await expectToast(page, `${kind} added`);
  }
  await page.getByRole('tab', { name: 'Bank accounts' }).click();
  await page.getByRole('button', { name: 'Add account' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Account holder name').fill('Shreeji Khaman House');
  await dlg.getByLabel('Account number', { exact: true }).fill('123456789012');
  await dlg.getByLabel('Confirm account number').fill('123456789012');
  await dlg.getByLabel('IFSC').fill('SBIN0001234');
  await dlg.getByRole('button', { name: 'Add account' }).click();
  await expectToast(page, 'another admin must verify it');
  // Four-eyes: the admin who entered it is not offered verification.
  await expect(page.getByText('Another admin must verify details you entered')).toBeVisible();
  await expect(page.getByText('•••• 9012')).toBeVisible();
  await expect(page.getByText('123456789012')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('heading', { name: /Shreeji Khaman House/ })).toContainText('In review');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled(); // documents and bank not verified yet
  await shot(page, '25-new-restaurant-in-review');
});

test('creates a product with sizes and a required choice; a stale edit is refused', async ({ page, browser }) => {
  await signIn(page);
  await nav(page, 'Products');
  await page.getByRole('link', { name: 'Add product' }).click();
  await page.getByRole('combobox', { name: 'Restaurant', exact: true }).click();
  await page.getByRole('option', { name: 'Jamzo Demo Kitchen' }).click();
  await page.getByRole('combobox', { name: 'Menu section' }).click();
  await page.getByRole('option', { name: 'Thalis' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rajwadi Thali');
  await page.getByRole('button', { name: 'Sell in different sizes' }).click();
  await page.getByLabel('Size 1 price').fill('199');
  await page.getByLabel('Size 2 name').fill('Unlimited');
  await page.getByLabel('Size 2 price').fill('279.50');
  await page.getByRole('button', { name: 'Add a group' }).click();
  await page.getByLabel('Group name').fill('Preparation');
  await page.getByLabel('Minimum').fill('1');
  await page.getByLabel('Group 1 option 1 name').fill('Regular');
  await page.getByRole('button', { name: 'Add option' }).click();
  await page.getByLabel('Group 1 option 2 name').fill('Jain');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expectToast(page, 'Rajwadi Thali saved');
  await expect(page.getByRole('heading', { name: /Rajwadi Thali/ })).toBeVisible();
  await expect(page.getByLabel('Size 2 price')).toHaveValue('279.50');
  await shot(page, '26-product-editor');

  // Food-type rule: an egg add-on on a veg item is refused next to the field.
  await page.getByLabel('Group 1 option 2 food type').click();
  await page.getByRole('option', { name: 'Egg' }).click();
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('A veg item cannot have egg add-ons')).toBeVisible();
  await page.getByLabel('Group 1 option 2 food type').click();
  await page.getByRole('option', { name: 'Veg', exact: true }).click();

  // A second admin session saves first → this editor's save is refused, nothing overwritten.
  const other = await browser.newPage();
  await signIn(other);
  await other.goto(page.url());
  await other.getByLabel('Name', { exact: true }).fill('Rajwadi Thali (new)');
  await other.getByRole('button', { name: 'Save product' }).click();
  await expectToast(other, 'Rajwadi Thali (new) saved');
  await other.close();
  await page.getByLabel('Size 1 price').fill('1');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your changes were not saved' })).toBeVisible();
  await shot(page, '27-product-conflict');
});

test('products list: sold-out toggle via bulk action and availability filter', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Products');
  await page.getByLabel('Search products or restaurants').fill('dosa');
  await expect(page.getByRole('row', { name: 'Open Masala Dosa' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Masala Dosa' }).click();
  await page.getByRole('checkbox', { name: 'Select Paper Dosa' }).click();
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Mark sold out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark sold out' }).click();
  await expectToast(page, '2 products updated');
  await page.getByLabel('Filter by availability').click();
  await page.getByRole('option', { name: 'Sold out' }).click();
  await expect(page.getByRole('row', { name: 'Open Masala Dosa' })).toContainText('Sold out');
  await expect(page.getByRole('row', { name: 'Open Cheese Dosa' })).toHaveCount(0);
  await shot(page, '28-products-sold-out');
});

test('food categories list', async ({ page }) => {
  await signIn(page);
  await nav(page, 'Food categories');
  await expect(page.getByRole('row', { name: /Thali/ }).first()).toBeVisible();
  await shot(page, '29-food-categories');
});
