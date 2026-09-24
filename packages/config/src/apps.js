// THE single source of product identity (DECISIONS OD-3, D-15). Identifiers, names, schemes, domain
// and colours are defined here and nowhere else; ESLint rejects identifier literals elsewhere.

export const BRAND = Object.freeze({
  name: 'Jamzo',
  domain: 'jamzo.in',
  webOrigin: 'https://jamzo.in',
});

/** @typedef {'development' | 'preview' | 'production'} AppVariant */

/**
 * @typedef {object} MobileAppDefinition
 * @property {'CUSTOMER' | 'RESTAURANT' | 'RIDER'} appId
 * @property {string} slug        workspace/app folder name
 * @property {string} displayName store/home-screen name (proposal A-20)
 * @property {string} bundleId    Android applicationId and iOS bundle identifier (production)
 * @property {string} scheme      deep-link URL scheme
 * @property {string} color       placeholder brand colour for icon/splash (D-16/D-17)
 * @property {boolean} universalLinks whether https://<domain> links should open this app
 */

/** @type {Readonly<Record<'CUSTOMER' | 'RESTAURANT' | 'RIDER', MobileAppDefinition>>} */
export const MOBILE_APPS = Object.freeze({
  CUSTOMER: Object.freeze({
    appId: 'CUSTOMER',
    slug: 'customer',
    displayName: 'Jamzo',
    bundleId: 'in.jamzo.customer',
    scheme: 'jamzo',
    color: '#5B2A86',
    universalLinks: true,
  }),
  RESTAURANT: Object.freeze({
    appId: 'RESTAURANT',
    slug: 'restaurant',
    displayName: 'Jamzo Restaurant Partner',
    bundleId: 'in.jamzo.restaurant',
    scheme: 'jamzo-restaurant',
    color: '#0F766E',
    universalLinks: false,
  }),
  RIDER: Object.freeze({
    appId: 'RIDER',
    slug: 'rider',
    displayName: 'Jamzo Delivery Partner',
    bundleId: 'in.jamzo.rider',
    scheme: 'jamzo-rider',
    color: '#F2A516',
    universalLinks: false,
  }),
});

export const ADMIN_APP = Object.freeze({ appId: 'ADMIN', displayName: 'Jamzo Admin' });

const VARIANT_SUFFIX = Object.freeze({ development: '.dev', preview: '.preview', production: '' });
const VARIANT_LABEL = Object.freeze({ development: ' (Dev)', preview: ' (Preview)', production: '' });

/**
 * Identifiers for one app build variant. Development and preview builds get distinct ids so all
 * variants of all three apps can be installed side by side (MOBILE.md §1).
 * @param {'CUSTOMER' | 'RESTAURANT' | 'RIDER'} appId
 * @param {AppVariant} [variant]
 */
export function mobileIdentity(appId, variant = 'development') {
  const app = MOBILE_APPS[appId];
  if (!app) throw new Error(`Unknown mobile app "${appId}"`);
  if (!(variant in VARIANT_SUFFIX)) throw new Error(`Unknown app variant "${variant}"`);
  return {
    ...app,
    variant,
    bundleId: app.bundleId + VARIANT_SUFFIX[variant],
    name: app.displayName + VARIANT_LABEL[variant],
    scheme:
      variant === 'production'
        ? app.scheme
        : `${app.scheme}-${variant === 'development' ? 'dev' : 'preview'}`,
    associatedDomain: app.universalLinks ? BRAND.domain : null,
  };
}

/** @param {string} appId */
export const isKnownAppId = (appId) => appId === 'ADMIN' || appId in MOBILE_APPS;
