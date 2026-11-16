import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signToken, verifyToken } from '../src/lib/token.js';
import { apiClient, expectError, startApp, TEST_TOKEN_SECRET } from './http-helpers.js';

const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

let server;
let api;
before(async () => {
  server = await startApp();
  api = apiClient(server.url);
});
after(() => server.close());

async function signup(email, role = 'attendee') {
  return api.post('/api/auth/signup', { email, password: 'correct-horse-battery', role });
}

test('signup hashes passwords, returns a signed token, and never returns the hash', async () => {
  const response = await signup('private@example.test');
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'attendee');
  assert.equal(typeof response.body.token, 'string');
  assert.equal(Object.hasOwn(response.body.user, 'passwordHash'), false);

  const user = await server.repository.getUserByEmail('private@example.test');
  assert.match(user.passwordHash, /^scrypt\$/);
  assert.notEqual(user.passwordHash, 'correct-horse-battery');
});

test('signup rejects duplicate email and does not allow public staff creation', async () => {
  await signup('duplicate@example.test');
  expectError(await signup('DUPLICATE@example.test'), 409, 'EMAIL_TAKEN');
  expectError(await signup('staff@example.test', 'staff'), 403, 'FORBIDDEN');
  assert.equal(await server.repository.getUserByEmail('staff@example.test'), null);
});

test('unknown email and incorrect password return the same INVALID_CREDENTIALS response', async () => {
  await signup('known@example.test');
  const wrongPassword = await api.post('/api/auth/login', {
    email: 'known@example.test', password: 'wrong-password',
  });
  const unknownEmail = await api.post('/api/auth/login', {
    email: 'unknown@example.test', password: 'wrong-password',
  });
  expectError(wrongPassword, 401, 'INVALID_CREDENTIALS');
  expectError(unknownEmail, 401, 'INVALID_CREDENTIALS');
  assert.equal(wrongPassword.body.error.message, unknownEmail.body.error.message);
});

test('missing, edited, and expired tokens cannot access protected routes', async () => {
  const missing = await api.get('/api/bookings', { Authorization: '' });
  expectError(missing, 401, 'UNAUTHENTICATED');

  const user = (await signup('token@example.test')).body.user;
  const valid = signToken(user, TEST_TOKEN_SECRET);
  const [header, payload, signature] = valid.split('.');
  const edited = `${header}.${Buffer.from(JSON.stringify({ sub: user.id, role: user.role, iat: 1, exp: 9999999999 })).toString('base64url')}.${signature}`;
  expectError(await api.get('/api/bookings', { Authorization: `Bearer ${edited}` }), 401, 'UNAUTHENTICATED');

  const expired = signToken(user, TEST_TOKEN_SECRET, {
    now: () => Date.now() - 10_000,
    expiresInSeconds: 1,
  });
  expectError(await api.get('/api/bookings', { Authorization: `Bearer ${expired}` }), 401, 'UNAUTHENTICATED');
});

test('token verification rejects an HS256-signed token whose header names another algorithm', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-1', role: 'attendee', iat: 1, exp: 9_999_999_999 })).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', TEST_TOKEN_SECRET).update(input).digest('base64url');
  assert.throws(() => verifyToken(`${input}.${signature}`, TEST_TOKEN_SECRET), { name: 'TokenError' });
});

test('role and event ownership checks are enforced by the API', async () => {
  const attendee = await signup('attendee-role@example.test');
  const attendeeResponse = await api.post('/api/events', {
    title: 'Forbidden event', city: 'Lagos', venue: 'Hall', startsAt: future(),
  }, { Authorization: `Bearer ${attendee.body.token}` });
  expectError(attendeeResponse, 403, 'FORBIDDEN');

  const organizerA = (await signup('organizer-a@example.test', 'organizer')).body;
  const organizerB = (await signup('organizer-b@example.test', 'organizer')).body;
  const created = await api.post('/api/events', {
    title: 'Owned event', city: 'Lagos', venue: 'Hall', startsAt: future(),
  }, { Authorization: `Bearer ${organizerA.token}` });
  const eventId = created.body.event.id;
  expectError(await api.post(`/api/events/${eventId}/publish`, undefined, {
    Authorization: `Bearer ${organizerB.token}`,
  }), 403, 'FORBIDDEN');
  expectError(await api.post(`/api/events/${eventId}/tiers`, {
    name: 'General', priceCents: 500, capacity: 3,
  }, { Authorization: `Bearer ${organizerB.token}` }), 403, 'FORBIDDEN');
});

test('attendees can list only their own bookings and cannot read another attendee’s booking', async () => {
  const organizer = (await signup('booking-owner-organizer@example.test', 'organizer')).body;
  const firstAttendee = (await signup('first-attendee@example.test')).body;
  const secondAttendee = (await signup('second-attendee@example.test')).body;
  const event = (await api.post('/api/events', {
    title: 'Private booking event', city: 'Abuja', venue: 'Hall', startsAt: future(),
  }, { Authorization: `Bearer ${organizer.token}` })).body.event;
  const tier = (await api.post(`/api/events/${event.id}/tiers`, {
    name: 'General', priceCents: 500, capacity: 5,
  }, { Authorization: `Bearer ${organizer.token}` })).body.tier;
  await api.post(`/api/events/${event.id}/publish`, undefined, {
    Authorization: `Bearer ${organizer.token}`,
  });
  const firstBooking = await api.post('/api/bookings', {
    eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada',
  }, { Authorization: `Bearer ${firstAttendee.token}` });
  await api.post('/api/bookings', {
    eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Bola',
  }, { Authorization: `Bearer ${secondAttendee.token}` });

  const ownBookings = await api.get('/api/bookings', {
    Authorization: `Bearer ${firstAttendee.token}`,
  });
  assert.equal(ownBookings.body.bookings.length, 1);
  assert.equal(ownBookings.body.bookings[0].customer, 'Ada');
  expectError(await api.get(`/api/bookings/${firstBooking.body.booking.reference}`, {
    Authorization: `Bearer ${secondAttendee.token}`,
  }), 403, 'FORBIDDEN');
});

test('pending bookings expire after 24 hours, release seats, and cannot be paid', async () => {
  let now = Date.now();
  const clocked = await startApp({ now: () => now, authNow: () => Date.now() });
  try {
    const clockApi = apiClient(clocked.url);
    const organizer = (await clockApi.post('/api/auth/signup', {
      email: 'expiry-organizer@example.test', password: 'correct-horse-battery', role: 'organizer',
    })).body;
    const attendee = (await clockApi.post('/api/auth/signup', {
      email: 'expiry-attendee@example.test', password: 'correct-horse-battery',
    })).body;
    const event = (await clockApi.post('/api/events', {
      title: 'Expiring booking', city: 'Lagos', venue: 'Hall',
      startsAt: new Date(now + 30 * 86_400_000).toISOString(),
    }, { Authorization: `Bearer ${organizer.token}` })).body.event;
    const tier = (await clockApi.post(`/api/events/${event.id}/tiers`, {
      name: 'General', priceCents: 500, capacity: 1,
    }, { Authorization: `Bearer ${organizer.token}` })).body.tier;
    await clockApi.post(`/api/events/${event.id}/publish`, undefined, {
      Authorization: `Bearer ${organizer.token}`,
    });
    const bookingResponse = await clockApi.post('/api/bookings', {
      eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada',
    }, { Authorization: `Bearer ${attendee.token}` });
    const booking = bookingResponse.body.booking;
    assert.equal(Date.parse(booking.expiresAt), now + 24 * 60 * 60 * 1000);

    now += 24 * 60 * 60 * 1000 + 1;
    expectError(await clockApi.post(`/api/bookings/${booking.reference}/pay`, {}, {
      Authorization: `Bearer ${attendee.token}`,
    }), 409, 'BOOKING_EXPIRED');
    assert.equal((await clockApi.get(`/api/events/${event.id}`)).body.event.tiers[0].sold, 0);
    assert.equal((await clockApi.get(`/api/bookings/${booking.reference}`, {
      Authorization: `Bearer ${attendee.token}`,
    })).body.booking.status, 'cancelled');
    assert.equal((await clockApi.post('/api/bookings', {
      eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Bola',
    }, { Authorization: `Bearer ${attendee.token}` })).status, 201);
  } finally {
    await clocked.close();
  }
});
