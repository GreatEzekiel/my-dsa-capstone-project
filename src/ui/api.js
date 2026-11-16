import { getSession } from './session.js';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function unavailableApi(status) {
  return new ApiError(
    'API_UNAVAILABLE',
    'The API server is unavailable. Start it with npm start, then try again.',
    status,
  );
}

export async function requestJson(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    const session = getSession();
    response = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the API. Start the server and try again.', 0);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text === '' ? {} : JSON.parse(text);
  } catch {
    if (!response.ok && response.status >= 500) throw unavailableApi(response.status);
    throw new ApiError('BAD_RESPONSE', `The API returned invalid JSON (${response.status})`, response.status);
  }

  if (!response.ok) {
    const error = payload?.error;
    if (response.status >= 500
      && (typeof error?.code !== 'string' || typeof error?.message !== 'string')) {
      throw unavailableApi(response.status);
    }
    throw new ApiError(
      typeof error?.code === 'string' ? error.code : 'BAD_RESPONSE',
      typeof error?.message === 'string' ? error.message : `The API request failed (${response.status})`,
      response.status,
    );
  }
  return payload;
}
