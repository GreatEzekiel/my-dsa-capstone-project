// app.test.jsx: run with `npm run test:ui` (or as part of `npm test`).
// These tests open the real <App /> in a fake browser (jsdom) and use it like a person would:
// type into fields, click buttons, read what appears on screen. They run on Vitest, which is built on Vite.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/ui/App.jsx';
import { searchEvents } from '../../src/domain/eventSearch.js';

function createApiFetch() {
  const dayAt = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const events = [
    { id: 'event-lagos', title: 'Lagos Night of Tech', city: 'Lagos', venue: 'Landmark Centre, Victoria Island', startsAt: dayAt(30), status: 'published', tiers: [
      { id: 'tier-regular', eventId: 'event-lagos', name: 'Regular', priceCents: 500_000, capacity: 6, sold: 0 },
      { id: 'tier-vip', eventId: 'event-lagos', name: 'VIP', priceCents: 2_000_000, capacity: 2, sold: 0 },
    ] },
    { id: 'event-jazz', title: 'Abuja Jazz Night', city: 'Abuja', venue: 'Jabi Lake Park', startsAt: dayAt(12), status: 'published', tiers: [
      { id: 'tier-jazz', eventId: 'event-jazz', name: 'Standard', priceCents: 800_000, capacity: 40, sold: 0 },
      { id: 'tier-front-row', eventId: 'event-jazz', name: 'Front row', priceCents: 2_500_000, capacity: 4, sold: 0 },
    ] },
    { id: 'event-food', title: 'Lagos Food Festival', city: 'Lagos', venue: 'Tafawa Balewa Square', startsAt: dayAt(45), status: 'published', tiers: [
      { id: 'tier-entry', eventId: 'event-food', name: 'Entry', priceCents: 200_000, capacity: 200, sold: 0 },
      { id: 'tier-family', eventId: 'event-food', name: 'Family pack', priceCents: 600_000, capacity: 30, sold: 0 },
    ] },
    { id: 'event-comedy', title: 'Port Harcourt Comedy Live', city: 'Port Harcourt', venue: 'Hotel Presidential', startsAt: dayAt(20), status: 'published', tiers: [
      { id: 'tier-silver', eventId: 'event-comedy', name: 'Silver', priceCents: 1_000_000, capacity: 5, sold: 0 },
      { id: 'tier-gold', eventId: 'event-comedy', name: 'Gold', priceCents: 1_500_000, capacity: 3, sold: 0 },
    ] },
    { id: 'event-draft', title: 'Ibadan Book Fair', city: 'Ibadan', venue: 'Cultural Centre, Mokola', startsAt: dayAt(60), status: 'draft', tiers: [
      { id: 'tier-book', eventId: 'event-draft', name: 'Entry', priceCents: 100_000, capacity: 100, sold: 0 },
    ] },
  ];
  const waitlists = new Map();
  const bookings = new Map();
  let bookingNumber = 0;
  const publicBooking = (booking) => {
    const { userId, ...visible } = booking;
    return visible;
  };
  const summaries = () => events
    .filter((event) => event.status === 'published')
    .map((event) => ({
      id: event.id,
      title: event.title,
      city: event.city,
      venue: event.venue,
      startsAt: event.startsAt,
      status: event.status,
      tierCount: event.tiers.length,
      minPriceCents: Math.min(...event.tiers.map((tier) => tier.priceCents)),
      seatsLeft: event.tiers.reduce((sum, tier) => sum + tier.capacity - tier.sold, 0),
    }));
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  });
  const error = (status, code, message) => reply(status, { error: { code, message } });
  const reference = () => `TEST-${String(++bookingNumber).padStart(4, '0')}`;

  return async (input, options = {}) => {
    const url = new URL(input, 'http://ticketing.test');
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    const userId = headers.get('x-user-id');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (method === 'GET' && url.pathname === '/api/events') {
      const max = url.searchParams.get('maxPriceCents');
      if (max && !/^\d+$/.test(max)) return error(400, 'VALIDATION', 'maxPriceCents: must be a whole number');
      const eventsFound = searchEvents(summaries(), {
        q: url.searchParams.get('q') || undefined,
        city: url.searchParams.get('city') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        maxPriceCents: max ? Number(max) : undefined,
        onlyAvailable: url.searchParams.get('onlyAvailable') === 'true',
      }, url.searchParams.get('sort') || 'date');
      return reply(200, { count: eventsFound.length, events: eventsFound });
    }

    if (method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'events') {
      const event = events.find((item) => item.id === parts[2]);
      if (!event) return error(404, 'NOT_FOUND', 'Event not found');
      return reply(200, { event: {
        ...event,
        started: false,
        tiers: event.tiers.map((tier) => ({
          ...tier,
          seatsLeft: tier.capacity - tier.sold,
          waitlistSize: (waitlists.get(tier.id) ?? []).length,
        })),
      } });
    }

    if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'events' && parts[3] === 'waitlists') {
      const event = events.find((item) => item.id === parts[2]);
      if (!event) return error(404, 'NOT_FOUND', 'Event not found');
      return reply(200, { waitlists: event.tiers.map((tier) => ({
        tierId: tier.id,
        entries: (waitlists.get(tier.id) ?? []).map((entry, index) => ({
          ...entry,
          userId: undefined,
          position: index + 1,
          isMine: entry.userId === userId,
        })),
      })) });
    }

    if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'bookings') {
      const event = events.find((item) => item.id === body?.eventId);
      const tier = event?.tiers.find((item) => item.id === body?.tierId);
      if (!userId || !body?.customer?.trim()) return error(400, 'VALIDATION', 'customer: is required');
      if (!tier || body.quantity > tier.capacity - tier.sold) return error(409, 'SOLD_OUT', 'Not enough seats left');
      if ((waitlists.get(tier.id) ?? []).length) return error(409, 'WAITLIST_FIRST', 'People are already waiting');
      tier.sold += body.quantity;
      const created = {
        id: `booking-${bookingNumber + 1}`,
        reference: reference(),
        eventId: event.id,
        tierId: tier.id,
        quantity: body.quantity,
        customer: body.customer.trim(),
        userId,
        totalCents: tier.priceCents * body.quantity,
        status: 'pending',
        createdAt: new Date().toISOString(),
        history: [{ status: 'pending', at: new Date().toISOString() }],
      };
      bookings.set(created.reference, created);
      return reply(201, { booking: publicBooking(created) });
    }

    if (parts[0] === 'api' && parts[1] === 'events' && parts[5] === 'waitlist') {
      const event = events.find((item) => item.id === parts[2]);
      const tier = event?.tiers.find((item) => item.id === parts[4]);
      if (!tier) return error(404, 'NOT_FOUND', 'Ticket tier not found');
      const queue = waitlists.get(tier.id) ?? [];
      if (method === 'POST' && parts.length === 6) {
        if (body.quantity <= tier.capacity - tier.sold && queue.length === 0) {
          return error(409, 'SEATS_AVAILABLE', 'Seats are available; book directly');
        }
        if (queue.some((entry) => entry.customer.toLowerCase() === body.customer.trim().toLowerCase())) {
          return error(409, 'ALREADY_WAITING', 'Already waiting');
        }
        const entry = {
          id: `wait-${tier.id}-${queue.length + 1}`,
          eventId: event.id,
          tierId: tier.id,
          customer: body.customer.trim(),
          quantity: body.quantity,
          userId,
          joinedAt: new Date().toISOString(),
        };
        queue.push(entry);
        waitlists.set(tier.id, queue);
        return reply(201, { entry, position: queue.length });
      }
      if (method === 'POST' && parts.length === 8 && parts[6] === 'next' && parts[7] === 'book') {
        const head = queue[0];
        if (!head || head.userId !== userId) return error(404, 'NOT_FOUND', 'Waitlist entry not found');
        if (head.quantity > tier.capacity - tier.sold) return error(409, 'SOLD_OUT', 'Not enough seats');
        tier.sold += head.quantity;
        const promoted = {
          id: `booking-${bookingNumber + 1}`,
          reference: reference(),
          eventId: event.id,
          tierId: tier.id,
          quantity: head.quantity,
          customer: head.customer,
          userId: head.userId,
          totalCents: tier.priceCents * head.quantity,
          status: 'pending',
          createdAt: new Date().toISOString(),
          history: [{ status: 'pending', at: new Date().toISOString() }],
        };
        bookings.set(promoted.reference, promoted);
        queue.shift();
        return reply(200, { booking: publicBooking(promoted) });
      }
      if (method === 'DELETE' && parts.length === 7) {
        const index = queue.findIndex((entry) => entry.id === parts[6] && entry.userId === userId);
        if (index < 0) return error(404, 'NOT_FOUND', 'Waitlist entry not found');
        const [removed] = queue.splice(index, 1);
        return reply(200, { removed, nextInLine: queue[0] ?? null });
      }
    }

    if (parts[0] === 'api' && parts[1] === 'bookings' && parts.length >= 3) {
      const booking = bookings.get(parts[2]);
      if (!booking) return error(404, 'NOT_FOUND', 'Booking not found');
      if (method === 'GET' && parts.length === 3) return reply(200, { booking: publicBooking(booking) });
      if (method === 'POST' && parts[3] === 'cancel') {
        if (booking.userId !== userId) return error(404, 'NOT_FOUND', 'Booking not found');
        if (booking.status !== 'pending') return error(409, 'INVALID_TRANSITION', 'Only pending bookings can be cancelled');
        booking.status = 'cancelled';
        events.find((event) => event.id === booking.eventId).tiers
          .find((tier) => tier.id === booking.tierId).sold -= booking.quantity;
        return reply(200, { booking: publicBooking(booking), seatsLeft: 1 });
      }
    }

    return error(404, 'NOT_FOUND', 'No route');
  };
}

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('fetch', createApiFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Helpers that find things the way a user would: by visible text or accessible name, never by CSS class.
const nameBox = () => screen.getByPlaceholderText('Ada Obi');
const press = (user, name) => user.click(screen.getByRole('button', { name }));
async function openApp() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Lagos Night of Tech' });
  await screen.findByRole('option', { name: 'Lagos' });
}
// Replace whatever is in the name box with `name`.
async function typeName(user, name) {
  await user.clear(nameBox());
  await user.type(nameBox(), name);
}
// Click the + (or −) stepper `n` times.
async function step(user, label, n) {
  for (let i = 0; i < n; i++) await press(user, label);
}

describe('Event ticketing screen', () => {
  test.each(['', 'http proxy error'])('explains how to start the API after an unstructured 500 (%s)', async (text) => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      async text() { return text; },
    }));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'API_UNAVAILABLE: The API server is unavailable. Start it with npm start, then try again.',
    );
  });

  test('shows the event, both tiers and the booking form', async () => {
    await openApp();
    expect(screen.getByText('General admission')).toBeTruthy();
    expect(screen.getByText('Premium access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Book tickets' })).toBeTruthy();
  });

  test('the quantity stepper stays between 1 and 10', async () => {
    const user = userEvent.setup();
    await openApp();
    expect(screen.getByRole('button', { name: 'One fewer ticket' }).disabled).toBe(true); // already at 1
    await step(user, 'One more ticket', 12); // try to go past the limit
    expect(screen.getByRole('button', { name: 'One more ticket' }).disabled).toBe(true);
    expect(screen.getByText('10', { selector: 'span.num' })).toBeTruthy();
  });

  test('booking shows a message, a reference code and the ticket', async () => {
    const user = userEvent.setup();
    await openApp();
    await typeName(user, 'Ada');
    await press(user, 'Book tickets');
    expect(await screen.findByText(/Booked 1 × Regular for Ada/)).toBeTruthy();
    // The lookup box was filled with the new booking's code, e.g. "7K2M-9Q4X"
    expect(screen.getByLabelText('Reference code').value).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await screen.findByRole('button', { name: 'Cancel booking' })).toBeTruthy();
  });

  test('a blank name is refused with a readable VALIDATION message', async () => {
    const user = userEvent.setup();
    await openApp();
    await press(user, 'Book tickets'); // name left empty
    expect(await screen.findByText(/VALIDATION: customer: is required/)).toBeTruthy();
  });

  test('the whole story: sell out, waitlist, cancel, fair line, book next, leave', async () => {
    const user = userEvent.setup();
    await openApp();

    // Sell out Regular: 6 seats = 1 + five clicks of +.
    await typeName(user, 'Ada Obi');
    await step(user, 'One more ticket', 5);
    await press(user, 'Book tickets');
    expect(await screen.findByText(/Booked 6 × Regular for Ada Obi/)).toBeTruthy();

    // Seats are gone, so the main button now offers the waitlist instead.
    expect(await screen.findByRole('button', { name: 'Join waitlist' })).toBeTruthy();

    // Chidi (1 ticket) joins, then Dayo (2 tickets).
    await typeName(user, 'Chidi');
    await step(user, 'One fewer ticket', 5);
    await press(user, 'Join waitlist');
    expect(await screen.findByText(/Chidi is number 1 on the Regular waitlist/)).toBeTruthy();
    await typeName(user, 'Dayo');
    await step(user, 'One more ticket', 1);
    await press(user, 'Join waitlist');
    expect(await screen.findByText(/Dayo is number 2 on the Regular waitlist/)).toBeTruthy();
    expect(await screen.findByText(/Next in line · 1 ticket/)).toBeTruthy();

    // The lookup box still holds Ada's code from earlier. Cancel her booking: next in line is named.
    await screen.findByRole('button', { name: 'Cancel booking' });
    await press(user, 'Cancel booking');
    expect(await screen.findByText(/Next in line: Chidi/)).toBeTruthy();

    // Seats are free again, but people are waiting, so the button still says "Join waitlist" (no jumping).
    expect(await screen.findByRole('button', { name: 'Join waitlist' })).toBeTruthy();
    expect(screen.getByText(/already waiting/)).toBeTruthy();

    // The front of the line is booked.
    await press(user, 'Book them');
    expect(await screen.findByText(/Booked 1 × Regular for Chidi from the waitlist/)).toBeTruthy();

    // Dayo gives up their place.
    await press(user, 'Dayo leaves the waitlist');
    expect(await screen.findByText(/Dayo left the Regular waitlist/)).toBeTruthy();
    expect(await screen.findByText(/Nobody is waiting/)).toBeTruthy();
  });
});

// ---------- Build 2: search, filter, sort ----------

// The titles of the events currently listed in the search results, in the order shown.
const listed = () => within(screen.getByRole('list', { name: 'Search results' }))
  .queryAllByRole('button').map((b) => b.getAttribute('aria-label').replace('Open ', ''));

describe('Find an event (S05)', () => {
  test('lists the published events by date, and never shows the draft', async () => {
    await openApp();
    expect(listed()).toEqual(['Abuja Jazz Night', 'Port Harcourt Comedy Live', 'Lagos Night of Tech', 'Lagos Food Festival']);
    expect(screen.queryByRole('button', { name: /Ibadan Book Fair/ })).toBeNull(); // a draft: private
    expect(screen.getByText('4 events')).toBeTruthy();
  });

  test('searching "JAZZ" leaves only Abuja Jazz Night', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.type(screen.getByLabelText('Search events'), 'JAZZ');
    await waitFor(() => expect(listed()).toEqual(['Abuja Jazz Night']));
    expect(listed()).toEqual(['Abuja Jazz Night']);
    expect(screen.getByText('1 event')).toBeTruthy();
  });

  test('filtering by city, then sorting by price', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.selectOptions(screen.getByLabelText('City'), 'Lagos');
    await waitFor(() => expect(listed()).toEqual(['Lagos Night of Tech', 'Lagos Food Festival']));
    expect(listed()).toEqual(['Lagos Night of Tech', 'Lagos Food Festival']); // by date: 30 days, then 45 days
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price');
    await waitFor(() => expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']));
    expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']); // from ₦2,000, then from ₦5,000
  });

  test('a max price compares with the cheapest tier', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.type(screen.getByLabelText('Maximum price in naira'), '5000');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price');
    await waitFor(() => expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']));
    expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']); // ₦2,000 and ₦5,000 (included)
  });

  test('a date range: "until" includes that whole day', async () => {
    await openApp();
    const day = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: day(20) } }); // the comedy night is in 20 days
    await waitFor(() => expect(listed()).toEqual(['Abuja Jazz Night', 'Port Harcourt Comedy Live']));
    expect(listed()).toEqual(['Abuja Jazz Night', 'Port Harcourt Comedy Live']);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: day(15) } });
    await waitFor(() => expect(listed()).toEqual(['Port Harcourt Comedy Live']));
    expect(listed()).toEqual(['Port Harcourt Comedy Live']);
  });

  test('a price that is not a number shows the domain error instead of crashing', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.type(screen.getByLabelText('Maximum price in naira'), 'abc');
    expect((await screen.findByRole('alert')).textContent).toMatch(/VALIDATION: maxPriceCents/);
  });

  test('no match says so', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.type(screen.getByLabelText('Search events'), 'zzzzzz');
    await waitFor(() => expect(listed()).toEqual([]));
    expect(listed()).toEqual([]);
    expect(screen.getByText(/No events match/)).toBeTruthy();
  });

  test('opening another event shows it, and booking there works', async () => {
    const user = userEvent.setup();
    await openApp();
    await user.click(screen.getByRole('button', { name: 'Open Port Harcourt Comedy Live' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Port Harcourt Comedy Live' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Port Harcourt Comedy Live' }).getAttribute('aria-pressed')).toBe('true');
    await typeName(user, 'Chidi');
    await step(user, 'One more ticket', 4); // 5 tickets = every Silver seat
    await press(user, 'Book tickets');
    expect(await screen.findByText(/Booked 5 × Silver for Chidi/)).toBeTruthy();
    expect(await screen.findByText('Pending')).toBeTruthy(); // S06: a booking starts pending
    expect(screen.getByLabelText('Reference code').value).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });
});
