// argon2id password hashing (SECURITY.md §1). Parameters follow OWASP's argon2id guidance.
import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** @param {string} password */
export const hashPassword = (password) => hash(password, OPTIONS);

/**
 * @param {string} passwordHash
 * @param {string} password
 */
export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash = no match; never throw details to callers
  }
}

/** A constant hash used to spend the same time when the user does not exist (no user enumeration). */
export const DUMMY_PASSWORD_HASH = await hashPassword('jamzo-dummy-password-for-timing');
