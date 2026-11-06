// benchmark-lookup.js: run with `npm run benchmark`.
// Question: how long does finding one booking by its reference code take,
// as the number of bookings grows? Compares a Map (O(1)) with Array.find (O(n)).

import { performance } from 'node:perf_hooks';
import { createStore, createEvent, addTier, bookTickets } from '../src/domain/inventory.js';

// How many bookings to test with. Each size is 10x the previous (the last is 4x), so growth is easy to see.
const sizes = [1_000, 10_000, 100_000, 400_000];
const LOOKUPS = 300; // random references looked up per measurement
const ROUNDS = 5; // take the best round to dodge garbage-collection noise

// Creates n real bookings through the domain code and returns them as an array.
function build(n) {
  const store = createStore();
  const event = createEvent(store, { name: 'Bench', venue: 'Nowhere', startsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() });
  const tier = addTier(store, event.id, { name: 'GA', priceCents: 100, capacity: n });
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: `C${i}` }));
  }
  return list;
}

// Runs fn over every reference, ROUNDS times, and returns the BEST round as microseconds per lookup.
// The best (not average) round removes noise from garbage collection and other programs.
function perLookup(refs, fn) {
  let best = Infinity;
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = performance.now();
    for (const ref of refs) fn(ref);
    best = Math.min(best, performance.now() - t0);
  }
  return (best / refs.length) * 1000;
}

console.log(`Time per lookup by booking reference (best of ${ROUNDS} rounds, ${LOOKUPS} random references)\n`);
console.log('bookings'.padStart(10), 'Map.get'.padStart(14), 'Array.find'.padStart(14), 'slower by'.padStart(12));

for (const n of sizes) {
  const list = build(n);
  // Index the same bookings by reference in a Map: the structure the domain uses.
  const byRef = new Map(list.map((b) => [b.reference, b])); // same key, same data: a fair fight
  // Random references to look for (random so the array search averages out to scanning about half the list).
  const refs = Array.from({ length: LOOKUPS }, () => list[Math.floor(Math.random() * n)].reference);

  // `sink` uses each result, so the engine can't optimise the lookups away as "unused".
  let sink = 0;
  // O(1): hash the key, jump to its bucket.
  const mapUs = perLookup(refs, (r) => { sink += byRef.get(r).quantity; });
  // O(n): compare booking after booking until one matches.
  const arrUs = perLookup(refs, (r) => { sink += list.find((b) => b.reference === r).quantity; });
  if (sink < 0) console.log(sink);

  console.log(
    String(n).padStart(10),
    `${mapUs.toFixed(2)} µs`.padStart(14),
    `${arrUs.toFixed(2)} µs`.padStart(14),
    `${Math.round(arrUs / mapUs)}x`.padStart(12),
  );
}

console.log(`
Why: Map.get hashes the key and goes straight to its bucket, O(1), so the time barely moves as
bookings grow. Array.find checks bookings one by one until it finds a match, O(n): about 10x more
bookings means about 10x more work, so the Array.find column keeps climbing.`);
