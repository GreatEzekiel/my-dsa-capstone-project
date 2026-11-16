const SESSION_KEY = 'event-ticketing-session';
const ROLES = new Set(['attendee', 'organizer', 'staff']);

export function getSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  try {
    const session = JSON.parse(saved);
    if (typeof session.token === 'string' && session.token
      && typeof session.user?.id === 'string' && ROLES.has(session.user.role)) {
      return session;
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  localStorage.removeItem(SESSION_KEY);
  return null;
}

export function saveSession(session) {
  if (typeof session?.token !== 'string' || typeof session.user?.id !== 'string'
    || !ROLES.has(session.user.role)) {
    throw new TypeError('The API returned an invalid session');
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
