// services.test.js: the service layer (no HTTP anywhere in these tests).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/services/index.js';
import { createStore } from '../src/domain/inventory.js';
import { queryToCriteria } from '../src/services/eventService.js';
import { seedDemoData } from '../src/services/demoData.js';
import { code } from './helpers.js';

test('health.check() answers { status: "ok" }', () => {
  assert.deepEqual(createServices().health.check(), { status: 'ok' });
});

test('every call gets its own object, so editing one answer cannot change the next', () => {
  const { health } = createServices();
  const first = health.check();
  first.status = 'hacked';
  assert.deepEqual(health.check(), { status: 'ok' });
});

test('the services object and each service are frozen', () => {
  const services = createServices();
  assert.throws(() => { services.health = null; }, TypeError);
  assert.throws(() => { services.health.check = () => 'hacked'; }, TypeError);
});

// ---------- the event and booking services (no HTTP anywhere) ----------


const future = () => new Date(Date.now() + 10 * 86_400_000).toISOString();

test('queryToCriteria: text from a URL becomes numbers and booleans, and empty means "not given"', () => {
  assert.deepEqual(queryToCriteria({ maxPriceCents: '500000', onlyAvailable: 'true', city: 'Lagos', sort: 'price' }), {
    criteria: { q: undefined, city: 'Lagos', from: undefined, to: undefined, maxPriceCents: 500000, onlyAvailable: true },
    sort: 'price',
  });
  assert.equal(queryToCriteria({ onlyAvailable: 'false' }).criteria.onlyAvailable, false);
  assert.deepEqual(queryToCriteria({ q: '', city: '', sort: '', maxPriceCents: '' }).criteria.q, undefined);
  assert.equal(queryToCriteria({}).sort, 'date');
  assert.equal(queryToCriteria().sort, 'date');
});

test('queryToCriteria leaves bad values as text so the rules can refuse them, and refuses unknown options itself', () => {
  assert.equal(queryToCriteria({ maxPriceCents: '9.99' }).criteria.maxPriceCents, '9.99');
  assert.equal(queryToCriteria({ onlyAvailable: 'yes' }).criteria.onlyAvailable, 'yes');
  assert.equal(code(() => queryToCriteria({ citty: 'Lagos' })), 'VALIDATION');
  assert.equal(code(() => queryToCriteria({ page: '2' })), 'VALIDATION');
});

test('the event service: create, add a tier, publish, search, without any web server', () => {
  const store = createStore();
  const { events } = createServices({ store });
  const event = events.create({ title: 'Jazz', city: 'Abuja', venue: 'Park', startsAt: future() });
  assert.equal(event.status, 'draft');
  assert.deepEqual(events.search({}), { count: 0, events: [] }); // a draft is not on the list
  assert.equal(code(() => events.publish(event.id)), 'INVALID_STATE'); // no tier yet
  events.addTier(event.id, { name: 'GA', priceCents: 1000, capacity: 5 });
  assert.equal(events.publish(event.id).status, 'published');
  assert.equal(events.search({ q: 'jazz' }).count, 1);
  assert.equal(events.get(event.id).tiers[0].seatsLeft, 5);
  assert.equal(code(() => events.get('nope')), 'NOT_FOUND');
  assert.equal(code(() => events.search({ sort: 'popularity' })), 'VALIDATION');
});

test('the booking service: book, find, cancel, and the practice transition', () => {
  const store = createStore();
  const { events, bookings } = createServices({ store });
  const event = events.create({ title: 'Jazz', city: 'Abuja', venue: 'Park', startsAt: future() });
  const tier = events.addTier(event.id, { name: 'GA', priceCents: 1000, capacity: 3 });
  events.publish(event.id);

  const booking = bookings.book({ eventId: event.id, tierId: tier.id, quantity: 2, customer: 'Ada' });
  assert.equal(booking.status, 'pending');
  assert.equal(bookings.get(booking.reference.toLowerCase()).id, booking.id);
  assert.equal(bookings.transition(booking.reference, 'paid').status, 'paid');
  assert.equal(code(() => bookings.transition(booking.reference, undefined)), 'VALIDATION');
  assert.equal(code(() => bookings.transition(booking.reference, 'pending')), 'INVALID_TRANSITION');
  assert.deepEqual(Object.keys(bookings.cancel(booking.reference)).sort(), ['booking', 'seatsLeft']);
  assert.equal(code(() => bookings.transition(booking.reference, 'paid')), 'INVALID_TRANSITION'); // paying a cancelled booking
});

test('demo data: four published events and one draft, all in the future', () => {
  const store = createStore();
  const services = createServices({ store });
  seedDemoData(store);
  assert.equal(services.events.search({}).count, 4);
  assert.ok(services.events.search({ q: 'Ibadan' }).count === 0); // the draft is hidden
  assert.ok(services.events.search({}).events.every((e) => Date.parse(e.startsAt) > Date.now()));
});
