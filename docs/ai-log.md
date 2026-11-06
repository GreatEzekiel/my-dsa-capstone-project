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
