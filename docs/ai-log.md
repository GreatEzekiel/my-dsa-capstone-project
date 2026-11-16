# AI log: Build 1

What the AI produced, what I checked, what was wrong, and how each problem was fixed. Rule I followed: do not
trust the first answer. Read it, run it, try to break it. **Every problem below is now fixed**, except the
one honest limit at the very end.

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Demo tells the whole story | `npm run demo` | Passes: sell-out, refusal (`SOLD_OUT`), 2 waitlisted, cancel names next in line, a stranger refused (`WAITLIST_FIRST`), front of line booked, double-cancel refused |
| Map vs Array.find | `npm run benchmark` | `Map.get` stays about 0.1 µs; `Array.find` grows from about 6 µs (1k) to about 2,000 µs (400k) |
| Domain tests | `npm test` | 20 pass |
| Invariant test | 4,000 random book / cancel / join / promote / leave actions, rules and books checked after each | Seats sold always equals seats in confirmed bookings, never above capacity, nobody in a line twice, nobody ever jumped the line |
| Hand-made edge cases | A throwaway script: wrong event for a tier, no arguments, `'1'` as quantity, empty waitlist, tampering with a returned booking | Found problems 4 and 5 below |
| UI behaviour | `npm run test:ui`: 5 tests open the real screen in a fake browser and click through the full story | Pass |
| UI builds | `npm run build` | Builds |
| UI look | I cannot see a screen in my sandbox | **Not checked by eye. Open `npm run dev` and look at it, especially on a phone-sized window** |

## Problems found and fixed

| # | Where | What was wrong | How it was found | Fix |
|---|-------|----------------|------------------|-----|
| 1 | `ids.js` | The prompt said use `node:crypto`. The code uses `globalThis.crypto` so the browser UI can share the file. | Read the code against the prompt | Kept on purpose: same secure generator. Written down here as a deliberate deviation |
| 2 | `package.json` | `"test": "node --test tests/"` failed: Node 22 does not treat a bare folder as "run everything inside" | Ran `npm test` | `node --test tests/*.test.js` |
| 3 | `benchmark-lookup.js` | First version was unfair: the Map side also cleaned the reference with a regex on every lookup, and used one noisy run. At 100k bookings Map even looked slower, contradicting the text printed under the table. | Read the output against the claim | Same key and data on both sides, best of 5 rounds, and the printed claim matches the numbers |
| 4 | `inventory.js` | `bookTickets` returned the **live object** stored inside the store. Setting `booking.status = 'HACKED'` changed the store, and a later cancel still worked. | Edge-case script | Bookings and waitlist entries are frozen. Cancelling stores a new cancelled copy. `createEvent` and `addTier` return copies. Tests added |
| 5 | `ids.js` | Codes are meant to be read aloud, but typing `O`, `I` or `L` for `0` or `1` found nothing. | Thought through the phone-call case | `referenceKey` reads `O` as `0` and `I`/`L` as `1`. Safe because codes never contain O, I or L. Unit test plus an end-to-end test |
| 6 | `App.jsx` | The activity-log id was made inside a `setState` updater. React may run updaters twice in development, so ids skipped. | Read the code with React's rules in mind | Id is made before calling `setLog` |
| 7 | `App.jsx` | The quantity box accepted 0 and 11, and for 11 the hint said "join the waitlist", which is wrong (11 is simply not allowed). | Typed 11 | Replaced with a − / + stepper limited to 1 to 10. A UI test checks the limits |
| 8 | my own scaffolding | A shell command with `{a,b}` folder shorthand created a folder literally named `{src` | Looked at the output | Deleted it. Not part of the project |

## Gaps I listed earlier, now all fixed

| # | Gap | Fix | Proof |
|---|-----|-----|-------|
| G1 | **Queue jumping.** When seats freed up, a stranger could call `bookTickets` before the person who waited. | `bookTickets` refuses with `WAITLIST_FIRST` while a tier has a line. `takeNextFromWaitlist` (front of line only) is the only way seats leave it. `joinWaitlist` now also accepts people when seats exist but others are ahead. | Test "no queue jumping"; the invariant test fails if a stranger ever books while someone waits; demo step 6; UI test shows the button stays "Join waitlist" |
| G2 | **A waitlisted person who booked directly stayed in line.** | Direct booking is blocked while a line exists (G1), so a waiting person can only be booked from the line. Added `leaveWaitlist` (and `Queue.remove`) so anyone can give up their place. A **Leave** button was added to the UI. | Tests "leaving the waitlist", "queue.remove works for middle, front and back"; UI test clicks Leave |
| G3 | **The same person could join the waitlist twice.** | `joinWaitlist` throws `ALREADY_WAITING` for the same name in the same tier (case and spacing ignored). They can rejoin after leaving. | Test "the same person cannot join twice, but can rejoin after leaving" |
| G4 | **No time rule: booking was possible after the event started.** | The store has a clock (`createStore({ now })`). Once the start time passes, `bookTickets`, `joinWaitlist` and `takeNextFromWaitlist` throw `EVENT_STARTED`. Cancelling stays allowed. `listEvents` reports `started`, and the UI disables the button and says so. | Test with a fake clock that travels past the start |
| G5 | **The store was exported raw**, so tests and callers could reach into the maps. | The data now lives in a private `WeakMap` inside `inventory.js`. `createStore()` returns an empty frozen token. Tests use only public functions (`listEvents`, `listBookings`, `listWaitlist`). A fake store is refused. | Test "the store is sealed" |

## Problems I caused while fixing, and corrected

| # | What | Fix |
|---|------|-----|
| F1 | Adding the time rule (G4) would have broken the demo, benchmark, tests and UI, because they all used a hard-coded 2026 event date that will eventually be in the past. | All of them now create the event 30 days in the future |
| F2 | My first rewrite of the "strict first-in-first-out" test was muddled: it set up a store it never used. | Replaced with two clear tests: one where the front party does not fit and nobody behind is served, one where the line is served in order |

## Rules the prompt left open (my decisions: change them if the course says otherwise)

- **Joining the waitlist:** allowed when you can't be booked now: not enough seats, or others are already waiting.
- **Cancel:** names the next person but does not book them. Booking them is a separate step, `takeNextFromWaitlist`.
- **Strict first-in-first-out:** if the first person needs 2 seats and 1 is free, nobody behind them is served.
- **Waiting people go first:** while a tier has a line, direct bookings are refused (`WAITLIST_FIRST`).
- **Time:** no bookings or joins once the event has started; cancelling is still allowed.
- **Money:** whole kobo. The prompt says "cents", so the field is `priceCents`.
- **Reference format:** 8 characters from a 32-symbol alphabet, shown as `ABCD-EFGH`.
- **Error codes:** `VALIDATION`, `NOT_FOUND`, `SOLD_OUT`, `ALREADY_CANCELLED`. The other four (`SEATS_AVAILABLE`, `WAITLIST_FIRST`, `ALREADY_WAITING`, `EVENT_STARTED`) are mine.

## One honest limit that remains

Identity is just a **name**. "Ada Obi" typed twice is the same person, but two different people who happen to share a
name would be treated as one, and nothing stops someone using a different name to join twice. Real identity needs
accounts, which is outside Build 1. Decide it in Build 2.

---
---

# Build 2: search, sorting, backlog, first tests

Same rule as Build 1: read it, run it, try to break it. The brief says "when it answers, do not trust it yet".

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Every acceptance criterion has a test | S02 (2 criteria), S03 (3), S05 (7), S06 (3), S04 (3 **proposed**), tests named `S0x: ...` | Pass |
| Merge sort correct and stable | 300 random lists with many ties compared with the built-in sort (used only as an oracle in the test) | Identical |
| The built-in sort is not used | The test replaces `Array.prototype.sort` with a function that throws, and another test reads the source | Pass |
| Input never changed | The search tests pass in a **deep-frozen** list: any write would throw | Pass |
| Every error code reachable | `test/error-codes.test.js` triggers all 9 for real and fails if a new code has no trigger | Pass |
| **Do the tests catch bugs?** | I broke the code on purpose 11 ways (merge ties, inclusive `to`, end-of-day, price filter, city match, status, publish rule, public list, 30 February, price cap, swapped order) | Every one made at least one test fail (see F2 below for one that first looked like it survived) |
| Sort speed | `npm run benchmark:sort` | Insertion sort about 4x per doubling, merge sort a little over 2x, and ns per n log n stays flat |
| UI | `npm run test:ui`: 13 tests, including search, city, price, dates, errors, opening another event and booking there | Pass |
| Whole suite | `npm test` | Domain tests and UI tests pass |
| UI look | I cannot see a screen in my sandbox | **Not checked by eye.** Open `npm run dev`, try the search panel, and check it at phone width |

## Problems found and fixed

| # | Where | What was wrong | How it was found | Fix |
|---|-------|----------------|------------------|-----|
| B1 | Build 1 `createEvent` | It checked dates with `Date.parse`, which **accepts 30 February** (it rolls over to 2 March). S02 says a date that is not real must be rejected. | Ran `Date.parse('2026-02-30')` in Node: it returned a number | New `dates.js` with a strict ISO parser and a round-trip check. Tests for 30 February, 29 February in non-leap years, month 13, hour 24 |
| B2 | Dates in general | `Date.parse` reads a time **with no zone** in the computer's own zone, so the same event would sit at different instants on different computers, and a date filter would give different results. | Reading the date rules against the "5 PM on 5 December, up to 2026-12-05" criterion | A time with no zone means Lagos time (+01:00). A date-only `to` means the end of that day, a date-only `from` the start |
| B3 | Build 1 `addTier` | `priceCents` could be `Number.MAX_SAFE_INTEGER`; times 10 tickets the total is **no longer exact**, which breaks "priced in whole cents". | Thinking through S06's "whole cents" with the biggest possible numbers | `MAX_PRICE_CENTS` (the safe limit divided by 10). Test at the limit and one above |
| B4 | Build 1 booking status | New bookings were `CONFIRMED`; S06 says a new booking is **pending**. | Reading S06 against the code | Bookings start `PENDING`; seats are held; cancel releases them. Build 1 tests and the UI ("Pending") updated |
| B5 | Build 1 booking | **Any** event could be booked, including one the organizer never published. S02 says a new event is a private draft. | Reading S02 and S04 against the code | `bookTickets`, `joinWaitlist` and `takeNextFromWaitlist` all call `assertBookable`: not published gives `INVALID_STATE` |
| B6 | `benchmark-sort.js` (first version) | It printed "about 2.1x" under a table that showed 1.6x, 3.2x, 2.1x and 3.8x for merge sort. A claim that did not match the numbers (the same mistake as Build 1's benchmark). | Reading the output against the text | Warm-up runs and best of 9, a Part 2 on bigger lists, and a column of "ns per n log n" that stays flat. The wording now says small lists are noisy |
| B7 | `sorting.js` | A comparator returning `undefined` or `NaN` would **silently scramble** the order (every `<=` is false). | Thinking about what a bad comparator does | The merge throws `VALIDATION` if a comparator does not return a number |
| B8 | `App.jsx` | After opening another event, the remembered tier belonged to the old event, so `find` returned `undefined` and the page would have crashed. | Tracing "open another event" by hand, then a UI test | `find(...) ?? event.tiers[0]`, and a test that opens another event and books there |
| B9 | folder name | Build 1 used `tests/`; the brief says `test/`. | Reading the prompt | Moved to `test/`; `npm test` now runs the domain tests **and** the UI tests, so "every test runs" is true |

## Problems I caused while fixing, and corrected

| # | What | Fix |
|---|------|-----|
| F1 | Changing `name` to `title`, adding `city` and publishing would have broken the Build 1 demo, benchmark, tests and UI. | All were updated, and `createEvent` still accepts the old `name` and `date` field names |
| F2 | One of my deliberate-bug checks ("dates accept 30 February") reported **0 failing tests**. I first thought it was a test gap. | It was my mutation: `false && a || b || c` still runs `b` and `c`, so 30 February was still caught. I redid it properly (`if (false) {`) and 3 tests failed, as they should |

## Rules the brief left open (my decisions: change them if your class decides otherwise)

- **Sort by date:** compares the full start time. The criterion says "two events on the same day ... the earlier one comes first, and the two events on the same day stay in title order". Both can only be true if "earlier" means a different day or time and "stay in title order" means the **same moment**. If your class means "compare only the calendar day, then title", change the `date` comparator in `eventSearch.js` and one test.
- `sortEvents` needs an explicit option (`undefined` is `VALIDATION`); `searchEvents` defaults to `'date'`.
- `from` after `to` returns an empty list, not an error.
- Publishing a published event is harmless; `unpublishEvent` exists because the story title says "unpublish".
- `q` searches the title and venue only (not the city), as the prompt says.
- Booking a draft is `INVALID_STATE` (not `NOT_FOUND`).
- A new `PENDING` booking holds seats. Nothing confirms it yet: that is for the payment build.
- New error code `INVALID_STATE` (from the prompt). Summaries use the field names `minPriceCents` and `seatsLeft` (the prompt did not name them).

## What is NOT finished, and why

1. **S04's acceptance criteria are mine.** The brief says your class writes them in pairs. The three in `docs/user-stories.md` and `test/s04-publish.test.js` are a **proposed draft**. Replace them with your own and change the tests to match.
2. **S16's second half** (a GitHub workflow running `npm test` on every push) is Build 9. Only the `npm test` half is done.
3. **Started events stay on the public list.** Booking is refused once an event has started, but `listEventSummaries` still lists it with its seats. The brief does not say to hide them. Decide in your class.
4. **"Cheapest tier" includes sold-out tiers.** An event whose cheapest tier is sold out still shows that tier's price. The brief says "compares with the cheapest tier", so I did exactly that.
5. **Identity is still just a name** (from Build 1).

---
---

# Build 3: architecture, state machine, server skeleton

Same rule as before: read it, run it, try to break it. This time the first run of the new tests was **suspiciously clean**
(nearly everything passed straight away), so I did not trust it: I weakened the code on purpose, 22 different ways, to see whether the tests would notice. That is where the interesting findings came from.

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Every booking move | all 25 (from, to) pairs, one test each; the expected answers written a second time in a different shape | 5 allowed, 20 refused |
| The same moves on **real bookings** | the 20 illegal ones must be refused and leave the record, seats and history untouched; the 5 legal ones must work and give seats back when they should | Pass |
| Random walk | 4,000 random move attempts; after every one: seats match the bookings, every history is a legal path, a move succeeded only if `canTransition` said yes | Pass |
| The diagrams match the code | a test reads `docs/architecture.md` and compares the state diagram with `MOVES`; another reads every `import` and checks the layer rules | Pass |
| **Are the diagrams valid Mermaid?** | all three parsed with Mermaid's own parser, plus a deliberately broken diagram that must be rejected | 3 valid, the broken one rejected |
| `/health` over a real connection | `fetch` to a real server on a free port | `200 {"status":"ok"}` |
| The real program | a test starts `node src/server.js` as a separate process, calls `/health` and `/`, sends SIGTERM | Exit code 0 |
| Bad `PORT`, taken port | the same test style | Exit code 1, one clear line, no stack trace |
| Every error has one shape | 7 different errors checked together, and every error test checks the exact keys and a list of stack-trace fingerprints | Pass |
| A bug never leaks | a route that throws `database password is hunter2`: the client gets `Something went wrong`; the log gets the stack | Pass |
| 24 path-traversal disguises | raw paths (not tidied by a client library), with a **control experiment** proving the secret exists and normal files are served | Never 200, secret never leaked |
| Postman | **Newman** (Postman's command-line runner) ran `postman/event-ticketing.postman_collection.json` against the real server | 22 requests, 109 assertions, 0 failures. The server log showed the climbing paths arrived unchanged |
| The whole suite | `npm test` | **328 Node tests + 13 UI tests**, all pass |
| Look of the page and the Postman app | I cannot open a browser or the Postman app in my sandbox | **Not checked by eye.** Open http://localhost:3000, and run the collection in the real Postman app |

## What the mutation checks found (22 deliberate bugs)

| What I broke | Tests that failed | What it taught |
|--------------|:----------------:|----------------|
| Booking can leave `cancelled` for `paid` | 10 | The state machine tests really guard the table |
| `transitionBooking` skips the state machine | 24 | The lifecycle tests really use the real store |
| `transitionBooking` forgets to give seats back | 6 | Seats are checked, not just status |
| A stack trace put in the 500 response | 5 | The no-leak tests work |
| Bad JSON turned into a 500 / unknown `/api` falls to static / no body limit / bugs not logged | 3 / 1 / 1 / 2 | Each HTTP rule has a test that owns it |
| Missing HTTP status for `INVALID_TRANSITION` | 2 | The "every code has a status" table test works |
| Router: parameter beats fixed word | 1 | |
| `parseInt`-style PORT | 1 | |
| A route importing the data layer / a rule importing a service | 2 / 1 | The architecture test enforces the diagram |
| Dotfiles served / no decoding before the checks / symlink escape allowed | 5 / 1 / 2 | |
| **Remove just the `..` check, or just the "still inside" check** | **0** | **Not a gap: the layers cover for each other** (see below) |
| **Remove `..`, "still inside" AND the real-path check (every defence against climbing)** | **2** | The tests notice a real hole |
| **Allow backslashes** | **0, then 4** | **A real weakness in my tests: see F3** |

**Why "0 failures" is correct for the first two:** the static-file defence has four layers. Any single layer, or even two,
still stops every attack, so the outcome (a `400` or `404`) does not change. Only removing every defence against climbing lets the secret out.
That is exactly what defence in depth means, and it is why one test per layer would not have been enough: the tests prove the **outcome**.

## Problems found and fixed

| # | Where | What was wrong | How it was found | Fix |
|---|-------|----------------|------------------|-----|
| C1 | Build 2 vs the Build 3 brief | Bookings used `'PENDING'` and `'CANCELLED'` (upper-case). The brief's states are `pending`, `paid`, `cancelled`, `refunded`, `checked_in`. Two spellings of the same state would have been a bug waiting to happen. | Reading the brief against the code | The state machine is the single source of the words; bookings, tests and the UI use them. All earlier tests updated |
| C2 | `cancelBooking` | Two errors now overlapped: Build 1's `ALREADY_CANCELLED` and the new `INVALID_TRANSITION` (a cancelled booking "cannot become cancelled"). | Thinking through "cancel twice" with the new rules | Cancelling twice **keeps** the friendly `ALREADY_CANCELLED`; every other illegal cancel (refunded, checked in) is `INVALID_TRANSITION`. Both tested |
| C3 | Build 1/2 booking | There was no single place that changed a booking's status: `cancelBooking` changed it by hand. The next stories (pay, refund, check-in) would each have done the same, and one would have skipped the rule. | Designing for S07, S09, S10 | `transitionBooking`: the **one door**. Everything, including `cancelBooking`, goes through it |
| C4 | Booking records | A booking carried no record of what had happened to it. | Thinking about refunds and disputes | A frozen `history` of every status and when |
| C5 | `PORT` | `parseInt("3000abc")` is `3000`, so a typo would start the server on a port nobody asked for. | Knowing how `parseInt` behaves | PORT must be digits only, 0 to 65535, otherwise start-up stops with one clear line. 12 bad values tested |
| C6 | Node's own behaviour | For a request that is not even HTTP, Node answers with a **plain-text** `400`. That would break "every error has the same shape". | Knowing Node's default | A `clientError` handler answers in the standard JSON. Tested with a raw TCP socket |
| C7 | HTTP errors | Domain error messages and parser errors can quote user input; a `JSON.parse` message can quote part of the body. | Thinking about what reaches the client | Bad JSON gets a fixed sentence; the 404 message cuts a long path at 200 characters; a test checks the body is not echoed |
| C8 | Static files | A request path can hide `..` as `%2e%2e`, `..%2f`, a backslash, a null byte, double encoding, or a symlink inside `public/`. Checking the raw text would miss every disguise. | Threat-modelling the brief's "never allow a path to escape that folder" | Four layers: decode first then refuse; refuse dotfiles; check the joined path; check the **real** path after symlinks. 24 disguises tested, plus a control experiment |
| C9 | `server.close()` | Plain `close()` waits for every keep-alive connection, which can hang for a long time. | Knowing Node's behaviour | `close()` drops idle connections at once, gives busy ones a few seconds, then forces. Tested: the port is freed |
| C10 | Error table | The next time someone adds a domain error code, nothing would give it an HTTP status. | Thinking ahead | A test compares the status table with `ErrorCode`: adding a code without a status fails. (The same guard already caught my own new `INVALID_TRANSITION` in `error-codes.test.js`, which proved it works.) |

## Problems with my own tests, found by the mutation checks and corrected

| # | What | Fix |
|---|------|-----|
| F1 | My first traversal test accepted "400 **or** 404", so it could not tell whether the explicit refusal of backslashes was still there. Removing that check changed 400 to 404 and nothing failed. On Linux a backslash is just a letter in a file name, so the outcome looks harmless. | A separate group of tests demands a specific **400** for backslashes, null bytes, `..` and encoded slashes. The same mutation now fails 4 tests |
| F2 | While writing the dotfile test I left in a nonsense assertion (a regex that could never fail). | Deleted, replaced with a real check of the error code |
| F3 | The "port already in use" test started a second server it never used. | Simplified to one server and one clash |
| F4 | My first mutation of the path layers looked like a hole in the tests (0 failures). | It was not (see above). I checked by removing every climbing defence and the tests failed, so the tests were right and my expectation was wrong |

## Rules the brief left open (my decisions: change them if your class decides otherwise)

- **What "cancelled after paying" means.** The brief allows `paid → cancelled` *and* `paid → refunded`. I treated `cancelled` as "the booking is void" and `refunded` as "void, and the money went back". Both give the seats back. When money is really handled (S09, S10), you may want a rule such as "cancelling a paid booking must refund it".
- **`checked_in` keeps its seats** (the person is there). `cancelled` and `refunded` give them back.
- **An unknown state name** (`assertTransition('paid', 'teleported')`) throws `INVALID_TRANSITION`, not `VALIDATION`, so that `canTransition` is `false` exactly when `assertTransition` throws.
- **Bad JSON is a 400 even on a path with no route**, because the body is read before routing (as Express does). A valid body to an unknown `/api` path is a 404. Bodies that are not sent as JSON get **415** and oversize ones **413**: the brief does not name these.
- **Missing static files give the JSON 404** too (the brief says "every error has the same shape").
- **Suspicious paths** (`..`, backslash, null byte) are **400**; missing files, dotfiles and symlinks that lead out are **404**.
- **`PORT=0`** is accepted (any free port): the tests rely on it.
- **`HOST`** defaults to `127.0.0.1` (this computer only). It is not in the brief; use `HOST=0.0.0.0` in a container.
- **HEAD** is supported (it is GET without a body). Other methods on files are 405.
- **A Content-Security-Policy** is added to HTML pages (`default-src 'self'`). When the built React app is later served from `public/`, this is the first place to look if a font or script is blocked (the React page loads Google Fonts today).
- **Where the layers are today:** `inventory.js` is both the data and the rules that must change data atomically (never oversell, people waiting go first). It splits into repositories and services when a database arrives. The diagram says so.
- **`USER` is in the data model but not in the code.** It is marked *planned*.

## What is NOT finished, and why

1. **Nothing was looked at by eye:** not the landing page (`public/index.html`), not the Mermaid diagrams as pictures (they parse, but I have not seen them drawn), not the search screen, and not the Postman **app** (Newman ran the same collection). Open them.
2. **No routes for bookings yet.** `transitionBooking` exists and is tested, but no URL calls it. Payment, refund and check-in come with S07, S09 and S10.
3. **Rules about *when* a move is allowed** (for example no check-in before the event day) are not in the table, which only says which moves exist. They belong to those stories.
4. **The React screen still runs the domain inside the browser**; it does not call the server yet.
5. **Out of scope on purpose:** HTTPS, logins, rate limiting, CORS (Postman and same-origin pages do not need it). Each will need a decision later.
6. **Windows:** the symlink tests skip themselves where symlinks can't be created, and the backslash defence is only *observable* there. The explicit-400 tests cover it on every system.
7. **Carried over:** started events still appear on the public list; "cheapest tier" includes sold-out tiers; identity is still just a name.

---
---

# Build 3, part 2: the POST and GET API, and its Postman collection

Added after Build 3: real `POST` and `GET` requests for events, tiers, publishing, search and bookings, and a Postman collection that chains them.
Same rule: read it, run it, try to break it.

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Every endpoint, over real HTTP | `test/api-events.test.js` (40), `test/api-bookings.test.js` (26), `test/api-dev.test.js` (33), plus service tests | Pass |
| Look **behind** the API | after a request, the tests read the store directly: a rejected request must have saved nothing | Pass |
| **No overselling** | 20 parallel `POST /api/bookings` for 5 seats; then 8 parallel bookings of different sizes | Exactly 5 succeeded, 15 `SOLD_OUT`, 0 seats left, never more than the capacity |
| All 25 life-cycle moves **over HTTP** | the practice route, one test per (from, to) pair | 5 succeed, 20 give `409 INVALID_TRANSITION` and change nothing |
| Fields a client must not choose | `id`, `status`, `totalCents`, `reference`, `sold`, `tiers`... sent along with valid requests | All ignored |
| Deliberate bugs | 11 mutations of the routes, services and domain (201 to 200, no `Location`, practice route always on, unknown options accepted, cancel reveals the waitlist, sort ignored, drafts public, capacity check removed, `tierIds` leaked, blank ids, `null` crash) | Each made at least one test fail (see M1) |
| Postman collection | **Newman**, against the real server in demo mode, **four runs in a row** | 84 requests, 345 assertions, 0 failures, 0 server errors |
| Can the collection fail? | Newman against a **normal** server: folders 1 to 4 and 6 to 8 pass (297 assertions); folder 5 fails with 404 | Yes, as it should |
| The whole suite | `npm test` | **434 Node tests + 13 UI tests**, all pass |
| The Postman **app** and the React screen | I cannot open either in my sandbox | **Not checked by eye.** Newman ran the same scripts, but open the collection in Postman and click through it |

## Problems found and fixed

| # | Where | What was wrong | How it was found | Fix |
|---|-------|----------------|------------------|-----|
| A1 | `inventory.js` | **A request body of `null` crashed the server with a `TypeError` (a 500)** in seven functions (`createStore`, `addTier`, `bookTickets`, `joinWaitlist`, `leaveWaitlist`, `listEventSummaries`, `listBookings`). A default of `= {}` only covers `undefined`, and `null` is valid JSON. Build 1 and 2 tests never sent `null`, because their own code never does. | Probing every function with `null` before writing the routes | `asObject(input)`: anything that is not an object counts as "no fields". Tests for `null`, numbers, text, `true` and lists |
| A2 | `inventory.js` | A missing `tierId` or `eventId` answered `NOT_FOUND` (404, "Ticket tier not found"): the wrong thing is blamed. | The same probe: `bookTickets(null)` said `NOT_FOUND` | A missing or blank id is `VALIDATION` (400); only an id that is present but unknown is `NOT_FOUND` (404) |
| A3 | `leaveWaitlist` | My fix for A2 put the `entryId` check inside a callback that never runs on an **empty** line, so a missing `entryId` still said `NOT_FOUND`. | The new test for A2 failed | The check moved above the callback |
| A4 | `inventory.js` | A blank id (`"   "`) counted as "present", so it gave 404 instead of 400. | `test/api-bookings.test.js` failed | Blank counts as missing |
| A5 | Event status words | Events used `DRAFT` / `PUBLISHED` (capitals) while bookings use lower-case words, and my own ER diagram already said "draft or published". The API would have shown both spellings. | Writing the API responses | One constant, `EventStatus` (`'draft'`, `'published'`), used everywhere; earlier tests updated |
| A6 | Postman collection | **It passed on the first run and failed on every later run.** Request 3.5 searched for `jazz` in `postmanville` without this run's tag, so the second run also found the first run's event (the failing assertion said "expected a length of 1 but got 2"). | Running the collection a second time. The Node tests could not see it: each test starts with an empty server | Every search carries the run's tag; also 3.6. Then four runs in a row, all green |
| A7 | Postman collection | "3.4 also found in lower case" asserted something that did not test lower case at all: a hollow check that could never fail. | Reading my own assertion while checking the folder | 3.4 now really searches the tag in lower case (`runTagLower`) and checks both events are still found |
| A8 | Postman collection | The old request "valid JSON to an unknown API path" posted to `/api/events`, which is a **real route now**, so it would have answered 400, not 404. | Re-reading the Build 3 collection against the new routes | It uses `/api/unknown-thing` |

## Mutation checks on the API (M1)

Eleven deliberate bugs, each caught: *create answers 200 instead of 201* (2 tests fail), *no `Location` header on a booking* (2), *practice route always on* (2),
*unknown search options accepted* (3), *cancel reveals the next person in line* (2), *search ignores the sort* (3), *drafts shown on the public list* (14),
*capacity check removed* (4), *`tierIds` leaked in an event* (1), *blank ids count as present* (2), *`null` crashes `bookTickets` again* (2).
One line first printed "0 failing" for the blank-ids mutation: my edit pattern did not match the file, so nothing was changed; the corrected mutation failed 2 tests.

A second false alarm of the same kind: after the collection's second run failed, the server log looked like it had stopped after run 1. I checked for a crash (0 errors, no stack traces) and found the sandbox had removed my background server between commands, so run 2 was "connection refused", not a bug. I then ran the server and all runs in **one** command, which is how A6 was found.

## Decisions I made (change them if your class decides otherwise)

- **No logins yet, so anyone can create, publish, unpublish and cancel.** The API is for learning on your own computer (it listens on `127.0.0.1` by default). Real use needs users and permissions first.
- **A draft can be read by its id** (`GET /api/events/:id`). It is hidden from the **list**, not secret: an organizer needs to see it, and there are no users yet to decide who. The id is a long random value.
- **A booking reference is the only thing protecting a booking's details.** There is no rate limiting, so a determined guesser could try codes (the code has 40 bits, so a blind guess is very unlikely, but there is no lock-out). Rate limiting is a later decision.
- **Cancelling does not reveal the waitlist** (another customer's name is private), although the domain function knows it.
- **The practice route exists only in demo mode** (`npm run start:demo`). A public "mark as paid" route would let anyone pay nothing. The real S07, S09 and S10 will replace it.
- **Unknown search options are an error**, not ignored. A typo like `?citty=Lagos` would otherwise show everything.
- **No paging.** The whole list is returned.
- **`201 Created` + `Location`** for events and bookings; tiers get `201` without a `Location` (a tier has no URL of its own yet).
- **Bad JSON is still a 400 even for a URL with no route**, as in Build 3.
- **The data is in memory:** lost when the server stops, so Postman variables (`eventId`...) from before a restart no longer point at anything. Run the collection again from the top.

## What is NOT finished

1. **Not looked at by eye:** the Postman app itself (Newman ran the identical collection), the landing page, and the React screen.
2. **The React screen still runs the domain inside the browser**; it does not call these routes yet.
3. **No waitlist routes**, so `WAITLIST_FIRST`, `ALREADY_WAITING` and `SEATS_AVAILABLE` can't happen over HTTP yet (they are tested in the domain).
4. **No paging, no logins, no rate limiting, no CORS, no database.**
5. **Carried over:** started events still appear on the public list; "cheapest tier" includes sold-out tiers; identity is a name.

---
---

# Build 4: working REST API

I read the Build 3 service, route and test code before changing it. The API had synchronous services tied to the browser
inventory store, no injected repository or payment gateway, and no payment route. Build 4 now uses an async in-memory
repository and injected mock gateway; the UI's existing inventory behavior remains separate.

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Node tests, including real-server API tests | `npm run test:node` | 443 pass, 0 fail |
| Full Node and UI suite | `npm test` | Pass; 13 UI tests also pass |
| Production UI | `npm run build` | Pass |
| Documented API workflow | Ran each curl example against `npm start` on port 3000 | Create, tier, publish, search, read, book, read, pay, cancel pending booking, unpublish and health all passed |
| Postman file | Parse the updated collection as JSON | Valid |
| Syntax | `node --check` on the server and changed service modules | Pass |

## Problems found and fixed

| Where | What was wrong | How it was found | Fix |
|-------|----------------|-----------------|-----|
| Existing services and API tests | Services were synchronous and exposed the browser store, so they could not exercise the requested async repository boundary. | Read the Build 4 architecture requirements and ran the targeted tests after refactoring | Services now receive repository and gateway dependencies; routes await service calls, and tests inspect the repository through its async API |
| Existing cancellation endpoint test | It expected a paid booking to be cancelled by the user-facing endpoint, conflicting with Build 4's unpaid-only cancellation rule. | The API test returned `409` where the older test expected `200` | The endpoint now allows only pending bookings; the separate state-machine practice route still tests the valid `paid → cancelled` move |
| Error mapping | `PAYMENT_DECLINED` was not in the domain error codes or HTTP status table. | The HTTP test requires every domain code to have a status | Added `PAYMENT_DECLINED` with HTTP `402`, plus a service test proving a decline leaves the booking pending |
| Mock payment validation | An explicit `mockResult: null` would have been treated like an omitted value and succeeded. | Reviewed request edge cases after the first implementation | Only an absent `mockResult` defaults to success; explicit `null` is rejected |
| Postman collection | Booking and cancellation requests did not send the newly required caller identity. | Searched every request in the collection for booking paths | Added a consistent `x-user-id` header to all 15 affected requests |

## Decisions the brief left open

- **Mock result:** `mockResult` may be `success` or `declined`; omission means success. Unknown fields, including card details, are rejected.
- **Declined status:** `PAYMENT_DECLINED` uses HTTP `402`; the booking remains pending and can be retried.
- **Owner mismatch:** pay and cancel return `404 NOT_FOUND` to avoid revealing another caller's booking.
- **Cancellation:** only an owner may cancel a pending booking in Build 4. The state machine still permits `paid → cancelled` for the practice/later-build life cycle, but the public cancel endpoint does not.
- **Identity:** `x-user-id` is caller-supplied and is not authentication. Real authentication and users are later work.
- **Concurrent seats:** the memory repository checks capacity and reserves seats in one synchronous in-memory operation, so parallel async requests cannot oversell. This is not a lock or a database transaction.

## Not built yet

Refund and check-in endpoints, authentication, persistence, waitlist routes and UI-to-API wiring remain later work.

---
---

# Build 5: SQLite and the overselling fix

## Checks I ran

| Check | How | Result |
|-------|-----|--------|
| Full Node and React test suite | `npm test` | 448 Node tests and 13 UI tests pass |
| React production build | `npm run build` | Pass |
| Last-ticket reproduction and fix | `npm run oversell` | Before: 50 bookings, 50/1 sold. After: 1 booking, 49 `SOLD_OUT`, 1/1 sold |
| Regression-test strength | Temporarily replaced the atomic capacity predicate with a permissive condition, ran `node --test test/oversell.test.js`, then restored it | Test failed as required; after restoration, the targeted regression test passes |
| SQLite data and constraints | `test/sqlite.test.js` | Pass: required tables, foreign key, primary key, capacity check, unique reference and rollback after a duplicate booking |
| Seed idempotence | `test/sqlite.test.js` runs `scripts/seed.js` twice on a temporary database | First run seeds 5 events; second run leaves existing data unchanged |
| Server restart persistence | `test/server-process.test.js` starts and stops the real server twice on one database file | Pass: data remains available after restart |

## Problems found and fixed

| Where | What was wrong or incomplete | How it was found | Fix |
|-------|------------------------------|------------------|-----|
| SQLite repository verification | The initial API and concurrency checks did not directly prove the schema's foreign-key, uniqueness and capacity constraints, seed idempotence, or rollback if the booking insert fails. | Reviewed the Build 5 definition of done against the current tests | Added focused SQLite schema and seed tests; a duplicate booking test verifies that the attempted extra seat reservation rolls back |
| Build 4 documentation | Several pages still said API data was in memory and would be lost on restart after the repository switched to SQLite. | Searched the docs for stale persistence descriptions | Updated the README, API, API examples, Postman troubleshooting and architecture docs |
| Oversell reproduction vs schema constraint | The production schema must reject `sold > capacity`, which would prevent an intentionally vulnerable example from storing an oversold count. | Compared Prompt 1's required `CHECK` with Prompt 2's before/after demonstration | Kept the production constraint and reproduced the old race in isolated demonstration tables without that upper-bound check; the production repository uses the atomic conditional update |

## Decisions the brief left open

- **Database path:** the default is `data/event-ticketing.sqlite`; `DATABASE_PATH` can select another path. The default database and its SQLite WAL/SHM files are ignored by Git.
- **Seed behavior:** `npm run seed` and demo mode seed only if the database has no events; they do not overwrite or append to an existing dataset.
- **User rows:** because bookings now have a foreign key to `users`, the repository creates a minimal user row (id and creation timestamp) when a booking is stored. This does not authenticate `x-user-id` or add profiles.
- **Race demonstration:** the pre-fix race uses temporary demonstration tables, keeping the production table's required capacity check intact.
- **React scope:** the existing React UI continues to use its local domain store. Build 5 changes the REST API persistence and intentionally does not rewire the UI to the API.
- **Runtime verification:** validation ran with Node 24.22.0, which provides `node:sqlite`; Node 22.13 compatibility was not separately exercised in this environment.

## Not built at the end of Build 5 (superseded by Builds 6–7)

At the end of Build 5, the UI was not wired to the persistent API and authentication remained later work. Builds 6–7
below address the UI and authentication. Paging, rate limiting, CORS, refunds and check-in endpoints remain later work.

## Builds 6–7: connected React UI and authentication

### Problems found and fixed

| Area | What was incomplete or unsafe | Fix |
|------|-------------------------------|-----|
| React API client | The screen used a local/demo identity rather than a verified user identity. | The API client now attaches the session's bearer token; the server authenticates every protected request. |
| Passwords and tokens | Signup, login and token verification were missing. | Added salted scrypt hashes and expiring HS256 tokens; passwords and hashes are excluded from API responses. |
| Ownership and roles | Booking and event ownership were not enforced by the server. | Added role and ownership guards for bookings, organizer events, waitlists and staff-only demo transitions. |
| Existing database files | Older SQLite files lacked account, organizer and hold-expiry columns. | The database initializer adds the required columns and indexes when opening an existing database. |
| Build 6 brief | Its original prompt requested a second vanilla-JavaScript mock-data client. | Kept the agreed React + REST architecture and built the checkout, countdown and retry behavior on the real API instead. |

### Decisions and verification

- Public signup creates attendees and organizers. Staff accounts require trusted CLI provisioning; public clients cannot
  assign themselves the staff role.
- A pending booking is held for 24 hours. Expiration is processed on booking-related requests; there is no background
  timer or scheduler.
- A second attendee reading another attendee's booking receives `403 FORBIDDEN`; server guards enforce this even when
  requests bypass the React UI.
- `AUTH_TOKEN_SECRET` must be at least 32 bytes and remain stable across restarts. The browser stores only the signed
  session in local storage and sends it as a bearer token.
- Full verification: `npm test` passed 466 Node tests and 17 UI tests; `npm run build` passed.
