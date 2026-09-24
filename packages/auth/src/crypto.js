// Application-layer field encryption for sensitive values such as bank account numbers (DECISIONS D-35).
// AES-256-GCM with a random 96-bit IV per value. Ciphertext: "<keyId>.<iv>.<tag>.<data>" (base64url parts).
// keyId is derived from the key itself, so decrypting with the wrong key fails loudly instead of returning
// garbage, and a future key rotation can tell old and new ciphertexts apart.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * @param {string} base64Key 32 random bytes, base64 or base64url
 */
export function createFieldCipher(base64Key) {
  const key = Buffer.from(String(base64Key ?? ''), 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  const keyId = createHash('sha256').update(key).digest('base64url').slice(0, 8);
  return {
    keyId,
    /** @param {string} plaintext */
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(keyId));
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return [
        keyId,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        data.toString('base64url'),
      ].join('.');
    },
    /** @param {string} ciphertext */
    decrypt(ciphertext) {
      const [id, iv, tag, data] = String(ciphertext).split('.');
      if (!data) throw new Error('Malformed ciphertext');
      if (id !== keyId) throw new Error(`Ciphertext was encrypted with a different key (${id})`);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(keyId));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
