# REST API examples

Start the server in one terminal:

```sh
npm start
```

In another terminal, run the following Bash commands in order. The server stores data in SQLite and keeps it after a
restart. Each run creates a new event. These examples use Node (already required by the project) only to read generated IDs from JSON responses.

```sh
BASE=http://localhost:3000
USER_ID=attendee-1
STARTS_AT=$(node -p 'new Date(Date.now() + 30 * 86400000).toISOString()')
```

## 1. Create an event

```sh
EVENT_JSON=$(curl -sS -X POST "$BASE/api/events" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Lagos Tech Meetup\",\"city\":\"Lagos\",\"venue\":\"Landmark Centre\",\"startsAt\":\"$STARTS_AT\"}")
printf '%s\n' "$EVENT_JSON"
EVENT_ID=$(printf '%s' "$EVENT_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).event.id')
```

## 2. Add a ticket tier

```sh
TIER_JSON=$(curl -sS -X POST "$BASE/api/events/$EVENT_ID/tiers" \
  -H 'Content-Type: application/json' \
  -d '{"name":"General","priceCents":500000,"capacity":5}')
printf '%s\n' "$TIER_JSON"
TIER_ID=$(printf '%s' "$TIER_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).tier.id')
```

## 3. Publish the event

```sh
curl -sS -X POST "$BASE/api/events/$EVENT_ID/publish"
```

## 4. Read, join, and book the waitlist

The queue is initially empty:

```sh
curl -sS "$BASE/api/events/$EVENT_ID/waitlists" -H "x-user-id: $USER_ID"
```

Fill the 5-seat tier, then queue one attendee:

```sh
FULL_BOOKING_JSON=$(curl -sS -X POST "$BASE/api/bookings" \
  -H 'Content-Type: application/json' \
  -H "x-user-id: $USER_ID" \
  -d "{\"eventId\":\"$EVENT_ID\",\"tierId\":\"$TIER_ID\",\"quantity\":5,\"customer\":\"Ada Obi\"}")
FULL_REFERENCE=$(printf '%s' "$FULL_BOOKING_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).booking.reference')
WAITLIST_JSON=$(curl -sS -X POST "$BASE/api/events/$EVENT_ID/tiers/$TIER_ID/waitlist" \
  -H 'Content-Type: application/json' \
  -H "x-user-id: $USER_ID" \
  -d '{"customer":"Chidi Obi","quantity":1}')
printf '%s\n' "$WAITLIST_JSON"
WAITLIST_ENTRY_ID=$(printf '%s' "$WAITLIST_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).entry.id')
```

Cancel the temporary booking to free a seat, then let the queue owner book the head:

```sh
curl -sS -X POST "$BASE/api/bookings/$FULL_REFERENCE/cancel" \
  -H "x-user-id: $USER_ID"
curl -sS -X POST "$BASE/api/events/$EVENT_ID/tiers/$TIER_ID/waitlist/next/book" \
  -H "x-user-id: $USER_ID"
```

If the attendee wants to leave rather than be promoted, use this request instead of the cancellation and promotion above:

```sh
curl -sS -X DELETE "$BASE/api/events/$EVENT_ID/tiers/$TIER_ID/waitlist/$WAITLIST_ENTRY_ID" \
  -H "x-user-id: $USER_ID"
```

## 5. Search published events

```sh
curl -sS "$BASE/api/events?q=Tech&city=Lagos&sort=date"
```

## 6. Read the event and its ticket tiers

```sh
curl -sS "$BASE/api/events/$EVENT_ID"
```

## 7. Book tickets

```sh
BOOKING_JSON=$(curl -sS -X POST "$BASE/api/bookings" \
  -H 'Content-Type: application/json' \
  -H "x-user-id: $USER_ID" \
  -d "{\"eventId\":\"$EVENT_ID\",\"tierId\":\"$TIER_ID\",\"quantity\":2,\"customer\":\"Ada Obi\"}")
printf '%s\n' "$BOOKING_JSON"
REFERENCE=$(printf '%s' "$BOOKING_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).booking.reference')
```

## 8. Read the booking

```sh
curl -sS "$BASE/api/bookings/$REFERENCE"
```

## 9. Pay with the mock gateway

No card number is sent to the mock gateway.

```sh
curl -sS -X POST "$BASE/api/bookings/$REFERENCE/pay" \
  -H 'Content-Type: application/json' \
  -H "x-user-id: $USER_ID" \
  -d '{"mockResult":"success"}'
```

To try a decline and then retry, create another booking and first send:
`-d '{"mockResult":"declined"}'`. The API returns `PAYMENT_DECLINED`; that booking remains pending.

## 10. Book and cancel an unpaid booking

This second booking is deliberately left pending; paid bookings cannot be cancelled in Build 4.

```sh
CANCEL_BOOKING_JSON=$(curl -sS -X POST "$BASE/api/bookings" \
  -H 'Content-Type: application/json' \
  -H "x-user-id: $USER_ID" \
  -d "{\"eventId\":\"$EVENT_ID\",\"tierId\":\"$TIER_ID\",\"quantity\":1,\"customer\":\"Ada Obi\"}")
CANCEL_REFERENCE=$(printf '%s' "$CANCEL_BOOKING_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).booking.reference')
curl -sS -X POST "$BASE/api/bookings/$CANCEL_REFERENCE/cancel" \
  -H "x-user-id: $USER_ID"
```

## 11. Unpublish the event

```sh
curl -sS -X POST "$BASE/api/events/$EVENT_ID/unpublish"
```

## Health check

```sh
curl -sS "$BASE/health"
```
