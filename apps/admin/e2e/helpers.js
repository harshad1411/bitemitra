import { expect } from '@playwright/test';
import { E2E_ADMIN } from './global-setup.js';

export async function signIn(page, creds = E2E_ADMIN, { expectSuccess = true } = {}) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait until the session exists: a test that navigates straight away must not race the sign-in.
  if (expectSuccess) await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export const shot = (page, name) =>
  page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

export async function expectToast(page, text) {
  await expect(page.getByText(text).first()).toBeVisible();
}

/** Click an entry in the main navigation (sidebar). */
export const nav = (page, name) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
