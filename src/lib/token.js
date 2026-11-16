import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_HEADER = Object.freeze({ alg: 'HS256', typ: 'JWT' });
const ROLE_SET = new Set(['attendee', 'organizer', 'staff']);

export class TokenError extends Error {
  constructor() {
    super('The access token is invalid or expired');
    this.name = 'TokenError';
  }
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new TypeError('The token secret must be at least 32 bytes');
  }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new TokenError();
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function signature(input, secret) {
  return createHmac('sha256', secret).update(input).digest();
}

export function signToken(user, secret, { now = Date.now, expiresInSeconds = 3600 } = {}) {
  assertSecret(secret);
  if (!user || typeof user.id !== 'string' || !ROLE_SET.has(user.role)) {
    throw new TypeError('A token requires a user id and valid role');
  }
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) {
    throw new TypeError('Token lifetime must be a positive number of seconds');
  }
  const issuedAt = Math.floor(now() / 1000);
  const input = `${encode(TOKEN_HEADER)}.${encode({
    sub: user.id,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  })}`;
  return `${input}.${signature(input, secret).toString('base64url')}`;
}

export function verifyToken(token, secret, { now = Date.now } = {}) {
  assertSecret(secret);
  if (typeof token !== 'string') throw new TokenError();
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError();

  let header;
  let payload;
  let suppliedSignature;
  try {
    header = decode(parts[0]);
    payload = decode(parts[1]);
    suppliedSignature = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new TokenError();
  }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') throw new TokenError();
  if (!payload || typeof payload.sub !== 'string' || !ROLE_SET.has(payload.role)
    || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)) {
    throw new TokenError();
  }

  const expectedSignature = signature(`${parts[0]}.${parts[1]}`, secret);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new TokenError();
  }
  if (payload.exp <= Math.floor(now() / 1000) || payload.iat > Math.floor(now() / 1000)) {
    throw new TokenError();
  }
  return payload;
}
