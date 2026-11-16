import { holdsSeats } from '../domain/bookingStateMachine.js';
import { referenceKey } from '../domain/ids.js';

const copy = (value) => (value === null || value === undefined ? value : structuredClone(value));

function eventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    city: row.city,
    venue: row.venue,
    startsAt: row.starts_at,
    status: row.status,
  };
}

function tierFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    priceCents: row.price_cents,
    capacity: row.capacity,
    sold: row.sold,
  };
}

function bookingFromRow(row) {
  if (!row) return null;
  const reference = row.reference.length === 8
    ? `${row.reference.slice(0, 4)}-${row.reference.slice(4)}`
    : row.reference;
  return {
    id: row.id,
    reference,
    eventId: row.event_id,
    tierId: row.tier_id,
    userId: row.user_id,
    quantity: row.quantity,
    customer: row.customer,
    totalCents: row.total_cents,
    status: row.status,
    createdAt: row.created_at,
    ...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
    history: JSON.parse(row.history_json),
  };
}

export function createSqliteRepository(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('createSqliteRepository needs a SQLite database');
  }

  const statements = Object.freeze({
    insertEvent: database.prepare(`
      INSERT INTO events (id, title, city, venue, starts_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getEvent: database.prepare('SELECT * FROM events WHERE id = ?'),
    listEvents: database.prepare('SELECT * FROM events ORDER BY rowid'),
    updateEvent: database.prepare(`
      UPDATE events SET title = ?, city = ?, venue = ?, starts_at = ?, status = ?
      WHERE id = ?
    `),
    insertTier: database.prepare(`
      INSERT INTO ticket_tiers (id, event_id, name, price_cents, capacity, sold)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getTier: database.prepare('SELECT * FROM ticket_tiers WHERE id = ?'),
    listTiersForEvent: database.prepare('SELECT * FROM ticket_tiers WHERE event_id = ? ORDER BY rowid'),
    updateTier: database.prepare(`
      UPDATE ticket_tiers SET name = ?, price_cents = ?, capacity = ?, sold = ?
      WHERE id = ?
    `),
    reserveSeats: database.prepare(`
      UPDATE ticket_tiers
      SET sold = sold + ?
      WHERE id = ? AND sold + ? <= capacity
    `),
    releaseSeats: database.prepare(`
      UPDATE ticket_tiers
      SET sold = sold - ?
      WHERE id = ? AND sold >= ?
    `),
    insertUser: database.prepare(`
      INSERT INTO users (id, created_at) VALUES (?, ?)
      ON CONFLICT(id) DO NOTHING
    `),
    insertBooking: database.prepare(`
      INSERT INTO bookings (
        id, reference, event_id, tier_id, user_id, quantity, customer,
        total_cents, status, created_at, cancelled_at, history_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getBookingByReference: database.prepare('SELECT * FROM bookings WHERE reference = ?'),
    listBookings: database.prepare('SELECT * FROM bookings ORDER BY rowid'),
    listBookingsForEvent: database.prepare('SELECT * FROM bookings WHERE event_id = ? ORDER BY rowid'),
    updateBooking: database.prepare(`
      UPDATE bookings
      SET status = ?, cancelled_at = ?, history_json = ?
      WHERE reference = ? AND status = ?
    `),
  });

  return Object.freeze({
    async createEvent(event) {
      statements.insertEvent.run(
        event.id, event.title, event.city, event.venue, event.startsAt, event.status,
      );
      return copy(event);
    },

    async getEvent(id) {
      return eventFromRow(statements.getEvent.get(id));
    },

    async listEvents() {
      return statements.listEvents.all().map(eventFromRow);
    },

    async saveEvent(event) {
      statements.updateEvent.run(
        event.title, event.city, event.venue, event.startsAt, event.status, event.id,
      );
      return eventFromRow(statements.getEvent.get(event.id));
    },

    async createTier(tier) {
      statements.insertTier.run(
        tier.id, tier.eventId, tier.name, tier.priceCents, tier.capacity, tier.sold,
      );
      return copy(tier);
    },

    async getTier(id) {
      return tierFromRow(statements.getTier.get(id));
    },

    async listTiersForEvent(eventId) {
      return statements.listTiersForEvent.all(eventId).map(tierFromRow);
    },

    async saveTier(tier) {
      statements.updateTier.run(tier.name, tier.priceCents, tier.capacity, tier.sold, tier.id);
      return tierFromRow(statements.getTier.get(tier.id));
    },

    async createBooking(booking) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const reservation = statements.reserveSeats.run(
          booking.quantity, booking.tierId, booking.quantity,
        );
        if (reservation.changes !== 1) {
          database.exec('ROLLBACK');
          return null;
        }

        statements.insertUser.run(booking.userId, booking.createdAt);
        statements.insertBooking.run(
          booking.id,
          referenceKey(booking.reference),
          booking.eventId,
          booking.tierId,
          booking.userId,
          booking.quantity,
          booking.customer,
          booking.totalCents,
          booking.status,
          booking.createdAt,
          booking.cancelledAt ?? null,
          JSON.stringify(booking.history),
        );
        database.exec('COMMIT');
        return copy(booking);
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async getBookingByReference(reference) {
      return bookingFromRow(statements.getBookingByReference.get(referenceKey(reference)));
    },

    async listBookings({ eventId } = {}) {
      const rows = eventId === undefined
        ? statements.listBookings.all()
        : statements.listBookingsForEvent.all(eventId);
      return rows.map(bookingFromRow);
    },

    async transitionBooking(reference, expectedStatus, booking) {
      const key = referenceKey(reference);
      database.exec('BEGIN IMMEDIATE');
      try {
        const row = statements.getBookingByReference.get(key);
        if (!row || row.status !== expectedStatus) {
          database.exec('ROLLBACK');
          return null;
        }

        const current = bookingFromRow(row);
        const updated = statements.updateBooking.run(
          booking.status,
          booking.cancelledAt ?? null,
          JSON.stringify(booking.history),
          key,
          expectedStatus,
        );
        if (updated.changes !== 1) {
          database.exec('ROLLBACK');
          return null;
        }

        const hadSeats = holdsSeats(current.status);
        const willHoldSeats = holdsSeats(booking.status);
        if (!hadSeats && willHoldSeats) {
          const reservation = statements.reserveSeats.run(
            booking.quantity, current.tierId, booking.quantity,
          );
          if (reservation.changes !== 1) {
            database.exec('ROLLBACK');
            return null;
          }
        } else if (hadSeats && !willHoldSeats) {
          const release = statements.releaseSeats.run(
            current.quantity, current.tierId, current.quantity,
          );
          if (release.changes !== 1) {
            throw new Error(`Ticket tier ${current.tierId} has an invalid sold count`);
          }
        }

        database.exec('COMMIT');
        return copy(booking);
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  });
}
