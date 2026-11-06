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
