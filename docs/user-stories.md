# User stories: the backlog

Stories are written as **As a ... I want ... so that ...**. Each has **acceptance criteria** in the form
**Given** (the starting situation) **When** (what happens) **Then** (what must be true afterwards).
A story is only "done" when every criterion has a passing automated test.

**Where to find each test:** `test/s02-create-event.test.js`, `s03-add-tier.test.js`, `s04-publish.test.js`,
`s05-search.test.js`, `s06-book.test.js`. Test names start with the story number, for example `S05: ...`.

## Definition of done (applies to every story)

- [ ] Every acceptance criterion has an automated test, and `npm test` passes
- [ ] Money is whole cents; dates are ISO strings; errors are `DomainError` with a code
- [ ] A rejected request changes nothing (validate first, change state last)
- [ ] Inputs are never changed (no mutation)
- [ ] The code is read by a second person (pull request) and the AI's mistakes are written in `docs/ai-log.md`

---

## Build 2 stories

| ID | Story | Status |
|----|-------|--------|
| S02 | Organizer creates an event | Done in Build 2 |
| S03 | Organizer adds ticket tiers | Done in Build 2 |
| S04 | Organizer publishes and unpublishes an event | Done in Build 2: **criteria are a draft for your class to replace** |
| S05 | Attendee searches, filters and sorts events | Done in Build 2 |
| S06 | Attendee books tickets from a tier | Done in Build 2 (the rules were built in Build 1) |
| S16 | Automated tests run on every push | Build 2: `npm test`. Build 9: GitHub workflow |

### S02: As an organizer, I want to create an event with title, city, venue and date, so that people can find it

- **Given** an organizer
  **When** they create an event with a title, city, venue and a valid date
  **Then** the event is saved as a draft with a new id, and it is not on the public list.
- **Given** a missing title or city, or a date that is not a real date
  **When** the organizer creates the event
  **Then** the request is rejected with `VALIDATION` and nothing is saved.

### S03: As an organizer, I want to add ticket tiers with a price and capacity, so that I can sell different kinds of ticket

- **Given** a draft event
  **When** the organizer adds a tier "General" at 500000 kobo with capacity 100
  **Then** the tier is saved with 0 sold and 100 seats left.
- **Given** any event
  **When** the price is not a whole number, or the capacity is less than 1
  **Then** the request is rejected with `VALIDATION`.
- **Given** an event id that does not exist
  **When** the organizer adds a tier
  **Then** the request is rejected with `NOT_FOUND`.

### S04: As an organizer, I want to publish and unpublish an event, so that I control when it goes public

> **YOUR CLASS WRITES THESE.** Build 2 says the S04 criteria are written by you, in pairs, in class. The three
> below are a **proposed draft** built from the rules in the Build 2 prompt, so the tests have something to
> check. Replace them with the ones your pair wrote, then update `test/s04-publish.test.js` to match.

- **Given** a draft event that has at least one ticket tier
  **When** the organizer publishes it
  **Then** its status is `published` and it appears on the public list.
- **Given** a draft event with no ticket tiers
  **When** the organizer publishes it
  **Then** the request is rejected with `INVALID_STATE` and the event stays a draft.
- **Given** a published event that already has a booking
  **When** the organizer unpublishes it
  **Then** it leaves the public list, new bookings are rejected with `INVALID_STATE`, and the existing booking is kept.

### S05: As an attendee, I want to search, filter and sort published events, so that I can find one I like

- **Given** events titled "Lagos Tech Meetup" and "Abuja Jazz Night"
  **When** the attendee searches for "JAZZ"
  **Then** only Abuja Jazz Night is returned.
- **Given** events in Lagos and Abuja
  **When** the attendee filters by city "lagos"
  **Then** only the Lagos events are returned, whatever the capital letters.
- **Given** events with different prices
  **When** the attendee sets a maximum price and sorts by price
  **Then** only events whose cheapest tier is within the maximum are returned, cheapest first, and events with no tiers are left out.
- **Given** two events on the same day
  **When** the attendee sorts by date
  **Then** the earlier one comes first, and the two events on the same day stay in title order.
- **Given** an event at 5 PM on 5 December
  **When** the attendee filters up to the date 2026-12-05
  **Then** that event is included.
- **Given** a bad date, a price that is not a whole number, or an unknown sort option
  **When** the attendee searches
  **Then** the request is rejected with `VALIDATION`.
- **Given** any list of events
  **When** it is searched, filtered or sorted
  **Then** the original list is unchanged.

### S06: As an attendee, I want to book a number of tickets from a tier, so that I get a place

- **Given** a published event with 3 seats left in General
  **When** an attendee books 2
  **Then** a pending booking is created for 2 seats, priced in whole cents, and 1 seat is left.
- **Given** 1 seat left
  **When** an attendee books 2
  **Then** the booking is rejected with `SOLD_OUT` and nothing changes.
- **Given** any tier
  **When** the quantity is 0, negative, fractional or more than 10
  **Then** the request is rejected with `VALIDATION`.

### S16: As a team, I want to run automated tests on every push, so that we notice breakage early

- **Given** the project
  **When** someone runs `npm test`
  **Then** every test runs and the command fails if any test fails. *(Build 2)*
- **Given** a push to GitHub
  **When** the workflow runs
  **Then** `npm test` runs automatically, and a failing test shows as a failed check. *(Build 9)*

---

## Stories from earlier work (Build 1 rules, no story number yet)

These rules were built in Build 1 and still have tests in `test/domain.test.js`:

- Cancel a booking and release its seats; cancelling twice is refused (`ALREADY_CANCELLED`).
- A first-in-first-out waitlist; the person at the front is named when seats free up.
- People already waiting go first (`WAITLIST_FIRST`); one place per person (`ALREADY_WAITING`); anyone can leave.
- No new bookings once the event has started (`EVENT_STARTED`).
- Find a booking instantly by its reference code.
