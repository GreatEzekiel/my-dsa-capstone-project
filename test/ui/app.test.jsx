// app.test.jsx: run with `npm run test:ui` (or as part of `npm test`).
// These tests open the real <App /> in a fake browser (jsdom) and use it like a person would:
// type into fields, click buttons, read what appears on screen. They run on Vitest, which is built on Vite.

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/ui/App.jsx';

// Unmount the app after each test so one test's screen never leaks into the next.
afterEach(cleanup);

// Helpers that find things the way a user would: by visible text or accessible name, never by CSS class.
const nameBox = () => screen.getByPlaceholderText('Ada Obi');
const press = (user, name) => user.click(screen.getByRole('button', { name }));
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
  test('shows the event, both tiers and the booking form', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lagos Night of Tech' })).toBeTruthy();
    expect(screen.getByText('General admission')).toBeTruthy();
    expect(screen.getByText('Premium access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Book tickets' })).toBeTruthy();
  });

  test('the quantity stepper stays between 1 and 10', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: 'One fewer ticket' }).disabled).toBe(true); // already at 1
    await step(user, 'One more ticket', 12); // try to go past the limit
    expect(screen.getByRole('button', { name: 'One more ticket' }).disabled).toBe(true);
    expect(screen.getByText('10', { selector: 'span.num' })).toBeTruthy();
  });

  test('booking shows a message, a reference code and the ticket', async () => {
    const user = userEvent.setup();
    render(<App />);
    await typeName(user, 'Ada');
    await press(user, 'Book tickets');
    expect(screen.getByText(/Booked 1 × Regular for Ada/)).toBeTruthy();
    // The lookup box was filled with the new booking's code, e.g. "7K2M-9Q4X"
    expect(screen.getByLabelText('Reference code').value).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeTruthy();
  });

  test('a blank name is refused with a readable VALIDATION message', async () => {
    const user = userEvent.setup();
    render(<App />);
    await press(user, 'Book tickets'); // name left empty
    expect(screen.getByText(/VALIDATION: customer: is required/)).toBeTruthy();
  });

  test('the whole story: sell out, waitlist, cancel, fair line, book next, leave', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Sell out Regular: 6 seats = 1 + five clicks of +.
    await typeName(user, 'Ada Obi');
    await step(user, 'One more ticket', 5);
    await press(user, 'Book tickets');
    expect(screen.getByText(/Booked 6 × Regular for Ada Obi/)).toBeTruthy();

    // Seats are gone, so the main button now offers the waitlist instead.
    expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeTruthy();

    // Chidi (1 ticket) joins, then Dayo (2 tickets).
    await typeName(user, 'Chidi');
    await step(user, 'One fewer ticket', 5);
    await press(user, 'Join waitlist');
    expect(screen.getByText(/Chidi is number 1 on the Regular waitlist/)).toBeTruthy();
    await typeName(user, 'Dayo');
    await step(user, 'One more ticket', 1);
    await press(user, 'Join waitlist');
    expect(screen.getByText(/Dayo is number 2 on the Regular waitlist/)).toBeTruthy();
    expect(screen.getByText(/Next in line · 1 ticket/)).toBeTruthy();

    // The lookup box still holds Ada's code from earlier. Cancel her booking: next in line is named.
    await press(user, 'Cancel booking');
    expect(screen.getByText(/Next in line: Chidi/)).toBeTruthy();

    // Seats are free again, but people are waiting, so the button still says "Join waitlist" (no jumping).
    expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeTruthy();
    expect(screen.getByText(/already waiting/)).toBeTruthy();

    // The front of the line is booked.
    await press(user, 'Book them');
    expect(screen.getByText(/Booked 1 × Regular for Chidi from the waitlist/)).toBeTruthy();

    // Dayo gives up their place.
    await press(user, 'Dayo leaves the waitlist');
    expect(screen.getByText(/Dayo left the Regular waitlist/)).toBeTruthy();
    expect(screen.getByText(/Nobody is waiting/)).toBeTruthy();
  });
});

// ---------- Build 2: search, filter, sort ----------

// The titles of the events currently listed in the search results, in the order shown.
const listed = () => within(screen.getByRole('list', { name: 'Search results' }))
  .queryAllByRole('button').map((b) => b.getAttribute('aria-label').replace('Open ', ''));

describe('Find an event (S05)', () => {
  test('lists the published events by date, and never shows the draft', () => {
    render(<App />);
    expect(listed()).toEqual(['Abuja Jazz Night', 'Port Harcourt Comedy Live', 'Lagos Night of Tech', 'Lagos Food Festival']);
    expect(screen.queryByRole('button', { name: /Ibadan Book Fair/ })).toBeNull(); // a draft: private
    expect(screen.getByText('4 events')).toBeTruthy();
  });

  test('searching "JAZZ" leaves only Abuja Jazz Night', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Search events'), 'JAZZ');
    expect(listed()).toEqual(['Abuja Jazz Night']);
    expect(screen.getByText('1 event')).toBeTruthy();
  });

  test('filtering by city, then sorting by price', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('City'), 'Lagos');
    expect(listed()).toEqual(['Lagos Night of Tech', 'Lagos Food Festival']); // by date: 30 days, then 45 days
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price');
    expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']); // from ₦2,000, then from ₦5,000
  });

  test('a max price compares with the cheapest tier', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Maximum price in naira'), '5000');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price');
    expect(listed()).toEqual(['Lagos Food Festival', 'Lagos Night of Tech']); // ₦2,000 and ₦5,000 (included)
  });

  test('a date range: "until" includes that whole day', () => {
    render(<App />);
    const day = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: day(20) } }); // the comedy night is in 20 days
    expect(listed()).toEqual(['Abuja Jazz Night', 'Port Harcourt Comedy Live']);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: day(15) } });
    expect(listed()).toEqual(['Port Harcourt Comedy Live']);
  });

  test('a price that is not a number shows the domain error instead of crashing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Maximum price in naira'), 'abc');
    expect(screen.getByRole('alert').textContent).toMatch(/VALIDATION: maxPriceCents/);
  });

  test('no match says so', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Search events'), 'zzzzzz');
    expect(listed()).toEqual([]);
    expect(screen.getByText(/No events match/)).toBeTruthy();
  });

  test('opening another event shows it, and booking there works', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Port Harcourt Comedy Live' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Port Harcourt Comedy Live' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Port Harcourt Comedy Live' }).getAttribute('aria-pressed')).toBe('true');
    await typeName(user, 'Chidi');
    await step(user, 'One more ticket', 4); // 5 tickets = every Silver seat
    await press(user, 'Book tickets');
    expect(screen.getByText(/Booked 5 × Silver for Chidi/)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy(); // S06: a booking starts pending
    expect(screen.getByLabelText('Reference code').value).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });
});
