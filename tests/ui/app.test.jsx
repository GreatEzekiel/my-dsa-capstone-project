// app.test.jsx: run with `npm run test:ui`.
// These tests open the real <App /> in a fake browser (jsdom) and use it like a person would:
// type into fields, click buttons, read what appears on screen. They run on Vitest, which is built on Vite.

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
