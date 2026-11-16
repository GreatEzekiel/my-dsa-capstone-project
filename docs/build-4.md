# Build 4: Working REST API (in memory)

**Week 7.** Starts from the finished state of Build 3.

## Deliver

- An asynchronous in-memory repository for events, ticket tiers and bookings.
- Event and booking services that receive the repository as a dependency and keep business rules out of routes.
- A mock payment gateway that never receives card details.
- REST endpoints to create events and tiers, publish/unpublish, search, book, pay, read and cancel bookings.
- `x-user-id` ownership checks for booking payment and cancellation.
- API examples in [api-examples.md](api-examples.md) and real-server API tests.

## Practise

REST design, status codes, validation, `async`/`await`, and separating routes from rules.

## Done when

- Every request in [api-examples.md](api-examples.md) works against the real server.
- Errors use `{ "error": { "code": "...", "message": "..." } }`; stack traces never reach clients.
- `npm test` includes API-level tests that start the real server on a free port.
- S02–S06 pass through the API, and S07 payment criteria pass.
- Money remains whole cents; declines leave bookings pending; a booking can only be paid by its owner.
- Cancellation is limited to unpaid bookings in this build.

## Stories

S02–S06 carry forward from [Build 2](build-2.md) and must pass through the API. S07 is added to the backlog in
[user-stories.md](user-stories.md). No refund or check-in endpoints are added in this build.

## API design decisions

- A payment request accepts `{ "mockResult": "success" }` or `{ "mockResult": "declined" }`. Omitting the field means
  success. It does not accept a card number.
- A declined mock charge returns `402 PAYMENT_DECLINED` and does not change the booking; the attendee may retry.
- The mock gateway is idempotent by booking ID. Paying an already-paid booking is rejected before another charge.
- `x-user-id` is a temporary caller identity, not authentication. A mismatched booking owner receives `404 NOT_FOUND`
  so the API does not reveal whether the reference exists.
- Cancellation is pending-only and owner-only for Build 4, even though the state machine includes `paid → cancelled`
  for later builds.
- Events and bookings exist only in process memory and disappear when the server stops.

## AI prompt

Read `README.md`, `docs/user-stories.md`, this file, `docs/architecture.md` and everything in `src/` before making
changes. Follow the layer rules in the architecture document. Keep data in memory, use dependency injection for the
repository and payment gateway, and use only Node built-ins at runtime. Add tests for payment success, decline/retry,
ownership and invalid state changes. When finished, list changed files and decisions that the brief left open.
