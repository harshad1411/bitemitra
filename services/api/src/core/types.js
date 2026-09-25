// JSDoc type definitions for the API (checked by `pnpm typecheck` — DECISIONS D-1). Plain JavaScript:
// no .d.ts files, so Fastify's decorated properties are described here and applied via annotations.

/**
 * @typedef {object} AdminAccess
 * @property {string} id
 * @property {boolean} isActive
 * @property {{ key: string, name: string, cityId: string | null }[]} roles
 * @property {Set<string>} global permissions granted everywhere
 * @property {Map<string, Set<string>>} byCity permissions granted for one city
 */

/**
 * @typedef {object} RequestAuth
 * @property {string} userId
 * @property {string} sessionId
 * @property {string} familyId
 * @property {string} appId
 * @property {string} actorType
 * @property {any} user
 * @property {AdminAccess | null} admin
 */

/**
 * @typedef {object} RequestClient
 * @property {string | null} appId
 * @property {string | null} platform
 * @property {string | null} appVersion
 */

/** @typedef {import('fastify').FastifyRequest & { auth: RequestAuth | null, client: RequestClient }} JamzoRequest */

/**
 * @typedef {import('fastify').FastifyInstance & {
 *   prisma: import('@jamzo/database').Db,
 *   clock: { now: () => Date },
 *   services: { env: any, config: any, auth: any, storage: import('../modules/media/storage.js').Storage, sms: any, email: any, fieldCipher: ReturnType<typeof import('@jamzo/auth').createFieldCipher>, distance: import('../modules/delivery/distance.js').DistanceProvider, mediaBase: string, dispatch: ReturnType<typeof import('../modules/dispatch/service.js').createDispatch>, trips: ReturnType<typeof import('../modules/dispatch/trips.js').createTrips>, otpSecret: string },
 * }} JamzoApp
 */

export {};
