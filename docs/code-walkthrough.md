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


---
---

# Part 3: Build 3

## 18. `src/domain/bookingStateMachine.js`: the life of a booking, as data

A **state machine** is a list of states plus a list of moves between them. At any moment a booking is in exactly one state, and it can only
change by following a move on the list.

```js
export const BookingState = Object.freeze({
  PENDING: 'pending', PAID: 'paid', CANCELLED: 'cancelled', REFUNDED: 'refunded', CHECKED_IN: 'checked_in',
});
export const BOOKING_STATES = Object.freeze(Object.values(BookingState));
```
- An object whose **keys** are readable constants (`BookingState.PAID`) and whose **values** are the words stored on a booking (`'paid'`).
  Writing `BookingState.PAID` instead of the text `'paid'` means a typo (`BookingState.PIAD`) gives `undefined` straight away instead of silently being a new state.
- `Object.freeze` makes it read-only. `Object.values(...)` lists the five words, so we have the list of all states without typing it twice.

```js
export const MOVES = Object.freeze([
  Object.freeze({ from: BookingState.PENDING, to: BookingState.PAID, label: 'payment received' }),
  ...
]);
```
- **Every allowed move, one line each.** This list is the only place the rules are written. A move that is not on this list does not exist.
  `label` is a human description, used in the diagram. Each entry is frozen too, so nobody can change a move while the program runs (a test tries).

```js
export const TRANSITIONS = Object.freeze(Object.fromEntries(
  BOOKING_STATES.map((state) => [state, Object.freeze(MOVES.filter((m) => m.from === state).map((m) => m.to))]),
));
```
- Builds a **lookup table** from the list: `{ pending: ['paid', 'cancelled'], paid: [...], cancelled: [], ... }`. Read it inside out:
  for each state, `MOVES.filter(m => m.from === state)` keeps the moves that start there, `.map(m => m.to)` keeps where they lead,
  and `Object.fromEntries` turns the pairs `[state, destinations]` into an object.
- Because the table is **built from** `MOVES`, the two can never disagree. A final state simply gets an empty list.

```js
export const isBookingState = (value) => typeof value === 'string' && Object.hasOwn(TRANSITIONS, value);
```
- "Is this one of the five states?" `Object.hasOwn` matters: `TRANSITIONS['toString']` exists on every JavaScript object, so a plain
  lookup would wrongly accept the text `'toString'` or `'__proto__'` as a state. `hasOwn` only counts the keys we defined.

```js
export function canTransition(from, to) {
  return isBookingState(from) && isBookingState(to) && TRANSITIONS[from].includes(to);
}
```
- A **question**: it answers `true` or `false` and **never throws**, whatever you pass in (a number, `undefined`, a made-up state).
  `&&` stops at the first `false`, so `TRANSITIONS[from]` is only read when `from` really is a state. Staying in the same state is `false`, because no move leads from a state to itself.

```js
export function assertTransition(from, to) {
  if (canTransition(from, to)) return;
  ...
  throw new DomainError(ErrorCode.INVALID_TRANSITION, message, { from, to, allowed: allowedFrom(from) });
}
```
- An **order**: "this move must be legal; stop everything if it is not". It calls the question first, so the two **cannot disagree**
  (a test checks that for every pair, including junk values). The long `if / else if` chain only builds a helpful message
  (`cancelled is final, nothing can leave it`). The error carries `allowed`, the moves that *would* have worked.

```js
export function bookingStatesToMermaid() { ... }
```
- Writes the diagram as text **from the data**. `docs/architecture.md` contains exactly this text, and a test compares the two, so the picture in the document can never drift away from the code.

## 19. `transitionBooking`: the one door (in `inventory.js`)

```js
export function transitionBooking(store, reference, to) {
  const booking = findBookingByReference(store, reference);
  assertTransition(booking.status, to);
  ...
```
- Find the booking (`NOT_FOUND` if the code is unknown), then **ask the state machine before touching anything**. If the move is illegal this
  throws, and no line below runs. That is "validate first, change state last" again, and it is why a refused move changes nothing.

```js
const had = holdsSeats(booking.status);
const will = holdsSeats(to);
if (had && !will) tier.sold -= booking.quantity;
if (!had && will) throw new Error('This move would need seats taken back: not implemented');
```
- **Seats follow the status.** `pending`, `paid` and `checked_in` hold seats; `cancelled` and `refunded` do not. A move from a holding state to a non-holding one
  (cancel, refund) gives the seats back **in the same step**. No move in the table goes the other way, so the last line cannot run today;
  it is a trip-wire: if someone adds such a move later, the program fails loudly instead of quietly breaking the seat count.

```js
const updated = Object.freeze({ ...booking, status: to, ...(to === 'cancelled' ? { cancelledAt: at } : {}),
  history: Object.freeze([...booking.history, Object.freeze({ status: to, at })]) });
state.bookings.set(referenceKey(booking.reference), updated);
```
- Bookings are frozen, so we cannot edit one: we build a **new** record. `...booking` copies every field, then `status: to` overrides one.
  `...(condition ? { cancelledAt: at } : {})` adds a field only when the condition holds (spreading `{}` adds nothing).
  `history` is the old list plus one new entry: an **audit trail** of every status the booking has had.
  The new record replaces the old one under the same key. Anyone still holding the old record sees the old status, unchanged.

`cancelBooking` now **uses** `transitionBooking`. One detail: cancelling twice still gives the friendly `ALREADY_CANCELLED` (Build 1's rule),
while every *other* illegal cancel (a refunded or checked-in booking) gives `INVALID_TRANSITION` from the state machine.

## 20. `src/http/errors.js`: one shape for every error

```js
export class HttpError extends Error { constructor(status, code, message, headers = {}) { ... } }
```
- The HTTP layer's own error: it carries the **status number** (404), a **code word** (`NOT_FOUND`), a message, and optional extra headers (a 405 needs `Allow`).

```js
export const HTTP_STATUS_BY_DOMAIN_CODE = Object.freeze({ VALIDATION: 400, NOT_FOUND: 404, SOLD_OUT: 409, ... });
```
- The **one table** that turns a business rule's code into an HTTP status. 400 = "the request itself is wrong", 404 = "no such thing",
  409 = "the request is fine, but it clashes with the current state of things" (sold out, illegal move, event started). A test fails if a new domain
  code is added without a line here, so it can't be forgotten.

```js
export function describeError(error) {
  if (error instanceof HttpError) return {...};
  if (error instanceof DomainError && Object.hasOwn(HTTP_STATUS_BY_DOMAIN_CODE, error.code)) return {...};
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } }, isBug: true };
}
```
- **Every** error in the system goes through this one function, and comes out as `{ error: { code, message } }`. Three cases: our own HTTP error, a business-rule error,
  and **anything else**, which is a bug. For a bug the client gets a generic sentence only, and `isBug: true` tells the caller to write the real details
  (message and stack trace) to the **server log**. The client never learns file names, line numbers or secrets.

## 21. `src/http/router.js`: which handler goes with this URL?

```js
router.get('/events/:id', handler);
router.match('GET', '/events/42');   // -> { handler, params: { id: '42' }, pattern: '/events/:id' }
```
- A route path is split into **segments**: `'/events/:id'` becomes `[ {literal: 'events'}, {param: 'id'} ]`. A segment starting with `:` is a **parameter**: it matches any one piece of the URL and remembers it by name.

```js
function splitPath(path) {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed === '/' ? [] : trimmed.slice(1).split('/');
}
```
- Drops one trailing slash (`/things/` = `/things`), and turns `/` into an empty list. `'/a/b'.slice(1).split('/')` is `['a', 'b']`.

```js
const params = Object.create(null);
```
- An object with **no prototype**. A normal `{}` inherits things like `__proto__` and `constructor`; if a URL contained `/x/__proto__` and we stored it into a normal object we could corrupt every object in the program (*prototype pollution*). With `Object.create(null)` the key `__proto__` is just a key. A test checks it.

```js
if (!best || route.literalCount > best.route.literalCount) best = { route, params };
```
- **Specific beats general.** `/events/new` (one fixed word) wins over `/events/:id` for the URL `/events/new`, whatever order they were registered in.

```js
const signature = `${upper} /${segments.map((s) => (s.param ? ':' : s.literal)).join('/')}`;
if (signatures.has(signature)) throw new Error(`Duplicate route ...`);
```
- `/a/:id` and `/a/:other` have the same *shape*, so they are the same route. Registering mistakes (no leading slash, bad parameter name, a duplicate) throw **at start-up**, long before any user can trigger them.

`allowedMethods(path)` lists which methods *do* have a route for a path: it is how the server tells a **405** (wrong method) from a **404** (nothing there).

## 22. `src/http/app.js`: what happens to every request

Read `handle(req, res)` from top to bottom; it is the whole story:

```js
res.setHeader('X-Request-Id', requestId);
res.on('finish', () => logger.info(`${req.method} ${JSON.stringify(path)} ${res.statusCode} ${ms}ms ${requestId}`));
```
- Each request gets a random id, sent back as a header and written in the log line, so "this request failed" can be matched to the server's record of it. The log leaves out the **query string** (it can contain tokens). `JSON.stringify` makes the path safe to print (it escapes control characters).

```js
const head = req.method === 'HEAD';
const method = head ? 'GET' : req.method;
```
- A HEAD request means "like GET, but send only the headers". We run the GET logic and drop the body at the end.

```js
const body = await readJsonBody(req, method, maxBodyBytes);
```
- The body is read **before** the route is looked up, as most web frameworks do. So broken JSON is a `400` wherever it is sent. `readJsonBody`:
  1. only POST, PUT and PATCH may carry a body (for others, the bytes are thrown away with `req.resume()`);
  2. if the client **announces** a size over the limit (`Content-Length`), refuse immediately without reading it (`413`);
  3. otherwise count the bytes as they arrive (`for await (const chunk of req)`) and stop at the limit, because a client can lie about the size or not send one;
  4. an empty body is fine ("no body"); a non-empty one must have a JSON `Content-Type` (`415` otherwise);
  5. `JSON.parse` inside `try/catch`: on failure the answer is a **fixed sentence** (`BAD_JSON`), not the parser's own message, which can quote pieces of the body.

```js
const found = router.match(method, pathname);
if (found) { const result = await found.handler({...}); sendJson(res, result.status ?? 200, result.body, ...); return; }
```
- A route exists: call its handler with one object (`params`, `query`, `body`...), and send the `{ status, body }` it returns. `await` means a handler can be asynchronous.

```js
const allowed = router.allowedMethods(pathname);
if (allowed.length > 0) throw new HttpError(405, ...);          // the path exists, the method does not
if (isApiPath(pathname)) throw new HttpError(404, ...);         // unknown /api/...: a JSON 404
if (method !== 'GET') throw new HttpError(405, ...);            // files only answer GET / HEAD
await files.serve(pathname, res, { head });                     // everything else: a file from public/
```
- After "no route", the order of questions matters: wrong method (405), then unknown API path (404), then files.

```js
} catch (error) {
  const { status, body, headers, isBug } = describeError(error);
  if (isBug) logger.error(`${requestId} ... ${error?.stack ?? error}`);
  if (res.headersSent) { res.destroy(); return; }
  sendJson(res, status, body, { headers, head });
}
```
- **Anything** that throws, anywhere above, lands here and becomes the standard JSON. A bug's stack trace goes to `logger.error` (the server's log) and never to the client.
  If the response has already started streaming (`headersSent`) the status can no longer be changed, so the honest thing is to cut the connection.

```js
const server = http.createServer((req, res) => { handle(req, res).catch((error) => {...}); });
```
- `handle` is `async`, so a failure inside it is a rejected promise, which Node would not catch for us. This `.catch` is the safety net under the safety net: the process must never crash because of one request.

```js
server.on('clientError', (error, socket) => { ... socket.end('HTTP/1.1 400 Bad Request ...' + json) });
```
- If a client sends bytes that are not even HTTP, Node answers with its own plain-text 400. We replace it with our JSON, so "every error has the same shape" is true without exception.

```js
close({ forceAfterMs = 5000 }) { server.close(cb); server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), forceAfterMs).unref(); }
```
- `server.close` alone **waits for every open connection**, and browsers keep connections open ("keep-alive"), so it can hang for a long time. We close the idle ones at once, give busy ones a few seconds, then force-close. `.unref()` means this timer alone won't keep the program alive.

## 23. `src/http/staticFiles.js`: files, and the walls around them

The attack is called **path traversal**: `GET /../../.env` tries to climb out of `public/` and read private files. The defence is **layers**, so one mistake is not enough:

```js
part = decodeURIComponent(raw);                       // 1. decode FIRST: "%2e%2e" becomes ".."
if (part.includes('\0') || part.includes('\\') || part.includes('/')) throw badPath();
if (part === '..') throw badPath();
if (part.startsWith('.')) throw notFound();           // 2. dotfiles: never served, and not even confirmed to exist
```
- Decode **before** checking: checking the raw text would miss every disguised `..`. Null bytes (can cut a file name short in some systems), backslashes (a folder separator on Windows) and `..` are refused outright with a `400`.

```js
let candidate = path.join(root, ...segments);
if (!isInside(root, candidate)) throw badPath();      // 3. is the joined path STILL inside public/ ?
```
- `isInside` uses `path.relative(parent, child)`: if the relative path starts with `..` the child is outside.

```js
const real = await realpath(candidate);               // 4. the REAL path, after following every symlink
if (!isInside(await realRootPromise, real)) throw notFound();
```
- A **symlink** is a shortcut. One inside `public/` could point at `/etc/passwd`; steps 1 to 3 would pass because the *name* looks innocent. `realpath` asks the file system where it really leads.

```js
const stream = createReadStream(file);
await new Promise((resolve, reject) => { stream.once('open', resolve); stream.once('error', reject); });
res.writeHead(200, headers);
await pipeline(stream, res);
```
- A file is **streamed** (sent in pieces), so a huge file never sits whole in memory. We wait until it has really opened *before* sending headers, so if opening fails we can still send a proper error. `pipeline` connects the file to the response and cleans up if either side gives up.
- Headers: `Content-Type` from the extension (the browser relies on it), `X-Content-Type-Options: nosniff` ("believe my Content-Type, don't guess"), and for HTML a `Content-Security-Policy` that only lets the page load things from this same server.

## 24. `src/config.js`, `src/server.js` and `src/services`

```js
const port = /^\d{1,5}$/.test(text) ? Number(text) : NaN;
```
- `parseInt('3000abc')` is `3000`: it silently ignores the junk. A mistyped setting should **stop** the program with a clear message, so PORT must be digits only (then checked for 0 to 65535). `0` is allowed: "any free port", which the tests use.

`server.js` is the **composition root**: the one file that creates things and plugs them together (`config → services → app`). Nothing else creates the world; everything else is *given* what it needs, which is what makes it testable.
- A bad `PORT` prints one line (`Cannot start: PORT must be...`) and exits with code `1`: no stack trace.
- `process.once('SIGTERM', ...)`: when you press Ctrl+C or the system asks the program to stop, it finishes the requests in progress and then exits with code `0`.

`healthService.check()` returns a **new** object each call, so nobody can alter the answer the next caller gets. It is a *liveness* check ("the program is up"); a *readiness* check ("and the database works") comes when a database exists.

## 25. The Build 3 tests

- **All 25 moves, one test each** (`for (const from of BOOKING_STATES) for (const to of BOOKING_STATES) test(...)`). With only 5 states, testing *everything* is cheaper than reasoning about which cases to pick. The expected answers are written a **second** time, as a different-shaped list, so a mistake in one has to be repeated in the other to go unnoticed.
- **The same 20 illegal moves on real bookings**: each one must be refused *and* leave the record, the seats and the history exactly as they were (`assert.equal(after, before)` compares the very same object).
- **A random walk**: 4,000 random move attempts (a tiny seeded generator, so a failure can be replayed). After **every** step: seats equal the sum of the bookings that hold seats; every history is a legal path; a move succeeded **only** if `canTransition` said yes.
- **Real network tests**: `startApp()` listens on port `0` (any free port), and the tests call it with `fetch` over a real connection. `rawRequest` uses `http.request` with an exact path, because `fetch` and `new URL()` quietly tidy `/../` away, which would hide the attack being tested.
- **A control experiment** in the traversal tests: before the 24 attacks, a test proves the secret file exists and an ordinary file is served. Otherwise "every attack failed" might only mean "the server is broken".
- **The architecture test** reads every `import` line of every file (after stripping comments) and fails if an arrow points the wrong way. That makes the diagram in `architecture.md` *enforced*, not just drawn.
- **Real process test**: starts `node src/server.js` as a separate program with `PORT=0`, reads its first line to learn the port, calls `/health`, sends `SIGTERM`, and checks the exit code is `0`. It also checks a bad `PORT` and a taken port exit with code `1` and a one-line message.
- **Mutation checks** (by hand, while building): weaken the code on purpose and make sure a test fails. Result worth knowing: removing **one or two** of the path-traversal defences leaked nothing (the layers cover for each other, as designed); removing **every** defence against climbing leaked, and the tests noticed. One layer, the backslash refusal, can't be seen from outside on Linux (a backslash is just a letter in a file name there), so it has its own test that demands a `400`.

## 26. The Postman collection (`postman/`)

- A collection is a JSON file: folders of requests, each with a `test` script written in JavaScript using `pm.test(name, fn)` and `pm.expect(...)` (Chai-style checks).
- `{{baseUrl}}` is a **variable**, filled in from the environment, so the same collection works on any port or, later, on a deployed server.
- A **collection-level** test runs after every request: it checks the `X-Request-Id` header and, for every status of 400 or more, that the body is *exactly* `{ error: { code, message } }` with no stack trace. Per-request tests only need to check the status and the code.
- The security folder sends the climbing paths and passes only if the answer is `400` or `404` and the project's `package.json` text did not leak.
- The collection was run with **Newman** (Postman's command-line runner) against the real server: 22 requests, 109 checks, 0 failures. The server log showed that the climbing paths arrived at the server unchanged, so the attacks were real.

## 27. Words from Part 3

| Word | Meaning |
|------|---------|
| **State machine** | a list of states and the moves allowed between them; anything not listed is illegal |
| **Final state** | a state with no moves out: the story is over |
| **Layer** | a group of code with one job, allowed to call only the layers below it |
| **Composition root** | the one place where the parts are created and plugged together (`server.js`) |
| **Route** | a method and a path, with the handler that answers it |
| **Path traversal** | tricking a server into reading files outside the folder it is meant to serve |
| **Symlink** | a file that is really a shortcut to another file or folder |
| **Stream** | sending data in pieces instead of all at once |
| **HTTP status** | the number that starts a response: 200 ok, 400 your mistake, 404 not found, 409 conflict, 500 our bug |
| **Request id** | a random label on each request, so the response and the log line can be matched |
| **Liveness** | "is the program up?" (`/health` today) |
