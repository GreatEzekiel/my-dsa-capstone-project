// demo-search.js: run with `npm run demo:search`.
// Shows Build 2: create events as drafts, publish them, then search, filter and sort.

import { DomainError } from '../src/domain/errors.js';
import { formatMoney } from '../src/domain/money.js';
import { searchEvents } from '../src/domain/eventSearch.js';
import {
  createStore, createEvent, addTier, publishEvent, bookTickets, listEventSummaries,
} from '../src/domain/inventory.js';

const inDays = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();
const step = (n, title) => console.log(`\n── ${n}. ${title}`);

// Prints a list of summaries, one per line. An empty list says so.
function show(list) {
  if (list.length === 0) console.log('  (no events)');
  for (const e of list) {
    const price = e.minPriceCents === null ? 'no tiers' : `from ${formatMoney(e.minPriceCents)}`;
    console.log(`  ${e.title.padEnd(26)} ${e.city.padEnd(14)} ${e.startsAt.slice(0, 10)}  ${price.padEnd(18)} ${String(e.seatsLeft).padStart(3)} seats`);
  }
}

// ---- setup: events are created as DRAFTS, given tiers, then published ----
const store = createStore();
function makeEvent(title, city, venue, days, tiers, { publish = true } = {}) {
  const event = createEvent(store, { title, city, venue, startsAt: inDays(days) });
  const made = tiers.map(([name, priceCents, capacity]) => addTier(store, event.id, { name, priceCents, capacity }));
  if (publish) publishEvent(store, event.id);
  return { event, tiers: made };
}
makeEvent('Lagos Tech Meetup', 'Lagos', 'Landmark Centre', 20, [['General', 500_000, 100], ['VIP', 2_000_000, 10]]);
const jazz = makeEvent('Abuja Jazz Night', 'Abuja', 'Jabi Lake Park', 10, [['Standard', 800_000, 4]]);
makeEvent('Lagos Food Festival', 'Lagos', 'Tafawa Balewa Square', 5, [['Entry', 200_000, 300]]);
makeEvent('Port Harcourt Comedy', 'Port Harcourt', 'Hotel Presidential', 20, [['Silver', 1_000_000, 50]]);
makeEvent('Ibadan Book Fair', 'Ibadan', 'Cultural Centre', 40, [['Entry', 0, 500]]);
makeEvent('Secret Draft Event', 'Lagos', 'Somewhere', 2, [['General', 100_000, 10]], { publish: false });
bookTickets(store, { eventId: jazz.event.id, tierId: jazz.tiers[0].id, quantity: 4, customer: 'Ada' }); // sells out Jazz Night

const all = listEventSummaries(store); // the PUBLIC list: drafts are not in it
const snapshot = JSON.stringify(all);

step(1, `The public list has ${all.length} events (the draft is hidden), sorted by date`);
show(searchEvents(all, {}, 'date'));

step(2, 'Search for "JAZZ" (matches title or venue, ignores case)');
show(searchEvents(all, { q: 'JAZZ' }));

step(3, 'City "lagos", cheapest first');
show(searchEvents(all, { city: 'lagos' }, 'price'));

step(4, 'Max price ₦5,000, cheapest first (compares with the cheapest tier)');
show(searchEvents(all, { maxPriceCents: 500_000 }, 'price'));

step(5, 'Events in the next 12 days (date-only "to" includes that whole day)');
show(searchEvents(all, { from: inDays(0).slice(0, 10), to: inDays(12).slice(0, 10) }));

step(6, 'Only events with seats left, most seats first');
show(searchEvents(all, { onlyAvailable: true }, 'availability'));

step(7, 'Bad input is refused with a clear code');
for (const [label, run] of [
  ['maxPriceCents: 9.99', () => searchEvents(all, { maxPriceCents: 9.99 })],
  ['to: "2026-02-30"', () => searchEvents(all, { to: '2026-02-30' })],
  ['sortBy: "popularity"', () => searchEvents(all, {}, 'popularity')],
]) {
  try {
    run();
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    console.log(`  ${label.padEnd(24)} -> ${e.code}: ${e.message}`);
  }
}

step(8, 'The original list was never changed by any of the above');
console.log(`  unchanged: ${JSON.stringify(all) === snapshot}`);
console.log('\nDone.');
