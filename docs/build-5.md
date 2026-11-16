# Build 5: SQLite and the overselling fix

**Week 8.** Starts from the finished state of [Build 4](build-4.md). The React screen remains part of the project; this
build makes the REST API's repository persistent without changing the UI's existing local-data behavior.

## Deliver

- A SQLite schema for users, events, ticket tiers and bookings, with primary keys, foreign keys, unique references and
  checks such as `CHECK (sold >= 0 AND sold <= capacity)`.
- A SQLite repository with the same asynchronous methods as the in-memory repository, so the services remain unchanged.
- Parameterized SQL statements and `DATABASE_PATH` configuration. The default database is
  `data/event-ticketing.sqlite`; it is ignored by Git and survives server restarts.
- `npm run seed` to add demo events only when the configured database is empty.
- A reproducible 50-request last-ticket demo and regression test. The fixed repository reserves seats with a conditional
  atomic update; a failed reservation becomes `SOLD_OUT`.

## Practise

SQL, constraints, parameterized queries, atomic operations, transactions and concurrency.

## S08: As an attendee, I want to be certain the last ticket is sold to only one person

- **Given** exactly one seat remains
  **When** 50 attendees try to book it at the same moment
  **Then** exactly one booking succeeds, 49 receive `SOLD_OUT`, and seats sold never exceed capacity.
- **Given** the atomic database reservation is removed
  **When** `test/oversell.test.js` runs
  **Then** the regression test fails.

## Done when

- Run `npm run oversell`: the intentionally vulnerable check-then-write demonstration oversells, while the SQLite API
  succeeds once, returns 49 `SOLD_OUT` results, and leaves one seat sold.
- `npm test` includes the real-server overselling test and verifies SQLite constraints.
- Restart the server with the same `DATABASE_PATH`; previously stored data remains available.
- The React UI still builds and its tests pass.

## Implementation notes

The vulnerable half of `scripts/oversell-demo.js` uses separate temporary demonstration tables without the production
capacity constraint. That makes the race observable while the actual `ticket_tiers` table continues to enforce
`sold <= capacity`. Both the demo and the API regression test synchronize all 50 requests after their initial tier
read, then let the database decide who can reserve the seat.

A JavaScript lock only coordinates callers that share the same process and can be bypassed by another server process.
Checking capacity and writing `sold` as separate operations is a race because concurrent requests can both read the same
stale seat count before either writes.

The reservation and booking insert run in one SQLite transaction, so a failed insert cannot leave a seat reserved. The
seat-capacity predicate itself is still in the single `UPDATE`; the transaction makes the multi-statement booking
operation consistent.

## AI prompt: move to SQLite, then fix overselling

Read `README.md`, `docs/user-stories.md`, this file and everything in `src/` before making changes. Follow the layer
rules in [architecture.md](architecture.md), keep the services repository-agnostic, and use Node's built-in `node:sqlite`.

First, add a constrained SQLite schema, a repository compatible with `memory.js`, an idempotent seed script, and an
overselling demo that reproduces check-then-write. Then fix it in the database with a conditional atomic reservation,
add a 50-simultaneous-booking test that fails if the fix is removed, and show the before/after counts. Keep all SQL
parameterized, do not add a lock variable or check capacity twice, and record verification and any prompt decisions in
[ai-log.md](ai-log.md).
