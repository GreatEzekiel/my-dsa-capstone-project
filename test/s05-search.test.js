// S05: As an attendee, I want to search, filter and sort published events, so that I can find one I like.
// The search functions are PURE (a list in, a new list out), so most tests use hand-made summaries.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEvents, sortEvents, searchEvents } from '../src/domain/eventSearch.js';
import {
  createStore, createEvent, addTier, publishEvent, bookTickets, listEventSummaries,
} from '../src/domain/inventory.js';
import { code, deepFreeze, inDays, summary } from './helpers.js';

const titles = (list) => list.map((e) => e.title);

// ---------- the acceptance criteria, one test each ----------

test('S05: searching "JAZZ" returns only Abuja Jazz Night', () => {
  const events = [summary({ title: 'Lagos Tech Meetup' }), summary({ title: 'Abuja Jazz Night' })];
  assert.deepEqual(titles(filterEvents(events, { q: 'JAZZ' })), ['Abuja Jazz Night']);
});

test('S05: filtering by city "lagos" returns only the Lagos events, whatever the capital letters', () => {
  const events = [
    summary({ title: 'A', city: 'Lagos' }), summary({ title: 'B', city: 'Abuja' }),
    summary({ title: 'C', city: 'LAGOS' }), summary({ title: 'D', city: 'Lagos Island' }),
  ];
  // "Lagos Island" is a different city: the match is exact, ignoring case only.
  assert.deepEqual(titles(filterEvents(events, { city: 'lagos' })), ['A', 'C']);
  assert.deepEqual(titles(filterEvents(events, { city: ' LaGoS ' })), ['A', 'C']);
});

test('S05: a max price + sort by price returns only events whose CHEAPEST tier is within the max, cheapest first, and leaves out events with no tiers', () => {
  const events = [
    summary({ title: 'Pricey', minPriceCents: 800_000 }),
    summary({ title: 'Cheap', minPriceCents: 200_000 }),
    summary({ title: 'No tiers', minPriceCents: null, tierCount: 0 }),
    summary({ title: 'Mid', minPriceCents: 500_000 }),
    summary({ title: 'Free', minPriceCents: 0 }),
  ];
  const result = searchEvents(events, { maxPriceCents: 500_000 }, 'price');
  assert.deepEqual(titles(result), ['Free', 'Cheap', 'Mid']); // 500000 itself is allowed: "within" the max
});

test('S05: sorting by date puts the earlier event first; events starting at the same moment stay in title order', () => {
  const events = [
    summary({ title: 'Zebra Show', startsAt: '2026-12-05T18:00:00+01:00' }),
    summary({ title: 'Mango Fest', startsAt: '2026-12-06T18:00:00+01:00' }),
    summary({ title: 'Alpha Show', startsAt: '2026-12-05T10:00:00+01:00' }), // same day as Zebra, but earlier
    summary({ title: 'Banana Fest', startsAt: '2026-12-06T18:00:00+01:00' }), // same moment as Mango
  ];
  assert.deepEqual(titles(sortEvents(events, 'date')), ['Alpha Show', 'Zebra Show', 'Banana Fest', 'Mango Fest']);
});

test('S05: an event at 5 PM on 5 December is included when filtering up to the date 2026-12-05', () => {
  const evening = summary({ title: 'Evening', startsAt: '2026-12-05T17:00:00+01:00' });
  const nextDay = summary({ title: 'Next day', startsAt: '2026-12-06T00:00:00+01:00' });
  assert.deepEqual(titles(filterEvents([evening, nextDay], { to: '2026-12-05' })), ['Evening']);
});

test('S05: a bad date, a price that is not a whole number, or an unknown sort option is rejected with VALIDATION', () => {
  const events = [summary()];
  for (const bad of [
    { from: 'tomorrow' }, { to: '2026-02-30' }, { from: '05/12/2026' }, { to: 20261205 },
    { maxPriceCents: 9.99 }, { maxPriceCents: '500000' }, { maxPriceCents: -1 }, { maxPriceCents: NaN },
    { onlyAvailable: 'yes' }, { q: 123 }, { city: ['Lagos'] },
  ]) {
    assert.equal(code(() => filterEvents(events, bad)), 'VALIDATION', JSON.stringify(bad));
    assert.equal(code(() => filterEvents([], bad)), 'VALIDATION', `${JSON.stringify(bad)} on an EMPTY list`);
  }
  for (const sortBy of ['popularity', '', 'DATE', 'toString', undefined, null, 5]) {
    assert.equal(code(() => sortEvents(events, sortBy)), 'VALIDATION', `sortBy=${String(sortBy)}`);
    assert.equal(code(() => sortEvents([], sortBy)), 'VALIDATION', `sortBy=${String(sortBy)} on an EMPTY list`);
  }
  assert.equal(code(() => searchEvents(events, {}, 'popularity')), 'VALIDATION');
  assert.equal(code(() => filterEvents('not a list', {})), 'VALIDATION');
  assert.equal(code(() => sortEvents(null, 'date')), 'VALIDATION');
});

test('S05: the original list is unchanged after searching, filtering and sorting', () => {
  const original = [
    summary({ title: 'C', city: 'Lagos', minPriceCents: 300, seatsLeft: 5, startsAt: '2026-12-09T10:00:00+01:00' }),
    summary({ title: 'A', city: 'Abuja', minPriceCents: 100, seatsLeft: 50, startsAt: '2026-12-07T10:00:00+01:00' }),
    summary({ title: 'B', city: 'Lagos', minPriceCents: null, seatsLeft: 0, startsAt: '2026-12-08T10:00:00+01:00' }),
  ];
  const before = structuredClone(original);
  deepFreeze(original); // any attempt to change the list or the events would throw a TypeError

  for (const sortBy of ['date', 'price', 'availability']) {
    sortEvents(original, sortBy);
    searchEvents(original, { city: 'lagos', maxPriceCents: 1000, onlyAvailable: true }, sortBy);
  }
  filterEvents(original, { q: 'a', from: '2026-12-01', to: '2026-12-31' });

  assert.deepEqual(original, before);
});

test('S05: results are always NEW arrays, even with no criteria and even for a one-item list', () => {
  const one = [summary()];
  const many = [summary(), summary()];
  assert.notEqual(filterEvents(many, {}), many);
  assert.notEqual(filterEvents(many), many); // criteria left out entirely
  assert.notEqual(sortEvents(one, 'date'), one);
  assert.notEqual(searchEvents(many, {}, 'price'), many);
  assert.deepEqual(filterEvents(many, {}), many);
});

// ---------- the other rules from the brief ----------

test('S05 (q): matches the title OR the venue, ignores case, and ignores spaces around the search text', () => {
  const events = [
    summary({ title: 'Concert', venue: 'Jabi Lake Park' }),
    summary({ title: 'Jabi Night', venue: 'Hall' }),
    summary({ title: 'Other', venue: 'Elsewhere' }),
  ];
  assert.deepEqual(titles(filterEvents(events, { q: '  JABI ' })), ['Concert', 'Jabi Night']);
  assert.deepEqual(titles(filterEvents(events, { q: '' })), ['Concert', 'Jabi Night', 'Other']); // empty = no filter
});

test('S05 (dates): from and to are inclusive, down to the exact moment', () => {
  const e = summary({ title: 'E', startsAt: '2026-12-05T17:00:00+01:00' }); // = 16:00 UTC
  assert.equal(filterEvents([e], { to: '2026-12-05T16:00:00Z' }).length, 1); // the same instant: included
  assert.equal(filterEvents([e], { to: '2026-12-05T15:59:59Z' }).length, 0); // one second earlier: excluded
  assert.equal(filterEvents([e], { from: '2026-12-05T16:00:00Z' }).length, 1);
  assert.equal(filterEvents([e], { from: '2026-12-05T16:00:01Z' }).length, 0);
});

test('S05 (dates): a date-only from starts at the beginning of the day, a date-only to ends at the end of it', () => {
  const lateNight = summary({ title: 'Late', startsAt: '2026-12-05T23:59:00+01:00' });
  const earlyMorning = summary({ title: 'Early', startsAt: '2026-12-05T00:00:00+01:00' });
  const both = [lateNight, earlyMorning];
  assert.deepEqual(titles(filterEvents(both, { from: '2026-12-05', to: '2026-12-05' })), ['Late', 'Early']);
  assert.deepEqual(titles(filterEvents(both, { from: '2026-12-06' })), []);
  assert.deepEqual(titles(filterEvents(both, { to: '2026-12-04' })), []);
});

test('S05 (dates): a time with no zone means Lagos time, so results do not depend on the computer', () => {
  const e = summary({ startsAt: '2026-12-05T17:00:00' }); // 17:00 in Lagos = 16:00 UTC
  assert.equal(filterEvents([e], { to: '2026-12-05T16:00:00Z' }).length, 1);
  assert.equal(filterEvents([e], { to: '2026-12-05T15:59:00Z' }).length, 0);
});

test('S05 (dates): a range works, and from after to simply finds nothing', () => {
  const events = ['2026-12-01', '2026-12-10', '2026-12-20'].map((d, i) => summary({ title: `E${i}`, startsAt: `${d}T12:00:00+01:00` }));
  assert.deepEqual(titles(filterEvents(events, { from: '2026-12-05', to: '2026-12-15' })), ['E1']);
  assert.deepEqual(filterEvents(events, { from: '2026-12-15', to: '2026-12-05' }), []);
});

test('S05 (onlyAvailable): hides events with no seats left', () => {
  const events = [summary({ title: 'Open', seatsLeft: 1 }), summary({ title: 'Full', seatsLeft: 0 })];
  assert.deepEqual(titles(filterEvents(events, { onlyAvailable: true })), ['Open']);
  assert.deepEqual(titles(filterEvents(events, { onlyAvailable: false })), ['Open', 'Full']);
});

test('S05 (price): the price filter uses the cheapest tier; a price of 0 is a real price, not "no price"', () => {
  const events = [summary({ title: 'Free', minPriceCents: 0 }), summary({ title: 'None', minPriceCents: null })];
  assert.deepEqual(titles(filterEvents(events, { maxPriceCents: 0 })), ['Free']);
});

test('S05 (criteria combine): an event must pass ALL the criteria given', () => {
  const events = [
    summary({ title: 'Lagos Jazz', city: 'Lagos', minPriceCents: 300 }),
    summary({ title: 'Abuja Jazz', city: 'Abuja', minPriceCents: 300 }),
    summary({ title: 'Lagos Jazz Deluxe', city: 'Lagos', minPriceCents: 900 }),
  ];
  assert.deepEqual(titles(filterEvents(events, { q: 'jazz', city: 'lagos', maxPriceCents: 500 })), ['Lagos Jazz']);
});

test('S05 (sort by price): events with no price go LAST, they are not removed', () => {
  const events = [
    summary({ title: 'No price', minPriceCents: null }),
    summary({ title: 'Dear', minPriceCents: 900 }),
    summary({ title: 'Cheap', minPriceCents: 100 }),
  ];
  assert.deepEqual(titles(sortEvents(events, 'price')), ['Cheap', 'Dear', 'No price']);
});

test('S05 (sort by availability): most seats left first', () => {
  const events = [
    summary({ title: 'Few', seatsLeft: 2 }), summary({ title: 'Many', seatsLeft: 90 }),
    summary({ title: 'None', seatsLeft: 0 }), summary({ title: 'Some', seatsLeft: 30 }),
  ];
  assert.deepEqual(titles(sortEvents(events, 'availability')), ['Many', 'Some', 'Few', 'None']);
});

test('S05 (ties): equal keys break by title (ignoring case), then by id; the result is the same whatever the input order', () => {
  const a = summary({ id: 'id-1', title: 'beta', minPriceCents: 100, seatsLeft: 5 });
  const b = summary({ id: 'id-2', title: 'Alpha', minPriceCents: 100, seatsLeft: 5 });
  const c = summary({ id: 'id-3', title: 'Alpha', minPriceCents: 100, seatsLeft: 5 }); // same title as b: id decides
  for (const sortBy of ['date', 'price', 'availability']) {
    const expected = ['id-2', 'id-3', 'id-1'];
    assert.deepEqual(sortEvents([a, b, c], sortBy).map((e) => e.id), expected, sortBy);
    assert.deepEqual(sortEvents([c, a, b], sortBy).map((e) => e.id), expected, sortBy);
    assert.deepEqual(sortEvents([b, c, a], sortBy).map((e) => e.id), expected, sortBy);
  }
});

test('S05 (ties): titles with numbers sort the way people expect ("Show 2" before "Show 10")', () => {
  const events = [summary({ title: 'Show 10' }), summary({ title: 'Show 2' })];
  assert.deepEqual(titles(sortEvents(events, 'price')), ['Show 2', 'Show 10']);
});

test('S05 (empty): an empty list gives an empty list for every function', () => {
  assert.deepEqual(filterEvents([], { q: 'x' }), []);
  assert.deepEqual(sortEvents([], 'date'), []);
  assert.deepEqual(searchEvents([], { city: 'Lagos' }, 'price'), []);
});

test('S05 (default sort): searchEvents sorts by date when no sort is given', () => {
  const events = [summary({ title: 'Later', startsAt: '2026-12-09T10:00:00Z' }), summary({ title: 'Sooner', startsAt: '2026-12-01T10:00:00Z' })];
  assert.deepEqual(titles(searchEvents(events, {})), ['Sooner', 'Later']);
});

test('S05 (bad data): an event whose date cannot be read sorts last by date and never matches a date filter', () => {
  const events = [summary({ title: 'Broken', startsAt: 'garbage' }), summary({ title: 'Fine', startsAt: '2026-12-01T10:00:00Z' })];
  assert.deepEqual(titles(sortEvents(events, 'date')), ['Fine', 'Broken']);
  assert.deepEqual(titles(filterEvents(events, { from: '2026-01-01' })), ['Fine']);
});

// ---------- end to end: through the real store ----------

test('S05 (end to end): drafts never appear, and search works on live data', () => {
  const store = createStore();
  const make = (title, city, startsAt, prices, { publish = true } = {}) => {
    const event = createEvent(store, { title, city, venue: `${title} Hall`, startsAt });
    const tiers = prices.map((priceCents, i) => addTier(store, event.id, { name: `T${i}`, priceCents, capacity: 5 }));
    if (publish) publishEvent(store, event.id);
    return { event, tiers };
  };
  const jazz = make('Abuja Jazz Night', 'Abuja', inDays(10), [800_000]);
  make('Lagos Tech Meetup', 'Lagos', inDays(20), [500_000, 1_500_000]);
  make('Lagos Food Festival', 'Lagos', inDays(5), [200_000]);
  make('Secret Draft', 'Lagos', inDays(1), [100_000], { publish: false });

  const all = listEventSummaries(store);
  assert.equal(all.length, 3); // the draft is hidden
  assert.deepEqual(titles(searchEvents(all, { city: 'lagos' }, 'price')), ['Lagos Food Festival', 'Lagos Tech Meetup']);
  assert.deepEqual(titles(searchEvents(all, { q: 'jazz' })), ['Abuja Jazz Night']);
  assert.deepEqual(titles(searchEvents(all, {}, 'date')), ['Lagos Food Festival', 'Abuja Jazz Night', 'Lagos Tech Meetup']);

  // Selling the last seats changes availability: the summaries are fresh each time they are listed.
  bookTickets(store, { eventId: jazz.event.id, tierId: jazz.tiers[0].id, quantity: 5, customer: 'Ada' });
  const after = listEventSummaries(store);
  assert.deepEqual(titles(searchEvents(after, { onlyAvailable: true })), ['Lagos Food Festival', 'Lagos Tech Meetup']);
  assert.equal(after.find((e) => e.title === 'Abuja Jazz Night').seatsLeft, 0);
  assert.equal(all.find((e) => e.title === 'Abuja Jazz Night').seatsLeft, 5); // the earlier snapshot is unchanged
});
