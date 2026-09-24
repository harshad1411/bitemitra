// Parses the first-party client headers (API.md §2) into request.client.
import { CLIENT_HEADERS } from '@jamzo/shared-types';
import { isKnownAppId } from '@jamzo/config';
import { AppError } from './errors.js';

const PLATFORMS = new Set(['IOS', 'ANDROID', 'WEB']);

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {{ required: boolean }} opts
 */
export function readClient(request, { required }) {
  const appId = String(request.headers[CLIENT_HEADERS.appId] ?? '').toUpperCase() || null;
  const platform = String(request.headers[CLIENT_HEADERS.platform] ?? '').toUpperCase() || null;
  const appVersion = request.headers[CLIENT_HEADERS.appVersion]
    ? String(request.headers[CLIENT_HEADERS.appVersion]).slice(0, 40)
    : null;
  if (!appId) {
    if (required)
      throw new AppError('VALIDATION_FAILED', 'Missing x-app-id header.', {
        fieldErrors: { 'x-app-id': ['Required'] },
      });
    return { appId: null, platform, appVersion };
  }
  if (!isKnownAppId(appId))
    throw new AppError('VALIDATION_FAILED', 'Unknown x-app-id.', {
      fieldErrors: { 'x-app-id': ['Unknown app'] },
    });
  if (platform && !PLATFORMS.has(platform)) {
    throw new AppError('VALIDATION_FAILED', 'Unknown x-platform.', {
      fieldErrors: { 'x-platform': ['Use IOS, ANDROID or WEB'] },
    });
  }
  if (appId !== 'ADMIN' && required && !platform) {
    throw new AppError('VALIDATION_FAILED', 'Missing x-platform header.', {
      fieldErrors: { 'x-platform': ['Required for mobile apps'] },
    });
  }
  return { appId, platform: platform ?? (appId === 'ADMIN' ? 'WEB' : null), appVersion };
}

export const ACTOR_TYPE_BY_APP = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  RESTAURANT: 'RESTAURANT_USER',
  RIDER: 'RIDER',
  ADMIN: 'ADMIN',
});
