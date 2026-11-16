# Build 7: Login, roles and a connected app

Starts from the finished state of [Build 6](build-6.md). The React client continues to use the REST API; authentication
and authorization are enforced by the server, not by hidden UI controls.

## Deliver

- Sign up and log in with salted scrypt password hashes; passwords are never stored or returned in plaintext.
- Signed, expiring HS256 bearer tokens. `AUTH_TOKEN_SECRET` is required at server startup and must be at least 32 bytes.
- Three roles: `attendee`, `organizer` and `staff`. Public signup can create attendees or organizers. Staff accounts
  are provisioned through `npm run create:staff` with `STAFF_EMAIL` and `STAFF_PASSWORD` supplied by a trusted operator.
- Attendees can list, read, pay and cancel only their own bookings. A different authenticated attendee receives
  `403 FORBIDDEN`.
- Organizers can create and publish events, but cannot change another organizer's event.
- React sign-in/sign-up, attendee tickets, mock checkout/payment retry, and organizer dashboard screens.

## Start locally

Copy `.env.example` to `.env`, set `AUTH_TOKEN_SECRET` to a random secret of at least 32 bytes, then run:

```sh
npm start
npm run dev
```

Keep the same secret across server restarts so existing tokens remain verifiable until they expire. Never commit `.env`.
The token lifetime is one hour. Public event browsing and `/health` remain available without a token.

## Done when

- `npm test` passes authentication, token, role, ownership, booking privacy, checkout, and UI tests.
- An attendee cannot read another attendee's booking.
- An organizer cannot modify another organizer's event.
- An attendee cannot create events; the server rejects the request even if it is sent outside the React UI.

See [api.md](api.md) and [api-examples.md](api-examples.md) for the protected REST routes and bearer-token examples.
