// S02: As an organizer, I want to create an event with title, city, venue and date, so that people can find it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createEvent, listEventSummaries, listEvents } from '../src/domain/inventory.js';
import { code, deepFreeze, inDays } from './helpers.js';

const valid = () => ({ title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Landmark Centre', startsAt: inDays(30) });
const everything = (store) => listEventSummaries(store, { publishedOnly: false });

test('S02: a valid event is saved as a draft with a new id, and is not on the public list', () => {
  const store = createStore();
  const event = createEvent(store, valid());

  assert.equal(event.status, 'draft');
  assert.equal(typeof event.id, 'string');
  assert.ok(event.id.length > 0);
  assert.equal(event.title, 'Lagos Tech Meetup');
  assert.equal(event.city, 'Lagos');
  assert.equal(event.venue, 'Landmark Centre');

  assert.deepEqual(listEventSummaries(store), []); // the public list is empty
  assert.equal(everything(store).length, 1); // ...but it IS saved
  assert.equal(everything(store)[0].id, event.id);
  assert.equal(listEvents(store)[0].status, 'draft');
});

test('S02: every event gets its own new id', () => {
  const store = createStore();
  const a = createEvent(store, valid());
  const b = createEvent(store, valid());
  assert.notEqual(a.id, b.id);
});

test('S02: a missing or blank title or city is rejected with VALIDATION, and nothing is saved', () => {
  const store = createStore();
  for (const [field, value] of [
    ['title', undefined], ['title', ''], ['title', '   '], ['title', 42],
    ['city', undefined], ['city', ''], ['city', '   '], ['city', null],
  ]) {
    assert.equal(code(() => createEvent(store, { ...valid(), [field]: value })), 'VALIDATION', `${field}=${JSON.stringify(value)}`);
  }
  assert.equal(everything(store).length, 0);
});

test('S02: a venue is also required', () => {
  const store = createStore();
  assert.equal(code(() => createEvent(store, { ...valid(), venue: '' })), 'VALIDATION');
  assert.equal(everything(store).length, 0);
});

test('S02: a date that is not a real date is rejected with VALIDATION, and nothing is saved', () => {
  const store = createStore();
  for (const startsAt of [
    undefined, '', 'not a date', 'next friday', '2026-02-30', '2026-13-01', '2026-12-05T25:00:00Z', 20261205, new Date(),
  ]) {
    assert.equal(code(() => createEvent(store, { ...valid(), startsAt })), 'VALIDATION', `startsAt=${String(startsAt)}`);
  }
  assert.equal(everything(store).length, 0);
});

test('S02: no input at all is a VALIDATION error, not a crash', () => {
  const store = createStore();
  for (const input of [undefined, null, 'text', 5, []]) {
    assert.equal(code(() => createEvent(store, input)), 'VALIDATION');
  }
  assert.equal(everything(store).length, 0);
});

test('S02: text is trimmed, and the input object is never changed', () => {
  const store = createStore();
  const input = deepFreeze({ title: '  Jazz Night ', city: ' Abuja ', venue: ' Hall ', startsAt: inDays(5) });
  const event = createEvent(store, input); // a frozen input would throw if the function tried to edit it
  assert.equal(event.title, 'Jazz Night');
  assert.equal(event.city, 'Abuja');
});

test('S02: the older field names `name` and `date` still work', () => {
  const store = createStore();
  const event = createEvent(store, { name: 'Old Style', city: 'Lagos', venue: 'V', date: inDays(3) });
  assert.equal(event.title, 'Old Style');
});

test('S02: the returned event is a copy: editing it cannot change what is stored', () => {
  const store = createStore();
  const event = createEvent(store, valid());
  event.title = 'HACKED';
  event.tierIds.push('fake');
  assert.equal(everything(store)[0].title, 'Lagos Tech Meetup');
  assert.equal(everything(store)[0].tierCount, 0);
});
