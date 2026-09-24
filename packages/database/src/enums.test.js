import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as types from '@jamzo/shared-types';

const design = await readFile(new URL('../prisma/design/schema.design.prisma', import.meta.url), 'utf8');
const prismaEnum = (name) => {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(design);
  if (!m) throw new Error(`enum ${name} not found`);
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
};

describe('shared-types mirror the database enums', () => {
  it.each([
    ['AppId', 'APP_IDS'],
    ['DevicePlatform', 'DEVICE_PLATFORMS'],
    ['UserStatus', 'USER_STATUSES'],
    ['AuthProvider', 'AUTH_PROVIDERS'],
    ['OtpChannel', 'OTP_CHANNELS'],
    ['ConfigScope', 'CONFIG_SCOPES'],
    ['ActorType', 'ACTOR_TYPES'],
    ['RestaurantOnboardingStatus', 'RESTAURANT_ONBOARDING_STATUSES'],
    ['RiderOnboardingStatus', 'RIDER_ONBOARDING_STATUSES'],
    ['RestaurantUserRole', 'RESTAURANT_USER_ROLES'],
    ['MediaKind', 'MEDIA_KINDS'],
  ])('%s', (prismaName, exportName) => {
    expect(Object.keys(types[exportName])).toEqual(prismaEnum(prismaName));
  });
});
