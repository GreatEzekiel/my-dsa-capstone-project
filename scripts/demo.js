// demo.js: run with `npm run demo`.
// Tells the whole Build 1 story in the terminal, using only the domain functions.

import { DomainError } from '../src/domain/errors.js';
import { formatMoney } from '../src/domain/money.js';
import {
  createStore, createEvent, addTier, bookTickets, cancelBooking,
  findBookingByReference, joinWaitlist, takeNextFromWaitlist, listEvents, listWaitlist,
} from '../src/domain/inventory.js';

// Prints a numbered heading so the output reads as chapters.
const step = (n, title) => console.log(`\n── ${n}. ${title}`);

// Setup: one store, one event, two tiers. Regular has only 4 seats so it sells out fast.
const store = createStore();
const event = createEvent(store, {
  name: 'Lagos Night of Tech',
  venue: 'Landmark Centre, Victoria Island',
  // 30 days from now, so the demo keeps working (booking closes once an event has started).
  startsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
});
const regular = addTier(store, event.id, { name: 'Regular', priceCents: 500_000, capacity: 4 }); // ₦5,000
const vip = addTier(store, event.id, { name: 'VIP', priceCents: 2_000_000, capacity: 2 }); // ₦20,000

// Shortcut so each booking below is one short line.
const book = (tier, quantity, customer) => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity, customer });

step(1, 'The event goes on sale');
console.log(`${event.name} at ${event.venue}`);
for (const t of listEvents(store)[0].tiers) {
  console.log(`  ${t.name}: ${t.capacity} seats at ${formatMoney(t.priceCents)}`);
}

step(2, 'Regular sells out');
const ada = book(regular, 2, 'Ada');
const bola = book(regular, 2, 'Bola'); // 2 + 2 = 4 = every Regular seat
console.log(`  Ada booked 2   -> ${ada.reference}  ${formatMoney(ada.totalCents)}`);
console.log(`  Bola booked 2  -> ${bola.reference}  ${formatMoney(bola.totalCents)}`);
console.log(`  Regular seats left: ${listEvents(store)[0].tiers[0].seatsLeft}`);

step(3, 'A booking is refused');
try {
  book(regular, 1, 'Chidi'); // no seats: must throw SOLD_OUT
} catch (e) {
  if (!(e instanceof DomainError)) throw e; // only catch OUR errors; real bugs should still crash
  console.log(`  Chidi refused  -> ${e.code}: ${e.message}`);
}
// Proof that the failed booking changed nothing.
console.log(`  Seats left unchanged: ${listEvents(store)[0].tiers[0].seatsLeft}`);

step(4, 'People join the waitlist');
for (const [name, qty] of [['Chidi', 1], ['Dayo', 2]]) {
  const { position } = joinWaitlist(store, { eventId: event.id, tierId: regular.id, quantity: qty, customer: name });
  console.log(`  ${name} (${qty}) joined at position ${position}`);
}

step(5, 'Bola cancels, and the next person in line is named');
// Lowercase on purpose: shows the lookup forgives case.
const found = findBookingByReference(store, bola.reference.toLowerCase());
console.log(`  Looked up ${found.reference} -> ${found.customer}, ${found.quantity} tickets`);
const result = cancelBooking(store, bola.reference);
console.log(`  Cancelled ${result.booking.reference}. Seats left: ${result.seatsLeft}`);
console.log(`  Next in line: ${result.nextInLine.customer} (${result.nextInLine.quantity} ticket${result.nextInLine.quantity > 1 ? 's' : ''})`);
console.log(`  Can be served now: ${result.nextCanBeServed}`);

step(6, 'No queue jumping: strangers cannot take seats freed for people who waited');
try {
  book(regular, 1, 'Eze'); // 2 seats are free right now, but Chidi and Dayo are ahead of Eze
} catch (e) {
  console.log(`  Eze refused    -> ${e.code}: ${e.message}`);
}

step(7, 'The front of the line is booked, strictly first-in-first-out');
const chidi = takeNextFromWaitlist(store, regular.id);
console.log(`  Chidi booked   -> ${chidi.reference}`);
// Dayo needs 2 seats but only 1 is left. Nobody behind Dayo could skip ahead either.
try {
  takeNextFromWaitlist(store, regular.id);
} catch (e) {
  console.log(`  Dayo next      -> ${e.code}: ${e.message}`);
}
console.log(`  Still waiting: ${listWaitlist(store, regular.id).map((w) => w.customer).join(', ')}`);

step(8, 'Cancelling twice is an error');
try {
  cancelBooking(store, bola.reference);
} catch (e) {
  console.log(`  ${e.code}: ${e.message}`);
}
void vip; // VIP exists to show a second tier; the story only needs Regular
console.log('\nDone.');
