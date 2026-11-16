import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const FALLBACK_SALT = Buffer.alloc(16, 0x5a);

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  if (typeof password !== 'string') throw new TypeError('Password must be text');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string') throw new TypeError('Password must be text');
  if (typeof storedHash !== 'string') {
    await derive(password, FALLBACK_SALT);
    return false;
  }
  const [algorithm, saltText, keyText, extra] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltText || !keyText || extra !== undefined) {
    await derive(password, FALLBACK_SALT);
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltText, 'base64url');
    expected = Buffer.from(keyText, 'base64url');
  } catch {
    await derive(password, FALLBACK_SALT);
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
    await derive(password, FALLBACK_SALT);
    return false;
  }

  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
