# Code walkthrough: every snippet explained

Read this next to the code. For each file you get: **what it is for**, then the important snippets with a
plain-language explanation of **what each line does and why it is written that way**. The comments inside the
files say the same things in short form.

Suggested reading order: `errors.js` → `ids.js` → `money.js` → `waitlistQueue.js` → `inventory.js` →
`demo.js` → `benchmark-lookup.js` → `test/` → `main.jsx` → `index.css` → `App.jsx`.

---

## 1. `src/domain/errors.js`: one error type for all rules

```js
export const ErrorCode = Object.freeze({ VALIDATION: 'VALIDATION', NOT_FOUND: 'NOT_FOUND', ... });
```
- A plain object listing every error code. `Object.freeze` makes it read-only: nobody can add or change a code
  later by accident. Using `ErrorCode.SOLD_OUT` instead of typing `'SOLD_OUT'` everywhere means a typo gives
  `undefined` (easy to spot) instead of a silent new code.

```js
export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
```
- `extends Error` makes our error a real JavaScript error: it has a `message` and a stack trace, and works with `try/catch`.
- `super(message)` calls the parent `Error` constructor so `message` is set properly.
- `this.code` is **machine-readable**. Code (and the UI) decide what to do by checking `error.code === 'SOLD_OUT'`,
  never by reading the message text, because wording can change.
- `details = {}` is a default value: if the caller passes nothing, `details` is an empty object, not `undefined`.
  Example: `{ requested: 3, available: 1 }`.
- Why a custom class? In `catch (e)` we can ask `e instanceof DomainError`. "A rule refused this" is handled
  nicely; any other error is a real bug and must crash loudly.

---

## 2. `src/domain/ids.js`: unique ids and booking codes

```js
export const newId = () => globalThis.crypto.randomUUID();
```
- Returns a long unique id like `3b241101-e2bb-4255-8caf-4136c566a962`. `globalThis.crypto` is the secure random
  generator built into Node 22 **and** browsers (so the UI can import this file too).

```js
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
```
- 32 symbols: digits and letters **without I, L, O, U**. When a code is read over the phone, "O" vs "0" and "I" vs "1"
  can't be confused. It is exactly 32 long, which matters next.

```js
const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
for (const b of bytes) code += ALPHABET[b & 31];
```
- Ask the secure generator for 8 random bytes (each 0 to 255).
- `b & 31` is a **bitwise AND**: it keeps the last 5 bits of the number, giving 0 to 31. 32 symbols, 32 outcomes,
  each equally likely. If we used `b % 30` some letters would appear more often (this unfairness is called
  *modulo bias*).
- `return `${code.slice(0, 4)}-${code.slice(4)}`` cuts the 8 characters in two halves with a hyphen: `7K2M-9Q4X`.
- Why not `Math.random()`? It is predictable: someone could guess other people's booking codes.

```js
export const referenceKey = (ref) =>
  String(ref).toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
```
- Turns whatever a person typed into the **key** used to store/find the booking, step by step:
  1. `String(ref)`: safe even if a number was passed.
  2. `.toUpperCase()`: case doesn't matter.
  3. `.replace(/O/g, '0')`: the letter O is read as zero. (`/g` = replace every one, not just the first.)
  4. `.replace(/[IL]/g, '1')`: I or L is read as one. This is safe **because we never generate O, I or L**.
  5. `.replace(/[^0-9A-Z]/g, '')`: delete everything that is not a digit or letter (spaces, hyphens).
- So `"7k2m 9q4x"`, `"7K2M-9Q4X"` and `"7k2m9q4x"` all become `7K2M9Q4X`.

---

## 3. `src/domain/money.js`: money without decimals

```js
export const isMoney = (n) => Number.isSafeInteger(n) && n >= 0;
```
- True only for whole numbers that are not negative. `500000` passes. `9.99`, `-5`, `"100"` and `NaN` fail.

```js
export const formatMoney = (cents) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(cents / 100);
```
- Why integers? In JavaScript `0.1 + 0.2` is `0.30000000000000004`. Money must be exact, so we count the smallest
  unit (kobo): ₦5,000.00 is `500000`. Adding and multiplying integers is always exact.
- `Intl.NumberFormat` is the built-in formatter: it prints `₦5,000.00` with the right symbol and commas.
- `cents / 100` makes a decimal, which is fine **only for printing**. Never calculate with the result.

---

## 4. `src/domain/waitlistQueue.js`: a queue built by hand

The picture to keep in mind:

```
head -> [Chidi] -> [Dayo] -> [Eze] <- tail
        next to leave                 new people join here
```

```js
class QueueNode { constructor(value) { this.value = value; this.next = null; } }
```
- One link of the chain. `value` is the data (a waiting person). `next` points to the next link, or `null` at the end.

```js
#head = null;  #tail = null;  #size = 0;
```
- `#` means **private**: only code inside the class can read or change these. Outside code can't corrupt the chain.
- We keep both `head` (to remove from the front) and `tail` (to add at the back) so both are instant.
- `#size` is a counter we update ourselves, so asking "how many?" never means counting the list.

```js
enqueue(value) {
  const node = new QueueNode(value);
  if (this.#tail) this.#tail.next = node; else this.#head = node;
  this.#tail = node;
  this.#size += 1;
  return this.#size;
}
```
- Make a link. If the queue already has a last link, attach the new one after it. If empty, the new link is also the head.
- The new link becomes the tail. We return the new size, which is also the person's **position** in line.
- No loop anywhere, so the cost never grows with the queue length: **O(1)**.

```js
dequeue() {
  if (!this.#head) return undefined;
  const node = this.#head;
  this.#head = node.next;
  if (!this.#head) this.#tail = null;
  this.#size -= 1;
  return node.value;
}
```
- Take the first link out. The second link becomes the head. If that leaves the queue empty we also reset the tail
  (forgetting this is a classic bug: the tail would point at a removed link). **O(1)**.
- Why not an array with `shift()`? `shift()` moves every other item one place left: **O(n)**.

```js
peek() { return this.#head?.value; }
```
- Look at the front without removing it. `?.` ("optional chaining") returns `undefined` instead of crashing when the
  queue is empty.

```js
remove(predicate) {
  let prev = null;
  for (let n = this.#head; n; prev = n, n = n.next) {
    if (!predicate(n.value)) continue;
    if (prev) prev.next = n.next; else this.#head = n.next;
    if (n === this.#tail) this.#tail = prev;
    this.#size -= 1;
    return n.value;
  }
  return undefined;
}
```
- Used when someone **leaves** the waitlist from anywhere in the line.
- Walk the chain, remembering the link before (`prev`). `predicate` is a function you pass in, e.g. `(e) => e.id === 'abc'`,
  that says "is this the one?".
- When found, **stitch around it**: the link before now points to the link after. Everyone behind moves up one place.
- Three edge cases: it was the head (head moves on), it was the tail (the previous link becomes the tail), or
  neither. Walking the chain makes this **O(n)**, which is fine for a short waitlist.

```js
*[Symbol.iterator]() { for (let n = this.#head; n; n = n.next) yield n.value; }
```
- A **generator**: it hands out values one at a time with `yield`. This one line lets you write
  `[...queue]` or `for (const x of queue)`. It walks the whole list (**O(n)**), so it's for display only.

---

## 5. `src/domain/inventory.js`: the rules

### The helpers at the top
```js
const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });
```
- A shortcut that builds a validation error naming the field: `quantity: must be a whole number from 1 to 10`.

```js
function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value.trim();
}
```
- Must be a real, non-blank string. Returns it **trimmed**, so `" Ada "` is stored as `"Ada"`.

```js
function whole(value, field, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw bad(...);
  return value;
}
```
- Must be a whole number inside a range. `Number.isSafeInteger` rejects `1.5`, `NaN`, `Infinity` and the string `"2"`, so
  nothing "number-like" sneaks in.

### The sealed store
```js
const STATE = new WeakMap();
export function createStore({ now = () => Date.now() } = {}) {
  const store = Object.freeze({});
  STATE.set(store, { now, events: new Map(), tiers: new Map(), bookings: new Map(), waitlists: new Map() });
  return store;
}
```
- The real data (four `Map`s) is stored in a `WeakMap` that only this file can see. What callers receive is an
  **empty frozen object**, just a ticket stub that points at the data. Nobody (UI, tests, you) can reach in and edit
  data without going through the rules. That is the idea called **encapsulation**.
- A `Map` is a key → value dictionary with instant lookup: `events` by event id, `tiers` by tier id,
  `bookings` by reference key (this is the **O(1)** lookup), `waitlists` by tier id (each value is a `Queue`).
- `now` is the **clock**. Normally the real time; tests pass a fake clock to "travel" past an event's start.
- `({ now = ... } = {})` is **destructuring with defaults**: `createStore()` works with no arguments.

```js
function stateOf(store) {
  const state = STATE.get(store);
  if (!state) throw bad('store', 'is not a store made by createStore()');
  return state;
}
```
- Every public function starts with this: swap the stub for the real data, or refuse a fake.

### Golden rule: validate first, change state last
Every function that changes data is written in the same order:
1. check everything (anything wrong → `throw`), and only then
2. change the data.

So if a rule refuses, **nothing has changed yet**. That is how "a failed booking changes nothing" is guaranteed.

### `bookTickets`
```js
const tier = getTier(state, eventId, tierId);
const qty = quantityOf(quantity);
const name = text(customer, 'customer');
assertNotStarted(state, state.events.get(eventId));
```
- Step 1: validate. Does the tier exist **and belong to this event**? Is the quantity 1 to 10? Is there a name? Has the
  event already started (`EVENT_STARTED`)?

```js
const available = seatsLeft(tier);
if (qty > available) throw new DomainError(ErrorCode.SOLD_OUT, ...);
```
- Step 2, the **capacity rule**: never sell more seats than exist.

```js
const waiting = state.waitlists.get(tier.id).size;
if (waiting > 0) throw new DomainError(ErrorCode.WAITLIST_FIRST, ...);
```
- Step 3, the **fairness rule**: if people are already waiting, strangers can't take freed seats. Only
  `takeNextFromWaitlist` (which serves the front of the line) gets past this.

```js
return createBooking(state, tier, qty, name);
```
- Step 4: now, and only now, state changes. `createBooking` (a private helper) does:
  - `while (state.bookings.has(referenceKey(reference))) reference = newReference();` picks a code and, in the
    (very unlikely) case it already exists, picks again, so two bookings can never share a code.
  - `Object.freeze({...})` builds the booking and **locks it**: anyone holding it can't edit it
    (trying throws a `TypeError`).
  - `totalCents: tier.priceCents * qty` integer × integer, always exact.
  - `tier.sold += qty` takes the seats; `state.bookings.set(referenceKey(reference), booking)` files it under its code.

### `findBookingByReference`
```js
const booking = state.bookings.get(referenceKey(reference));
```
- **One** `Map.get`. No loop. This single line is why lookup is O(1) and why `npm run benchmark` shows `Map` winning.

### `cancelBooking`
```js
if (booking.status === 'CANCELLED') throw new DomainError(ErrorCode.ALREADY_CANCELLED, ...);
tier.sold -= booking.quantity;
const cancelled = Object.freeze({ ...booking, status: 'CANCELLED', cancelledAt: ... });
state.bookings.set(referenceKey(booking.reference), cancelled);
```
- Refuse a second cancel (otherwise seats would be released twice and the tier would show more seats than exist).
- Release the seats. Because bookings are frozen we can't edit one, so we make a **copy** with `...booking`
  (the spread operator copies every property) and override `status`, then store the copy under the same key.
  We keep the record instead of deleting it: support staff still need to see it.
- `state.waitlists.get(tier.id).peek() ?? null` names the next person without removing them. `??` means
  "use the right side only if the left is `null` or `undefined`".

### `joinWaitlist`
```js
if (qty <= seatsLeft(tier) && queue.size === 0) throw ... SEATS_AVAILABLE
```
- Joining the line only makes sense if you can't be booked now: either seats are short, **or** others are already ahead.
```js
if ([...queue].some((e) => nameKey(e.customer) === nameKey(name))) throw ... ALREADY_WAITING
```
- One place per person. `[...queue]` turns the queue into an array, `some` asks "does anyone match?". `nameKey` lower-cases
  and squeezes spaces, so `"  ada   OBI "` equals `"Ada Obi"`. (Build 1 has no accounts, so a name is the only identity.)

### `leaveWaitlist` and `takeNextFromWaitlist`
- `leaveWaitlist` calls `queue.remove(...)` and returns who left plus who is now first.
- `takeNextFromWaitlist` looks at only the **head** (`peek`). If their whole party doesn't fit it throws and changes
  nothing: nobody behind skips ahead (**strict FIFO**). If it fits it calls `createBooking` **first** and `dequeue()` **second**,
  so if anything went wrong the person would still be in line, never lost. It uses `createBooking` rather than `bookTickets`
  so the fairness rule doesn't block the waitlist itself.

### Read helpers
- `listEvents` returns plain copies (with `seatsLeft`, `waitlistSize`, `started`) for drawing the screen.
- `listWaitlist` returns the line as an array, `listBookings` returns all bookings. They are copies/frozen, so callers
  can't change the store through them.

---

## 6. `scripts/demo.js`: the story

- Setup: one `createStore()`, one event, two tiers (Regular has only 4 seats so it sells out quickly).
- `const book = (tier, quantity, customer) => bookTickets(store, {...})` is a shortcut so each booking is one short line.
- `try { ... } catch (e) { if (!(e instanceof DomainError)) throw e; ... }` is the pattern used everywhere: **catch our
  own rule errors, re-throw anything else** so real bugs are never hidden.
- Steps: sell out → refusal (`SOLD_OUT`) and "seats unchanged" proof → waitlist → cancel names next in line →
  a stranger is refused (`WAITLIST_FIRST`) → front of the line is booked → cancelling twice is refused.

## 7. `scripts/benchmark-lookup.js`: proving Big O

- `build(n)` makes `n` real bookings; `byRef = new Map(list.map((b) => [b.reference, b]))` indexes the same bookings by code.
- `perLookup(refs, fn)` runs `fn` over 300 random codes five times and keeps the **best** round (the other rounds
  contain noise from garbage collection or other programs).
- `sink += ...` uses every result so the JavaScript engine can't delete the "unused" lookups as an optimisation.
- Reading the output: the `Map.get` column stays near 0.1 µs (**O(1)**); the `Array.find` column grows about 10× when
  the data grows 10× (**O(n)**).

---

## 8. Tests

### `test/domain.test.js` (Node's built-in runner)
```js
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof DomainError); return e.code; } assert.fail('did not throw'); };
```
- Runs `fn`, insists it throws one of **our** errors, and hands back the code, so tests read `assert.equal(code(() => book(2)), 'SOLD_OUT')`.
- `setup()` builds a fresh store for every test, so no test can affect another.
- A **fake clock** (`createStore({ now: () => t })`) lets the "event started" test travel in time by changing `t`.
- The **invariant test** runs 4,000 random actions with a tiny seeded random generator (same run every time, so a
  failure can be repeated) and, after every action, checks: seats sold equals the seats in confirmed bookings; sold stays
  between 0 and capacity; nobody is in the line twice; and no stranger ever booked while someone was waiting.

### `test/ui/app.test.jsx` (Vitest + Testing Library)
- `render(<App />)` puts the real screen into a fake browser (jsdom). `userEvent` clicks and types like a person.
- Elements are found **by what a user sees** (`getByRole('button', { name: 'Book tickets' })`), not by CSS classes, so
  restyling the page doesn't break the tests, and it also checks the buttons have proper accessible names.

---

## 9. The UI

### `index.html` and `main.jsx`
- `index.html` has an empty `<div id="root">` and one `<script type="module" src="/src/ui/main.jsx">`. Vite starts there.
- `main.jsx` runs `createRoot(document.getElementById('root')).render(<App />)`: React draws the app inside that div.
  `<StrictMode>` is a dev helper that renders twice on purpose to expose impure code.

### `vite.config.js`
- `plugins: [react(), tailwindcss()]`: `react()` teaches Vite JSX; `tailwindcss()` generates only the CSS classes your code uses.
- `test: { environment: 'jsdom', include: [...] }`: tells Vitest to use a fake browser and which files are UI tests.

### `index.css`
- `@import "tailwindcss";` loads Tailwind. `@theme { --color-ink: #0e1330; ... }` registers **design tokens**: defining
  `--color-ink` automatically creates `text-ink`, `bg-ink`, `border-ink`... so the whole UI shares one palette.
- `.barcode` is a repeating gradient of thin and thick black bars: a fake barcode with no image.
- `@media (prefers-reduced-motion: reduce)` switches animations off for people who asked their device for less motion.

### `App.jsx`: hooks, one by one
```js
const app = useRef(null);
if (!app.current) app.current = seed();
```
- `useRef` keeps one object alive across re-renders **without** triggering a re-render when it changes. We keep the
  domain store there. The `if` makes `seed()` run only once.

```js
const [, refresh] = useReducer((n) => n + 1, 0);
```
- React redraws when its *state* changes, but our store is outside React. `refresh()` bumps a throw-away counter, which forces a redraw
  so the screen shows the store's new contents. (The first array slot is left empty because we never read the counter.)

```js
const [quantity, setQuantity] = useState(1);
```
- `useState` is React's memory for a value that **should** redraw the screen when it changes (form fields, the lookup text, the log).

```js
const event = listEvents(store).find((e) => e.id === eventId);
```
- On every render we take a fresh read-only snapshot of the data. The screen never keeps its own copy of the rules or numbers.

```js
let found = null;
try { found = lookup.trim() ? findBookingByReference(store, lookup) : null; } catch { }
```
- Looks the typed code up on every keystroke (cheap: one Map lookup). A failure while typing is normal, so the `catch` is intentionally empty.

```js
function run(fn) {
  try { const message = fn(); if (message) say('ok', message); }
  catch (e) { if (!(e instanceof DomainError)) throw e; say('error', `${e.code}: ${e.message}`); }
  finally { refresh(); }
}
```
- **Every button goes through `run`**. It calls the domain function; a rule refusal becomes a red message; a real bug is re-thrown;
  `finally` always redraws, because even a refused action can change what should be shown.

```js
const say = (kind, text) => { const id = logId.current++; setLog((l) => [{ id, kind, text }, ...l].slice(0, 6)); };
```
- The id is made **outside** the updater function because React may run updater functions twice in development; side effects inside
  them would skip numbers. `[new, ...l].slice(0, 6)` puts the new message first and keeps only the latest six.

```js
const needsWaitlist = quantity > tier.seatsLeft || lineExists;
```
- The main button changes meaning: "Join waitlist" if seats are short **or** people are already waiting. This mirrors the domain's
  fairness rule so the UI never offers an action the domain would refuse.

### Reading the Tailwind classes
Tailwind classes are tiny single-purpose styles you combine. Example from a card:
`rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5`

| Class | Meaning |
|-------|---------|
| `rounded-3xl` | very round corners |
| `bg-white` | white background |
| `p-6` | padding on all sides (1.5rem) |
| `shadow-sm` | a soft small shadow |
| `ring-1 ring-ink/5` | a 1px outline in our `ink` colour at 5% opacity |
| `flex items-center justify-between gap-3` | a row; centred vertically; first item left, last item right; 0.75rem between items |
| `grid gap-8 lg:grid-cols-[1.2fr_1fr]` | a grid with space between cells; **from the `lg` screen size up** two columns (1.2 : 1) |
| `sm:text-6xl` | font size 6xl **from the `sm` screen size up** (mobile-first) |
| `hover:bg-cobalt/90` | on mouse hover, background at 90% opacity |
| `disabled:opacity-40` | when the button is disabled, fade it |
| `num` (our class) | equal-width digits so numbers don't jiggle |
| `animate-rise` | our fade-up entrance animation |
| `[background-size:20px_20px]` | square brackets = a custom one-off value |

### The visual components
- `Hero`: dark banner. The decorative blobs use `aria-hidden` so screen readers skip them. `toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })`
  always shows Lagos time, wherever the visitor is.
- `TierTicket`: progress bar width is `(sold / capacity) * 100` percent. The stub's two small circles are **page-coloured**, so they look like
  holes punched in the ticket.
- `Waitlists`: `listWaitlist(...)` gives the line; the first person gets a gold highlight and **Book them**; everyone gets **Leave**,
  with an `aria-label` saying whose Leave it is, since every row has the same visible word.
- `Pass`: a booking drawn as a ticket. A cancelled one fades and gets a rotated **Cancelled** stamp.
- `Activity`: `aria-live="polite"` makes screen readers announce new messages as they appear.

---

## 10. Glossary

| Word | Meaning |
|------|---------|
| **O(1)** | the work doesn't grow with the amount of data |
| **O(n)** | the work grows in step with the amount of data |
| **FIFO** | first in, first out: the line moves in the order people joined |
| **Invariant** | something that must always be true (for example seats sold = seats in confirmed bookings) |
| **Encapsulation** | hiding data so it can only change through the rules |
| **Immutable / frozen** | can't be edited after creation |
| **Validation** | checking input before using it |
| **Token** | a small stand-in object that points at something hidden (our sealed store) |
| **Hook** | a React function (`useState`, `useRef`...) that gives a component memory |
| **Render** | React drawing the screen from the current data |


---
---

# Part 2: Build 2

## 11. What changed in `inventory.js`

```js
const event = {
  id: newId(),
  title: text(data.title ?? data.name, 'title'),
  city: text(data.city, 'city'),
  venue: text(data.venue, 'venue'),
  startsAt: text(data.startsAt ?? data.date, 'startsAt'),
  status: EventStatus.DRAFT, // 'draft'
  tierIds: [],
};
parseWhen(event.startsAt, 'startsAt');
```
- An event now has a **title** and a **city** (Build 1 called the title `name`). `data.title ?? data.name` means "use `title`; if it is missing, accept the old `name`". Same for `startsAt` and the old `date`.
- `status: EventStatus.DRAFT` (the word `'draft'`): **every new event is private.** It becomes public only when the organizer publishes it.
- `parseWhen(...)` is called **before** `state.events.set(...)`, so a bad date throws and nothing is saved ("validate first, change state last" again).
- `const data = input !== null && typeof input === 'object' ? input : {};` makes `createEvent(store)`, `createEvent(store, null)` and `createEvent(store, 'text')` all give a clean `VALIDATION` error. (`typeof null` is `'object'` in JavaScript, which is why `null` is checked separately.)

```js
const view = (event) => ({ ...event, tierIds: [...event.tierIds] });
```
- A **copy** of an event to hand out. `{ ...event }` copies the fields, but `tierIds` is an array, and copying only the object would still share the same array, so we copy that too (`[...event.tierIds]`). Without this a caller could do `event.tierIds.push('x')` and change the stored event.

```js
export function publishEvent(store, eventId) {
  const event = getEvent(state, eventId);
  if (event.tierIds.length === 0) throw new DomainError(ErrorCode.INVALID_STATE, ...);
  event.status = EventStatus.PUBLISHED;
  return view(event);
}
```
- Look the event up (`NOT_FOUND` if missing). An event with **no tiers has nothing to sell**, so publishing is refused with `INVALID_STATE` ("the request was well formed, but not allowed in the current state"). That is different from `VALIDATION` (the input itself was bad).
- Setting `status` twice is harmless, so publishing a published event simply returns it.

```js
function assertBookable(state, event) {
  if (event.status !== EventStatus.PUBLISHED) throw new DomainError(ErrorCode.INVALID_STATE, ...);
  if (hasStarted(state, event)) throw new DomainError(ErrorCode.EVENT_STARTED, ...);
}
```
- One function holds the two "can people still book?" rules, and `bookTickets`, `joinWaitlist` and `takeNextFromWaitlist` all call it. One place to change a rule means no function can forget it. `cancelBooking` does **not** call it on purpose: cancelling is always allowed.

```js
export const MAX_PRICE_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / MAX_TICKETS_PER_BOOKING);
```
- A booking total is `price × quantity`. JavaScript numbers are exact only up to `Number.MAX_SAFE_INTEGER` (about 9 quadrillion). A price just under that limit times 10 would be **silently wrong**. So the largest price accepted is the limit divided by 10, and `totalCents` is always exact.

```js
status: 'PENDING',
```
- S06 says a new booking is **pending**. The seats are held right away (they count as sold), and cancelling releases them. Nothing "confirms" a booking yet: payment, in a later build, will.

```js
export function listEventSummaries(store, { publishedOnly = true } = {}) {
  ...
  minPriceCents: tiers.length ? Math.min(...tiers.map((t) => t.priceCents)) : null,
  seatsLeft: tiers.reduce((sum, t) => sum + seatsLeft(t), 0),
```
- Builds the small flat objects the search works on. `tiers.map(t => t.priceCents)` makes a list of prices, `...` spreads it into `Math.min(...)`, which picks the smallest.
- **`null` instead of `0` when there are no tiers**: 0 would mean "free". `null` means "no price", which is a different thing, and the search treats the two differently.
- `reduce` adds up the seats left across tiers. `publishedOnly = true` by default means drafts are private unless asked for.

## 12. `src/domain/dates.js`: real dates, the same on every computer

```js
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;
```
- A **regular expression** that describes exactly the allowed shapes. Read it piece by piece: `(\d{4})` four digits (year), `-`, `(\d{2})` month, `-`, `(\d{2})` day; then an optional group starting with `T` for the time: hours, `:`, minutes, optional `:seconds`, optional `.milliseconds`; then an optional zone: `Z` or `+01:00`/`-05:30`. `^` and `$` mean "the whole text, nothing extra". Each `( )` **captures** a piece so the code can read it.

```js
const check = new Date(Date.UTC(year, month - 1, day));
if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw ...
```
- The **round-trip check**. `Date.UTC` is forgiving: asked for 30 February it quietly returns 2 March. So we build the date, **read the pieces back**, and require them to equal what was written. 30 February comes back as 2 March, the day does not match, and it is rejected. (`month - 1` because JavaScript counts months from 0.)

```js
let offsetMinutes = LAGOS_OFFSET_MINUTES;   // no zone written: Lagos
if (zone === 'Z') offsetMinutes = 0;
...
return Date.UTC(year, month - 1, day, hour, minute, second, milli) - offsetMinutes * 60_000;
```
- A time with **no zone** is read as **Lagos time** (+01:00, Nigeria has no daylight saving). `Date.parse` would read it in the *computer's* zone, so the same event would sit at different instants on different computers.
- 17:00 at +01:00 happened at 16:00 UTC, so we **subtract** the offset. The result is milliseconds since 1970: one number you can compare with `<`, `>`.

```js
const hour = dateOnly ? (endOfDay ? 23 : 0) : Number(h);
```
- A date-only value has no clock part. As a start (`from`) it means **00:00:00.000**, as an end (`to`) it means **23:59:59.999**. This is how "up to 2026-12-05" can include an event at 5 PM on 5 December.

## 13. `src/domain/sorting.js`: the merge sort, line by line

A worked example, sorting `[5, 2, 4, 1]`:

```
sortPart([5,2,4,1])
  middle = 2
  left  = sortPart([5,2])  ->  left=sortPart([5])=[5]  right=sortPart([2])=[2]  merge -> [2,5]
  right = sortPart([4,1])  ->  [4] and [1]                                       merge -> [1,4]
  merge([2,5], [1,4]):  compare 2 vs 1 -> take 1;  2 vs 4 -> take 2;  5 vs 4 -> take 4;  left over 5 -> [1,2,4,5]
```

```js
if (items.length < 2) return items.slice();
```
- **Base case**: 0 or 1 items are already sorted, so recursion stops. `slice()` with no arguments returns a **copy**, so even here the caller never gets back their own array.

```js
const left = sortPart(items.slice(0, middle), compare);
const right = sortPart(items.slice(middle), compare);
return merge(left, right, compare);
```
- A function that **calls itself** on smaller problems is *recursion*. We sort each half (copies, so the original is never touched) and then merge the two sorted halves.

```js
if (order <= 0) merged[m++] = left[l++];
else merged[m++] = right[r++];
```
- The heart of it. `order` is what the comparator says about the two front items: negative = left goes first, positive = right goes first, **0 = equal**.
- `merged[m++] = left[l++]` means "put `left[l]` into `merged[m]`, then move both counters on by one" (`x++` returns the old value and then adds 1).
- **Stability lives in `<=`.** On a tie (`order === 0`) we take from the **left**, which holds the items that were earlier in the original list. If this said `< 0`, ties would take from the right and equal items would swap order.

```js
if (typeof order !== 'number' || Number.isNaN(order)) throw bad('compare', 'must return a number');
```
- A comparator that returns `undefined` or `NaN` makes every `<=` check false, which would **silently scramble** the result. We refuse loudly instead.

```js
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
```
- The built-in tool for comparing text the way people do: `sensitivity: 'base'` ignores case (and accents), and `numeric: true` puts "Show 2" before "Show 10" (plain alphabetical order would put "Show 10" first because `"1" < "2"`).

```js
export const compareNumbers = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
```
- Written out instead of `a - b`, because `Infinity - Infinity` is `NaN`.

**Why O(n log n)?** Halving a list of n items takes log₂ n rounds (1000 items need 10 halvings). In every round, merging touches each item once, so a round costs about n. Total: n × log₂ n. It does not matter whether the input is sorted or reversed: always n log n.

## 14. `src/domain/eventSearch.js`

```js
function readCriteria(criteria) { ... }
```
- All input checking happens in this one function, **before** looking at any event. So bad input is refused even when the list is empty (a test checks exactly that), and the checking is done once, not once per event.
- It also prepares the values: `q` and `city` are trimmed and lower-cased **once**, and the dates are turned into milliseconds **once**.

```js
toMs: isUnset(to) ? null : parseWhen(to, 'to', { endOfDay: isDateOnly(to) }),
```
- If `to` is a date-only value like `"2026-12-05"`, it becomes the **end** of that day. If it has a time, it is that exact moment.

```js
return summaries.filter((e) => { ... return true; });
```
- `Array.filter` builds a **new** array from the items for which the function returns `true`. Inside, every criterion that fails does `return false` early; surviving all of them means `return true`. The original array is never touched.

```js
if (c.maxPriceCents !== null) {
  const price = priceOf(e);
  if (price === null || price > c.maxPriceCents) return false;
}
```
- `price === null` is the "no tiers, no price" case: such an event is **left out** of a price filter. A price of `0` is a real price (free), so it is compared normally.

```js
const byTitleThenId = (a, b) => compareText(a.title, b.title) || compareIds(a.id, b.id);
```
- `||` returns the first value that is not `0`. `compareText` gives `0` for equal titles, so the id decides. This is how **every sort ends with the same tie-breakers**, which makes the final order completely fixed (the same whatever order the events arrived in; a test checks that with three different input orders).

```js
date: (a, b) => { ... return (xNaN ? 0 : compareNumbers(x, y)) || byTitleThenId(a, b); },
```
- Compare the start times; if they are equal, fall back to title, then id. An event whose date can't be read sorts **last**.

```js
availability: (a, b) => compareNumbers(b.seatsLeft ?? 0, a.seatsLeft ?? 0) || byTitleThenId(a, b),
```
- `(b, a)` instead of `(a, b)`: swapping the arguments **reverses** the direction, so the most seats come first.

```js
if (typeof sortBy !== 'string' || !Object.hasOwn(COMPARATORS, sortBy)) throw ...
```
- `Object.hasOwn` asks "is this one of the keys I defined?". Plain `COMPARATORS[sortBy]` would wrongly accept `'toString'`, because every object inherits a `toString`.

```js
export function searchEvents(summaries, criteria, sortBy = 'date') {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}
```
- **Filter first, then sort**: sorting costs n log n, so sorting fewer items is cheaper.

## 15. `scripts/demo-search.js` and `scripts/benchmark-sort.js`

- `demo-search.js` follows the real flow: create (draft) → add tiers → publish → `listEventSummaries` → `searchEvents`. It keeps `JSON.stringify(all)` before and after, and prints `unchanged: true`: a visible proof that searching never changes the list.
- `benchmark-sort.js` compares the merge sort with a simple **insertion sort** (O(n²)): each row doubles the list. Insertion sort's time quadruples (≈4×); merge sort's a little over doubles (≈2×). Part 2 divides the time by `n × log₂ n` and shows the result is roughly **constant**, which is what "the work is proportional to n log n" means. Each measurement is warmed up and the best of several runs is kept, because the first runs are slowed by JavaScript's compiler warming up and by garbage collection.

## 16. The Build 2 tests

```js
export function deepFreeze(value) { ... Object.freeze(value); for (const inner of Object.values(value)) deepFreeze(inner); }
```
- `Object.freeze` stops an object being edited; `deepFreeze` does it for everything **inside** as well. ES modules run in strict mode, where writing to a frozen object **throws**. So running a function on a frozen list **proves** it never modified it: if it had tried, the test would crash.

```js
Array.prototype.sort = () => { throw new Error('the built-in sort was called'); };
try { mergeSort(...) } finally { Array.prototype.sort = original; }
```
- Replaces the built-in sort with a trap that throws, runs our sort, and **always puts the original back** (`finally`), so a failing test can't break the others. If `mergeSort` secretly used the built-in, the test would catch it.

```js
const expected = [...items].sort((a, b) => a.key - b.key);
assert.deepEqual(mine, expected);
```
- The built-in sort is used **only inside a test**, as an *oracle*: an independent answer to compare against, on 300 random lists with many ties (so stability is checked too). The rule "don't use the built-in sort" applies to the code being delivered, not to the checker.

- **One test per acceptance criterion**, named after the story (`S05: ...`), so you can see at a glance that every criterion is covered. Extra edge cases are marked `(extra)`.
- `error-codes.test.js` triggers **every** error code for real, and its last test fails if someone adds a code without a trigger.
- **Mutation check** (done by hand while building, not a script): break the code on purpose (for example change `<=` to `<` in the merge) and make sure at least one test fails. A test that can't fail proves nothing. Eleven deliberate bugs were tried; all were caught.

## 17. The search screen (`App.jsx`)

```js
const summaries = listEventSummaries(store);
let results = []; let searchError = null;
try { results = searchEvents(summaries, {...}, filters.sortBy); }
catch (e) { if (!(e instanceof DomainError)) throw e; searchError = `${e.code}: ${e.message}`; }
```
- The screen **does not filter or sort anything itself**. It builds the criteria from what the person typed and calls the same `searchEvents` the tests use. If the domain refuses (for example a price that is not a number) the message is shown in red instead of crashing.

```js
maxPriceCents: filters.maxNaira.trim() === '' ? undefined : Math.round(Number(filters.maxNaira) * 100),
```
- The person types naira ("5000"); the domain wants whole kobo. `Number('abc')` is `NaN`, and `NaN` is not a whole number, so the domain says `VALIDATION`. `Math.round` fixes things like `19.99 * 100 = 1998.9999999999998`.

```js
const tier = event.tiers.find((t) => t.id === tierId) ?? event.tiers[0];
```
- After opening a different event, the remembered tier id belongs to the **old** event, so `find` returns `undefined`, and `??` falls back to the first tier of the new one. (The first version of this line would have crashed.)

```js
const cities = mergeSort([...new Set(summaries.map((e) => e.city))], compareText);
```
- `map` takes each event's city; `new Set(...)` removes duplicates; `[...set]` turns it back into an array; `mergeSort` (ours) puts the cities in order for the drop-down.

- `<ul aria-label="Search results">` and `aria-label="Open Abuja Jazz Night"` give screen readers (and the tests) a name for each control. `aria-pressed` marks which event is open.
