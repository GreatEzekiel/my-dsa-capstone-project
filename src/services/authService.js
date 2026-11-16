import { DomainError, ErrorCode } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken, TokenError, verifyToken } from '../lib/token.js';

const PUBLIC_ROLES = new Set(['attendee', 'organizer']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });
const invalidCredentials = () => new DomainError(ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect');

function publicUser(user) {
  const { passwordHash, ...visible } = user;
  return visible;
}

function normalizedEmail(value) {
  if (typeof value !== 'string') throw bad('email', 'must be a valid email address');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw bad('email', 'must be a valid email address');
  return email;
}

function validPassword(value) {
  if (typeof value !== 'string' || Array.from(value).length < 8 || Array.from(value).length > 128) {
    throw bad('password', 'must be between 8 and 128 characters');
  }
  return value;
}

export function createAuthService({ repository, tokenSecret, now = Date.now }) {
  if (!repository) throw new TypeError('createAuthService needs a repository');
  if (typeof tokenSecret !== 'string' || Buffer.byteLength(tokenSecret) < 32) {
    throw new TypeError('createAuthService needs a token secret of at least 32 bytes');
  }

  async function createAccount(emailInput, passwordInput, role) {
    const email = normalizedEmail(emailInput);
    const password = validPassword(passwordInput);
    const user = {
      id: newId(),
      email,
      passwordHash: await hashPassword(password),
      role,
      createdAt: new Date(now()).toISOString(),
    };
    const created = await repository.createUser(user);
    if (!created) throw new DomainError(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
    return publicUser(created);
  }

  function sessionFor(user) {
    return { token: signToken(user, tokenSecret, { now }), user: publicUser(user) };
  }

  return Object.freeze({
    async signup(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw bad('body', 'must be an object');
      }
      const role = input.role ?? 'attendee';
      if (role === 'staff') {
        throw new DomainError(ErrorCode.FORBIDDEN, 'Staff accounts must be provisioned by an administrator');
      }
      if (typeof role !== 'string' || !PUBLIC_ROLES.has(role)) {
        throw bad('role', 'must be attendee or organizer');
      }
      const user = await createAccount(input.email, input.password, role);
      return sessionFor(user);
    },

    async provisionStaff({ email, password }) {
      const user = await createAccount(email, password, 'staff');
      return user;
    },

    async login(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw bad('body', 'must be an object');
      }
      const email = normalizedEmail(input.email);
      const password = validPassword(input.password);
      const user = await repository.getUserByEmail(email);
      if (!user || !await verifyPassword(password, user.passwordHash)) {
        throw invalidCredentials();
      }
      return sessionFor(user);
    },

    async authenticate(token) {
      let payload;
      try {
        payload = verifyToken(token, tokenSecret, { now });
      } catch (error) {
        if (!(error instanceof TokenError)) throw error;
        throw new DomainError(ErrorCode.UNAUTHENTICATED, 'The access token is invalid or expired');
      }
      const user = await repository.getUserById(payload.sub);
      if (!user || user.role !== payload.role) {
        throw new DomainError(ErrorCode.UNAUTHENTICATED, 'The access token is invalid or expired');
      }
      return publicUser(user);
    },
  });
}
