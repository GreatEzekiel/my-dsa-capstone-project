# Event Ticketing: Builds 1 and 2

The rules of an event ticketing system, built from an empty folder.

- **Build 1 (domain core):** events, ticket tiers, bookings with a capacity rule, a first-in-first-out waitlist,
  and instant lookup of a booking by its reference code.
- **Build 2 (search):** events start as drafts and are published; **search and filter** by text, city, date range
  and price; **sort** by date, price or availability with a **merge sort written from scratch**; the backlog as
  user stories with acceptance criteria (`docs/user-stories.md`); and automated tests for every story.

---

## 1. Quick start

```bash
npm install            # installs Vite, React, Tailwind and the test tools (the domain itself needs no packages)

npm run demo           # Build 1: the booking and waitlist story, in the terminal
npm run demo:search    # Build 2: draft -> publish -> search, filter and sort, in the terminal
npm run benchmark      # Map.get vs Array.find (lookup by reference code)
npm run benchmark:sort # our merge sort O(n log n) vs insertion sort O(n squared)

npm test               # EVERY test: the domain tests, then the UI tests (fails if any test fails)
npm run test:domain    # only the domain tests (Node's built-in runner, no packages needed)
npm run test:ui        # only the UI tests (the real screen in a fake browser)

npm run dev            # React UI with instant reload at http://localhost:5173
npm run build          # production build of the UI into dist/
```

Requires **Node 22.13 or newer** (`node --version`).

---

## 2. Project map

```
src/
  domain/                  the rules (no React, no DOM, no printing)
    errors.js              DomainError + the list of error codes
    ids.js  money.js  dates.js  waitlistQueue.js  sorting.js  eventSearch.js  eventStatus.js   (pure rules)
    inventory.js           the data: in-memory store + events, tiers, publishing, bookings, cancel, waitlist
  ui/                      the React screen (search panel + event page)
scripts/                   demo.js  demo-search.js  benchmark-lookup.js  benchmark-sort.js
test/                      domain.test.js  dates.test.js  sorting.test.js  s02..s06 story tests  error-codes.test.js  helpers.js
  ui/app.test.jsx          the real screen in a fake browser (Vitest)
docs/
  build-2.md               the brief and how to check "Done when"
  user-stories.md          the backlog: stories + acceptance criteria + definition of done
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
| Events are created as **drafts**; only a **published** event is public and bookable | `createEvent`, `publishEvent`, `assertBookable` |
| An event with **no ticket tiers can't be published** (`INVALID_STATE`) | `publishEvent` |
| Dates are **real ISO dates**; a time with no zone means **Lagos time** | `dates.js` |
| **Search never changes the list it is given**; results are always new arrays | `eventSearch.js` |
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
| `INVALID_STATE` | not allowed in the current state: publishing an event with no tiers, or booking a draft |

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

## 5b. Build 2: search, filter and sort

### The flow

```js
import { createStore, createEvent, addTier, publishEvent, listEventSummaries } from './src/domain/inventory.js';
import { searchEvents } from './src/domain/eventSearch.js';

const store = createStore();
const event = createEvent(store, { title: 'Abuja Jazz Night', city: 'Abuja', venue: 'Jabi Lake Park', startsAt: '2026-12-05T18:00:00+01:00' });
//    ^ saved as a DRAFT: private, not on the public list
addTier(store, event.id, { name: 'General', priceCents: 800_000, capacity: 40 });
publishEvent(store, event.id);            // needs at least one tier, otherwise INVALID_STATE

const list = listEventSummaries(store);   // the PUBLIC list: published events only
searchEvents(list, { q: 'jazz', city: 'abuja', maxPriceCents: 1_000_000, to: '2026-12-05' }, 'price');
```

### The criteria (all optional; an event must pass every one that is given)

| Criterion | Meaning |
|-----------|---------|
| `q` | a piece of the **title or venue**, ignoring case |
| `city` | the **whole** city name, ignoring case (`"lagos"` matches `"Lagos"`, not `"Lagos Island"`) |
| `from`, `to` | **inclusive** ISO dates. A date-only `to` (`"2026-12-05"`) includes the **whole day** |
| `maxPriceCents` | compared with the event's **cheapest tier**; events with **no tiers are left out** |
| `onlyAvailable` | only events with at least one seat left |

Sort options: `'date'` (earliest first), `'price'` (cheapest first, **no price last**), `'availability'` (most seats left first).
Ties always break by **title, then id**, so the order is the same every time.
A bad date, a price that is not a whole number, a wrong type or an unknown sort option gives `VALIDATION`.

### Pure functions, and why that matters
`filterEvents`, `sortEvents` and `searchEvents` take a list and return a **new** list. They never change the list
they are given and never touch the store. So they are easy to test (the tests pass in a **frozen** list, which would
throw if anything tried to edit it), and the UI can run them on every keystroke.

### The merge sort (`sorting.js`)
```
[5, 2, 4, 1]  ->  split  [5, 2] [4, 1]  ->  split  [5] [2] [4] [1]
                  merge  [2, 5] [1, 4]  ->  merge  [1, 2, 4, 5]
```
- **Divide and conquer:** split in half until each piece has one item (already sorted), then **merge** sorted
  pieces. Merging two sorted lists is one pass: repeatedly take the smaller front item.
- **Stable:** when two items are equal, the merge takes from the **left** half (the items that were earlier). That
  single `<=` is what keeps equal items in their original order. Stability is what lets "sort by price" keep
  events with the same price in title order.
- **It returns a new array** and never edits the input. It does **not** call the built-in sort (a test replaces the
  built-in with a function that throws, and another reads the source).
- **Big O:** time **O(n log n)** always (log₂ n levels of halving, n items merged per level); extra space **O(n)**.
  `npm run benchmark:sort` shows it: doubling the list costs about 4x for insertion sort (O(n²)) but a little over
  2x for merge sort.

### Dates (`dates.js`)
Dates are ISO strings, parsed strictly. `Date.parse` would accept `2026-02-30` (it silently becomes 2 March) and
would read a time with no zone in the **computer's** local time. `parseWhen` rejects dates that do not exist, and
a time with no zone means **Lagos time (+01:00)** on every computer.

### Decisions the brief left open (change them if your class decides otherwise)
- **Sort by date compares the full start time**, then title, then id. Two events on the same day at different
  times are ordered by time; events starting at the *same moment* are in title order.
- `sortEvents` needs an explicit option; `searchEvents` defaults to `'date'`.
- `from` after `to` finds nothing (it is not an error).
- Publishing an already published event is harmless. `unpublishEvent` exists for the "unpublish" in S04.
- A new booking is **PENDING**; nothing confirms it yet (a later build adds payment).
- Booking or joining the waitlist for an event that is not **published** gives `INVALID_STATE`.
- Old field names `name` and `date` are still accepted by `createEvent`.

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
- [ ] `npm test` passes (domain tests, then UI tests)
- [ ] `npm run demo:search` shows search, filter and sort, and "the original list was never changed: true"
- [ ] `npm run benchmark:sort` shows merge sort growing about 2x per doubling and insertion sort about 4x
- [ ] Every story in `docs/user-stories.md` has acceptance criteria, and **S04's are your class's own**
- [ ] You **read the AI's code**, ran every check, and wrote what was wrong in `docs/ai-log.md` (filled in, with every problem marked fixed; add anything *you* find)
- [ ] First pull request merged

---

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `SyntaxError` or odd module errors | Check `node --version`: it must be 22.13+ |
| `Cannot find package 'vite'` | Run `npm install` |
| `npm run test:ui` says a package is missing | Run `npm install` (Vitest, jsdom and Testing Library are dev dependencies) |
| A booking says `EVENT_STARTED` | The event's start time has passed. Use a future date in `startsAt` |
| Benchmark numbers differ from the README | Normal: speeds vary by computer. The *shape* (Map flat, Array growing) is what matters |
