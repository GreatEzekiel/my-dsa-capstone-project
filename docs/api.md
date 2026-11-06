# The API: every POST and GET request

All bodies and answers are JSON. Money is **whole kobo** (`500000` = ₦5,000.00). Dates are ISO strings
(`2026-12-05T18:00:00+01:00`; a time with no zone means Lagos time). Test everything with Postman: see [postman.md](postman.md).

Start the server with `npm start` (empty) or `npm run start:demo` (4 sample events + 1 draft + the practice route in the last section).
**The data lives in memory:** it starts empty and is lost when the server stops.

## The requests at a glance

| Method | Path | What it does | Success |
|--------|------|--------------|---------|
| `GET` | `/health` | Is the server alive? | `200` |
| `POST` | `/api/events` | Create an event (a private **draft**) | `201` + `Location` |
| `GET` | `/api/events` | Search the **published** events | `200` |
| `GET` | `/api/events/:id` | One event with its tiers | `200` |
| `POST` | `/api/events/:id/tiers` | Add a ticket tier | `201` |
| `POST` | `/api/events/:id/publish` | Make the event public | `200` |
| `POST` | `/api/events/:id/unpublish` | Take it off the public list | `200` |
| `POST` | `/api/bookings` | Book tickets | `201` + `Location` |
| `GET` | `/api/bookings/:reference` | Find a booking by its code | `200` |
| `POST` | `/api/bookings/:reference/cancel` | Cancel it, give the seats back | `200` |
| `POST` | `/api/dev/bookings/:reference/transition` | **Practice only (demo mode)**: move a booking along its life cycle | `200` |

**Errors always look like this**, with a status that matches the code:

```json
{ "error": { "code": "SOLD_OUT", "message": "Only 1 left in General, you asked for 2" } }
```

| Status | Codes | Meaning |
|:------:|-------|---------|
| `400` | `VALIDATION`, `BAD_JSON`, `BAD_REQUEST` | Your request is wrong: fix it and send it again |
| `404` | `NOT_FOUND` | No such event, booking, route or file |
| `405` | `METHOD_NOT_ALLOWED` | The path exists, but not with this method (see the `Allow` header) |
| `409` | `SOLD_OUT`, `ALREADY_CANCELLED`, `INVALID_STATE`, `INVALID_TRANSITION`, `EVENT_STARTED`, `SEATS_AVAILABLE`, `WAITLIST_FIRST`, `ALREADY_WAITING` | Your request is fine, but it clashes with the **current state** of things |
| `413` / `415` | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Body too big / not sent as JSON (`Content-Type: application/json`) |
| `500` | `INTERNAL` | A bug on the server. The details are in the server log, never in the answer |

---

## Events

### `POST /api/events`: create an event (S02)

```json
{ "title": "Lagos Tech Meetup", "city": "Lagos", "venue": "Landmark Centre", "startsAt": "2026-12-05T18:00:00+01:00" }
```
`201 Created`, header `Location: /api/events/<id>`:
```json
{ "event": { "id": "3f0c…", "title": "Lagos Tech Meetup", "city": "Lagos", "venue": "Landmark Centre",
             "startsAt": "2026-12-05T18:00:00+01:00", "status": "draft", "started": false, "tiers": [] } }
```
- The event is a **draft**: saved, but **not** on the public list.
- A missing title, city, venue, or a date that is not real (`2026-02-30`) is `400 VALIDATION`, and nothing is saved.
- Fields you may not choose (`id`, `status`, `tiers`...) are **ignored**, not obeyed.

### `GET /api/events/:id`
`200 { "event": { …as above, with "tiers": [ … ] } }`, or `404 NOT_FOUND`. A draft can be read by its id: drafts are hidden from the **list**, they are not secret.

### `POST /api/events/:id/tiers`: add a ticket tier (S03)
```json
{ "name": "General", "priceCents": 500000, "capacity": 100 }
```
`201 Created`:
```json
{ "tier": { "id": "9a1b…", "eventId": "3f0c…", "name": "General", "priceCents": 500000, "capacity": 100, "sold": 0, "seatsLeft": 100 } }
```
A price that is not a whole number, or a capacity below 1, is `400 VALIDATION`; an unknown event is `404`.

### `POST /api/events/:id/publish` and `/unpublish` (S04)
No body. `200 { "event": { …, "status": "published" } }` (or `"draft"`).
Publishing an event with **no tiers** is `409 INVALID_STATE`. Unpublishing keeps the bookings that already exist; it only stops **new** ones.

### `GET /api/events`: search, filter and sort the public list (S05)

| Option | Example | Meaning |
|--------|---------|---------|
| `q` | `?q=jazz` | text in the **title or venue**, capitals ignored |
| `city` | `?city=lagos` | the **whole** city name, capitals ignored |
| `from`, `to` | `?from=2026-12-01&to=2026-12-31` | inclusive dates. A date-only `to` includes that **whole day** |
| `maxPriceCents` | `?maxPriceCents=500000` | the event's **cheapest tier** must be within it |
| `onlyAvailable` | `?onlyAvailable=true` | hide sold-out events |
| `sort` | `?sort=price` | `date` (default, soonest first), `price` (cheapest first), `availability` (most seats first) |

Options combine (an event must pass all of them). An **empty** value (`?city=`) means "not given".
```json
{ "count": 1, "events": [ { "id": "3f0c…", "title": "Abuja Jazz Night", "city": "Abuja", "venue": "Jabi Lake Park",
    "startsAt": "2026-12-05T18:00:00+01:00", "status": "published", "tierCount": 2, "minPriceCents": 800000, "seatsLeft": 44 } ] }
```
- A bad date, a price that is not a whole number (`9.99`, `abc`), a wrong yes/no or an unknown `sort` is `400 VALIDATION`.
- **An option that does not exist is refused** (`?citty=Lagos` is `400`, naming `citty`), so a typo can't silently show everything.
- Nothing found is `200` with `{ "count": 0, "events": [] }`. There is **no paging** yet: the whole list comes back.

---

## Bookings

### `POST /api/bookings`: book tickets (S06)
```json
{ "eventId": "3f0c…", "tierId": "9a1b…", "quantity": 2, "customer": "Ada Obi" }
```
`201 Created`, header `Location: /api/bookings/7K2M-9Q4X`:
```json
{ "booking": { "id": "c5d2…", "reference": "7K2M-9Q4X", "eventId": "3f0c…", "tierId": "9a1b…", "quantity": 2,
               "customer": "Ada Obi", "totalCents": 1000000, "status": "pending", "createdAt": "…",
               "history": [ { "status": "pending", "at": "…" } ] } }
```
| Situation | Answer |
|-----------|--------|
| not enough seats | `409 SOLD_OUT`, and **nothing changes** |
| quantity 0, negative, `1.5`, over 10, or text (`"2"`) | `400 VALIDATION` |
| missing or blank `customer`, `eventId`, `tierId` | `400 VALIDATION` |
| unknown event or tier (or a tier of another event) | `404 NOT_FOUND` |
| the event is a **draft** | `409 INVALID_STATE` |
| the event has **started** | `409 EVENT_STARTED` |

The booking starts as `pending` and the seats are held. `status`, `totalCents`, `reference` and `id` are chosen **by the server**: if you send them, they are ignored.
**Many requests at once can't oversell:** 20 people booking the last 5 seats at the same moment get exactly 5 bookings and 15 `SOLD_OUT` (tested).

### `GET /api/bookings/:reference`
`200 { "booking": { … } }` or `404`. Capitals, spaces and the hyphen don't matter (`7k2m9q4x` works), and `O`/`I`/`L` are read as `0`/`1`.
**Treat the reference like a password:** it is the only thing protecting a booking's details.

### `POST /api/bookings/:reference/cancel`
No body. `200`:
```json
{ "booking": { …, "status": "cancelled", "history": [ { "status": "pending" }, { "status": "cancelled" } ] }, "seatsLeft": 3 }
```
Cancelling twice is `409 ALREADY_CANCELLED` (the seats are not given back twice). A booking that is `refunded` or `checked_in` can't be cancelled: `409 INVALID_TRANSITION`.
The answer deliberately does **not** say who is next on the waitlist: that is another customer's name.

---

## Practice only: `POST /api/dev/bookings/:reference/transition`

Only in **demo mode** (`npm run start:demo`). In a normal start this URL is an unknown path (`404`).
```json
{ "to": "paid" }
```
It moves a booking along the life cycle (`pending`, `paid`, `cancelled`, `refunded`, `checked_in`), and the state machine refuses illegal moves:

| Request | Answer |
|---------|--------|
| `pending → paid`, `paid → checked_in`, `paid → refunded`, `paid → cancelled`, `pending → cancelled` | `200` |
| **`cancelled → paid`** (paying a cancelled booking) | `409 INVALID_TRANSITION`: *"A cancelled booking cannot become paid: cancelled is final, nothing can leave it"* |
| any other of the 25 moves | `409 INVALID_TRANSITION`, and nothing changes |
| `to` missing or not text | `400 VALIDATION` |

**Why only in demo mode?** Left open, anyone could mark a booking as paid for free. The real payment, refund and check-in stories (S07, S09, S10) will replace this with proper requests that check who is asking and whether money really moved.

---

## Not built yet (on purpose)

No logins (anyone can create, publish and cancel), no paging, no rate limiting, no waitlist routes, no CORS, and no database (data is lost when the server stops). `docs/ai-log.md` lists each decision.
