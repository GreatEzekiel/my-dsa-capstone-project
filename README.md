# Event Ticketing: Build 1 (domain core)

The rules of an event ticketing system, built from an empty folder: **events, ticket tiers, bookings with a
capacity rule, a first-in-first-out waitlist, and instant lookup of a booking by its reference code.**

- **The domain core** is plain JavaScript (ES modules, Node 22.13+, no runtime packages) and runs in the terminal.
  No server, no database.
- **The UI** is React + Tailwind, bundled by Vite. It is a thin screen on top of the same domain code. It adds no rules of its own.

---

## 1. Quick start

```bash
npm install        # only needed for the React UI and its tests
npm run demo       # the whole story in the terminal
npm run benchmark  # Map.get vs Array.find, with timings
npm test           # the domain tests (Node's built-in runner, no packages needed)
npm run test:ui    # the UI tests (the real screen in a fake browser)
npm run dev        # React UI with instant reload at http://localhost:5173
```

Requires **Node 22.13 or newer** (`node --version`).

---

## 2. Project map

```
src/
  domain/                  the rules (no React, no DOM, no printing)
    errors.js              DomainError + the list of error codes
    ids.js                 secure ids, readable booking reference codes
    money.js               whole-kobo money helpers
    waitlistQueue.js       FIFO queue built as a linked list
    inventory.js           events, tiers, bookings, cancel, waitlist (the in-memory store)
  ui/                      the React screen: main.jsx  App.jsx  index.css
scripts/                   demo.js  benchmark-lookup.js
tests/                     domain.test.js  ui/app.test.jsx
docs/
  code-walkthrough.md      every snippet explained in plain language (start here to learn)
  ai-log.md                what the AI got wrong, how it was found, how it was fixed
```

Every file has comments explaining each snippet, and **`docs/code-walkthrough.md` explains each one in detail**.

---

## 3. The business rules

| Rule | Where it is enforced |
|------|----------------------|
| A booking is for **1 to 10** tickets of **one tier** | `quantityOf` in `inventory.js` |
| **Never oversell**: not enough seats gives `SOLD_OUT` and **nothing changes** | `bookTickets` |
| Cancelling **releases** the seats | `cancelBooking` |
| Cancelling **twice** is an error (`ALREADY_CANCELLED`) | `cancelBooking` |
| Money is a **whole number of kobo**, never a decimal | `money.js`, `addTier` |
| **People already waiting go first**: while a tier has a line, strangers can't book freed seats (`WAITLIST_FIRST`) | `bookTickets` |
| One place per person in a tier's line (`ALREADY_WAITING`); anyone can **leave** the line | `joinWaitlist`, `leaveWaitlist` |
| **No new bookings or joins once the event has started** (`EVENT_STARTED`); cancelling stays allowed | `assertNotStarted` |
| The store is **sealed**: callers can't edit its data, only use the functions | `createStore`, `stateOf` |
| Every input is validated and fails with a **coded** `DomainError` | the helpers at the top of `inventory.js` |
| The waitlist is **strictly first-in-first-out** | `waitlistQueue.js`, `takeNextFromWaitlist` |
| You can only join the waitlist when the request **can't be booked now** | `joinWaitlist` |
| A booking is found by its code, typed any way (case, spaces, hyphen ignored; `O` read as `0`, `I`/`L` as `1`) | `findBookingByReference`, `referenceKey` |
| Returned bookings **can't be edited** by callers (they are frozen) | `bookTickets`, `cancelBooking` |

### "A failed booking changes nothing"

Every function that changes data follows the same order: **validate everything first, change state last.**
If any check throws, no line that changes the store has run yet, so there is nothing to undo. The test
`sold out throws and changes nothing` proves it by comparing state before and after.

### Error codes

Callers branch on `error.code`, never on the message text (which may change).

| Code | Meaning |
|------|---------|
| `VALIDATION` | bad input: blank name, quantity 0 or 11, price 9.99, invalid date |
| `NOT_FOUND` | unknown event, tier or booking reference; empty waitlist |
| `SOLD_OUT` | not enough seats (also: the first person in line needs more seats than are free) |
| `ALREADY_CANCELLED` | the booking was already cancelled |
| `SEATS_AVAILABLE` | tried to join the waitlist while seats are available and nobody is waiting |
| `WAITLIST_FIRST` | people are already waiting for that tier: join the line instead of booking directly |
| `ALREADY_WAITING` | that person is already in this tier's line |
| `EVENT_STARTED` | the event has begun: no new bookings or waitlist joins |

---

## 4. How the main pieces work

### Booking reference codes (`ids.js`)
A code looks like `7K2M-9Q4X`. It comes from the secure random source (`crypto`), **not** `Math.random()`,
which is predictable. The alphabet leaves out `I`, `L`, `O`, `U` so a code can be **read aloud** without
mix-ups. The alphabet has exactly 32 symbols, so `byte & 31` picks each one with equal probability.
The code uses `globalThis.crypto` rather than `node:crypto`: same secure generator, but it also works in the
browser so the UI can share the file.

### Money (`money.js`)
In JavaScript `0.1 + 0.2` is `0.30000000000000004`. So prices are stored as whole **kobo** (`500000` = ₦5,000.00).
Totals are integer × integer, which is always exact. Only `formatMoney` divides by 100, and only to print.
(The brief calls these "cents"; the field names say `priceCents`.)

### The waitlist queue (`waitlistQueue.js`)
```
head -> [Chidi] -> [Dayo] -> [Eze] <- tail
         next to leave                 new people join here
```
A hand-built linked list. `enqueue` attaches after the tail. `dequeue` moves the head forward.
Both just move a pointer, so both are **O(1)**. `array.shift()` would be O(n) because it slides every
other item along. The fields are private (`#head`, `#tail`, `#size`), so nothing outside can corrupt the chain.

### Strict FIFO promotion (`takeNextFromWaitlist`)
Only the **front** of the line can be served. If the first person needs 2 seats and 1 is free, the function
throws `SOLD_OUT` and changes nothing. It does **not** skip to someone behind who needs 1. This is the fair
reading of first-in-first-out, and a test covers it.

### Fairness: no queue jumping (`bookTickets`)
When seats free up, the people waiting get them first. While a tier has a line, `bookTickets` refuses strangers with
`WAITLIST_FIRST`, and `takeNextFromWaitlist` is the only way seats leave the line. Anyone who asks for tickets while a line
exists is told to join it, even if seats exist, so nobody gets ahead of people who waited. Someone who gives up
calls `leaveWaitlist` and everyone behind them moves up.

### Time (`createStore({ now })`)
The store has a clock, `Date.now()` by default. Once an event's start time has passed, new bookings and waitlist joins are refused
(`EVENT_STARTED`). Cancelling is still allowed. Tests pass a fake clock to travel past the start without waiting.
The demo, benchmark and UI create events **30 days in the future** so they never silently expire.

### Cancel names the next person (`cancelBooking`)
It returns `{ booking, seatsLeft, nextInLine, nextCanBeServed }`. It **names** the next person but does
not book them. Booking is a separate, explicit step (`takeNextFromWaitlist`).

---

## 5. Big O: why `Map` beats `Array.find`

Run `npm run benchmark`. Typical result (yours will differ):

```
  bookings        Map.get     Array.find    slower by
      1000        0.10 µs        6.05 µs          63x
     10000        0.09 µs       62.66 µs         675x
    100000        0.06 µs      446.97 µs        7406x
    400000        0.08 µs     2134.84 µs       28321x
```

- **`Map.get` is O(1).** It turns the key into a number (a hash) and jumps to that slot. The work doesn't
  depend on how many bookings exist, so the column stays flat.
- **`Array.find` is O(n).** It checks booking 1, then 2, then 3... until it finds a match. On average it
  checks half the list. Ten times more bookings means about ten times more work, so the column climbs.

That is why bookings are indexed in `store.bookings` (a `Map` keyed by reference code). The benchmark gives
`Array.find` the same data and the same random codes, so the comparison is fair.

Other Big O in this project:

| Operation | Cost |
|-----------|------|
| `findBookingByReference` | O(1) |
| `leaveWaitlist`, duplicate-name check in `joinWaitlist` | O(n) in the length of that line (short) |
| `bookTickets`, `cancelBooking` | O(1) |
| `Queue.enqueue / dequeue / peek / size` | O(1) |
| `listEvents`, `listWaitlist` (copy for display) | O(n) |

---

## 6. The React + Tailwind UI

`npm run dev` opens the screen. At the top is the **Find an event** panel (search, city, dates, max price, availability, sort); press an event to open it. Then try this on *Lagos Night of Tech*: book **6 Regular** tickets, then use **+** to ask for one more. The
button turns into **Join waitlist**. Join as two different people, look up a booking by its code, cancel it, then
press **Book them** on the first person in the waitlist.

**Design:** a dark hero banner with a calendar-style date block and live stats; ticket-shaped tier cards with a
perforated stub and a big "seats left" number (VIP is the dark, gold-trimmed one); a "Sold out" stamp; a numbered
waitlist with avatars; and a found booking shown as a ticket with a big reference code, a barcode and a
"Cancelled" stamp. The colours and font are tokens in `src/ui/index.css` (`@theme`), so changing the look means
editing one place. Motion is a small fade-up and switches off for people who ask their device for less motion.

How it is wired (every part is commented in `App.jsx`):

- The domain **store** lives in a `useRef`. It is a plain mutable object, not React state.
- Because React can't see changes to it, `run()` calls `refresh()` after every action to redraw.
- `run()` catches `DomainError`s and shows `CODE: message` in the activity feed. Any other error is a real
  bug and is re-thrown so it isn't hidden.
- The quantity stepper only allows 1 to 10, so the screen never sends a number the domain would reject.

---

## 7. Git and your first pull request

```bash
git checkout -b build-1-domain-core
git add .
git commit -m "Build 1: domain core, demo, benchmark, tests, React UI"
git push -u origin build-1-domain-core
# open a pull request on GitHub, request review, merge when approved
```

Make small, focused commits (for example one per file or rule), so the history tells the story.

---

## 8. Done-when checklist

- [ ] `npm run demo` shows: event sells out, booking refused, people join waitlist, booking cancelled, next in line named
- [ ] `npm run benchmark` shows `Map` far faster than `Array.find`, and you can explain it (section 5)
- [ ] `npm test` passes
- [ ] You **read the AI's code**, ran every check, and wrote what was wrong in `docs/ai-log.md`
- [ ] First pull request merged

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `SyntaxError` or odd module errors | Check `node --version`: it must be 22.13+ |
| `Cannot find package 'vite'` | Run `npm install` |
| `npm run test:ui` says a package is missing | Run `npm install` (Vitest, jsdom and Testing Library are dev dependencies) |
| A booking says `EVENT_STARTED` | The event's start time has passed. Use a future date in `startsAt` |
| Benchmark numbers differ from the README | Normal: speeds vary by computer. The *shape* (Map flat, Array growing) is what matters |
