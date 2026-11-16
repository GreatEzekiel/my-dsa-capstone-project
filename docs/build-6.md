# Build 6: React checkout on the REST API

Starts from the finished state of [Build 5](build-5.md). This project keeps its existing React frontend and REST API
instead of introducing a second vanilla-JavaScript frontend or mock-data API.

## Deliver

- Browse, search, filter and sort published events using live REST responses.
- View ticket tiers, choose a quantity that does not exceed 10 or the currently available seats, and book or join the
  waitlist.
- See a countdown for the pending booking's 24-hour checkout hold.
- Pay with the mock gateway. The browser sends only a mock outcome, never a card number; a declined attempt leaves the
  booking pending and can be retried.
- Mark sold-out tiers and do not offer direct booking for them.

## Practise

React forms and state, accessible controls, REST requests, loading/error states, and keeping API access in one module.

## Done when

- `npm test` passes the browse, filtering, booking, checkout timer and declined-payment retry tests.
- `npm run build` succeeds.
- The UI works with the SQLite-backed API started by `npm start`.

The hold duration is one day (24 hours). The backend stores `expiresAt`; expired pending bookings are cancelled and
their seats released when a booking operation next reaches the service.

See [api-examples.md](api-examples.md) for REST requests and [architecture.md](architecture.md) for the UI/API boundary.
