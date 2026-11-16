import { HttpError } from './errors.js';
import { DomainError } from '../domain/errors.js';

export async function requireUser(headers, authService) {
  const match = /^Bearer\s+([A-Za-z0-9._~-]+)$/i.exec(headers?.authorization ?? '');
  if (!match) throw new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required');
  try {
    return await authService.authenticate(match[1]);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') {
      throw new HttpError(401, 'UNAUTHENTICATED', 'The access token is invalid or expired');
    }
    throw error;
  }
}

export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, 'FORBIDDEN', 'Your account does not have permission to do this');
  }
  return user;
}
