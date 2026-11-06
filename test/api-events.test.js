// api-events.test.js: the event routes (POST and GET), called over real HTTP.
//   POST /api/events                 create (a draft)            GET  /api/events        search the public list
//   POST /api/events/:id/tiers       add a tier                  GET  /api/events/:id    one event
//   POST /api/events/:id/publish     make it public              POST /api/events/:id/unpublish
// After a request we often look BEHIND the API, at the store, to check what was really saved.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listEventSummaries } from '../src/domain/inventory.js';
import { apiClient, expectError, startApp } from './http-helpers.js';

// "Lagos 17:00, n days from now", written with an explicit offset so it never depends on the computer's time zone.
const at = (days, hour = 17) => `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00+01:00`;
const dateOf = (days) => at(days).slice(0, 10);

const NEW_EVENT = { title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Landmark Centre', startsAt: at(20) };

describe('the event API', () => {
  let server;
  let api;
  before(async () => {
    server = await startApp();
    api = apiClient(server.url);
  });
  after(() => server.close());
  const everything = () => listEventSummaries(server.store, { publishedOnly: false });

  // Creates an event, gives it tiers, and publishes it. Returns { id, tiers }.
  async function publishedEvent(fields, tiers = [{ name: 'General', priceCents: 500_000, capacity: 10 }]) {
    const { body } = await api.post('/api/events', { ...NEW_EVENT, ...fields });
    const id = body.event.id;
    const made = [];
    for (const tier of tiers) made.push((await api.post(`/api/events/${id}/tiers`, tier)).body.tier);
    const published = await api.post(`/api/events/${id}/publish`);
    assert.equal(published.status, 200);
    return { id, tiers: made };
  }

  describe('POST /api/events (S02: create an event)', () => {
    test('201 Created: a DRAFT with a new id, a Location header, and no internal fields', async () => {
      const res = await api.post('/api/events', NEW_EVENT);
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body), ['event']);
      const { event } = res.body;
      assert.equal(typeof event.id, 'string');
      assert.equal(res.headers.get('location'), `/api/events/${event.id}`);
      assert.equal(event.status, 'draft');
      assert.equal(event.title, 'Lagos Tech Meetup');
      assert.equal(event.city, 'Lagos');
      assert.equal(event.venue, 'Landmark Centre');
      assert.equal(event.startsAt, NEW_EVENT.startsAt);
      assert.deepEqual(event.tiers, []);
      assert.equal(event.started, false);
      assert.ok(!('tierIds' in event), 'an internal field leaked');
    });

    test('it is saved, but NOT on the public list', async () => {
      const before = everything().length;
      const { body } = await api.post('/api/events', NEW_EVENT);
      assert.equal(everything().length, before + 1);
      assert.ok(!listEventSummaries(server.store).some((e) => e.id === body.event.id));
      const list = await api.get('/api/events?q=Lagos%20Tech%20Meetup');
      assert.ok(!list.body.events.some((e) => e.id === body.event.id));
    });

    test('every event gets its own id', async () => {
      const a = await api.post('/api/events', NEW_EVENT);
      const b = await api.post('/api/events', NEW_EVENT);
      assert.notEqual(a.body.event.id, b.body.event.id);
    });

    test('the fields a client may NOT set (id, status, tiers...) are ignored', async () => {
      const res = await api.post('/api/events', { ...NEW_EVENT, id: 'hacked', status: 'published', started: true, tierIds: ['x'], tiers: [{ name: 'free', priceCents: 0, capacity: 999 }], organizerId: 'me' });
      assert.equal(res.status, 201);
      assert.notEqual(res.body.event.id, 'hacked');
      assert.equal(res.body.event.status, 'draft');
      assert.deepEqual(res.body.event.tiers, []);
      assert.equal(res.body.event.started, false);
    });

    test('a missing or blank title, city or venue -> 400 VALIDATION, and nothing is saved', async () => {
      const before = everything().length;
      for (const field of ['title', 'city', 'venue', 'startsAt']) {
        for (const value of [undefined, '', '   ', null, 5]) {
          const body = { ...NEW_EVENT, [field]: value };
          if (value === undefined) delete body[field];
          const res = await api.post('/api/events', body);
          expectError(res, 400, 'VALIDATION');
          assert.match(res.body.error.message, new RegExp(field));
        }
      }
      assert.equal(everything().length, before);
    });

    test('a date that is not a real date -> 400 VALIDATION', async () => {
      const before = everything().length;
      for (const startsAt of ['2026-02-30', 'tomorrow', '2026-13-01', '05/12/2026', '2026-12-05T25:00:00Z', '2026-12-05 18:00']) {
        expectError(await api.post('/api/events', { ...NEW_EVENT, startsAt }), 400, 'VALIDATION');
      }
      assert.equal(everything().length, before);
    });

    test('a body that is not an object (null, a list, a number, text) or no body at all -> 400, never a 500', async () => {
      for (const junk of [null, [], [1, 2], 42, 'text', true]) {
        expectError(await api.post('/api/events', junk), 400, 'VALIDATION');
      }
      expectError(await api.call('POST', '/api/events'), 400, 'VALIDATION'); // no body at all
    });

    test('broken JSON -> 400 BAD_JSON, a body that is not JSON -> 415', async () => {
      expectError(await api.postRaw('/api/events', '{"title": '), 400, 'BAD_JSON');
      expectError(await api.postRaw('/api/events', 'title=x', { 'Content-Type': 'application/x-www-form-urlencoded' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    test('other methods on the same URL: PUT, PATCH and DELETE are 405 (Allow: GET, HEAD, POST)', async () => {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await api.call(method, '/api/events', { a: 1 });
        expectError(res, 405, 'METHOD_NOT_ALLOWED');
        assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
      }
    });
  });

  describe('GET /api/events/:id', () => {
    test('returns the event with its tiers (a DRAFT can be read by id; it is only hidden from the list)', async () => {
      const created = await api.post('/api/events', NEW_EVENT);
      const res = await api.get(`/api/events/${created.body.event.id}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event: created.body.event }); // exactly what POST returned
    });

    test('an id that does not exist -> 404 NOT_FOUND', async () => {
      expectError(await api.get('/api/events/no-such-event'), 404, 'NOT_FOUND');
      expectError(await api.get('/api/events/%2e%2e'), 404, 'NOT_FOUND');
      expectError(await api.get(`/api/events/${'x'.repeat(2000)}`), 404, 'NOT_FOUND');
    });

    test('it shows how many seats are left in every tier', async () => {
      const { id } = await publishedEvent({}, [{ name: 'General', priceCents: 500_000, capacity: 100 }, { name: 'VIP', priceCents: 2_000_000, capacity: 5 }]);
      const { body } = await api.get(`/api/events/${id}`);
      assert.deepEqual(body.event.tiers.map((t) => [t.name, t.capacity, t.sold, t.seatsLeft]), [['General', 100, 0, 100], ['VIP', 5, 0, 5]]);
    });

    test('POST on the same URL is 405', async () => {
      expectError(await api.post('/api/events/anything', {}), 405, 'METHOD_NOT_ALLOWED');
    });
  });

  describe('POST /api/events/:id/tiers (S03: add a ticket tier)', () => {
    test('201: "General" at 500000 kobo with capacity 100 is saved with 0 sold and 100 seats left', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      const res = await api.post(`/api/events/${body.event.id}/tiers`, { name: 'General', priceCents: 500_000, capacity: 100 });
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body), ['tier']);
      assert.equal(res.body.tier.name, 'General');
      assert.equal(res.body.tier.priceCents, 500_000);
      assert.equal(res.body.tier.capacity, 100);
      assert.equal(res.body.tier.sold, 0);
      assert.equal(res.body.tier.seatsLeft, 100);
      assert.equal(res.body.tier.eventId, body.event.id);
      // and it really is part of the event now:
      const event = (await api.get(`/api/events/${body.event.id}`)).body.event;
      assert.deepEqual(event.tiers.map((t) => t.id), [res.body.tier.id]);
    });

    test('a price that is not a whole number, or a capacity below 1 -> 400 VALIDATION, and nothing is saved', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      const url = `/api/events/${body.event.id}/tiers`;
      const bad = [
        { name: 'x', priceCents: 9.99, capacity: 5 }, { name: 'x', priceCents: '500000', capacity: 5 }, { name: 'x', priceCents: -1, capacity: 5 },
        { name: 'x', priceCents: null, capacity: 5 }, { name: 'x', capacity: 5 },
        { name: 'x', priceCents: 100, capacity: 0 }, { name: 'x', priceCents: 100, capacity: -3 }, { name: 'x', priceCents: 100, capacity: 1.5 },
        { name: 'x', priceCents: 100, capacity: '10' }, { name: 'x', priceCents: 100 },
        { name: '', priceCents: 100, capacity: 5 }, { priceCents: 100, capacity: 5 },
        { name: 'x', priceCents: 1e300, capacity: 5 }, // too big to be an exact amount
      ];
      for (const tier of bad) expectError(await api.post(url, tier), 400, 'VALIDATION');
      assert.equal((await api.get(`/api/events/${body.event.id}`)).body.event.tiers.length, 0);
    });

    test('an event id that does not exist -> 404 NOT_FOUND', async () => {
      expectError(await api.post('/api/events/no-such-event/tiers', { name: 'General', priceCents: 500_000, capacity: 100 }), 404, 'NOT_FOUND');
    });

    test('a body that is not an object -> 400, never a 500', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      for (const junk of [null, [], 7, 'x']) expectError(await api.post(`/api/events/${body.event.id}/tiers`, junk), 400, 'VALIDATION');
      expectError(await api.call('POST', `/api/events/${body.event.id}/tiers`), 400, 'VALIDATION');
    });

    test('the fields a client may NOT set (id, sold, eventId, seatsLeft) are ignored', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      const res = await api.post(`/api/events/${body.event.id}/tiers`, { name: 'General', priceCents: 1000, capacity: 5, id: 'hacked', sold: 4, seatsLeft: 99, eventId: 'other' });
      assert.equal(res.status, 201);
      assert.notEqual(res.body.tier.id, 'hacked');
      assert.equal(res.body.tier.sold, 0);
      assert.equal(res.body.tier.seatsLeft, 5);
      assert.equal(res.body.tier.eventId, body.event.id);
    });

    test('a free tier (price 0) is allowed; tiers keep the order they were added in', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      const url = `/api/events/${body.event.id}/tiers`;
      assert.equal((await api.post(url, { name: 'Free', priceCents: 0, capacity: 5 })).status, 201);
      await api.post(url, { name: 'Paid', priceCents: 1000, capacity: 5 });
      assert.deepEqual((await api.get(`/api/events/${body.event.id}`)).body.event.tiers.map((t) => t.name), ['Free', 'Paid']);
    });

    test('GET on this URL is 405 (Allow: POST)', async () => {
      const res = await api.get('/api/events/anything/tiers');
      expectError(res, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(res.headers.get('allow'), 'POST');
    });
  });

  describe('POST /api/events/:id/publish and /unpublish (S04)', () => {
    test('with no tiers: 409 INVALID_STATE, and it stays a draft', async () => {
      const { body } = await api.post('/api/events', NEW_EVENT);
      expectError(await api.post(`/api/events/${body.event.id}/publish`), 409, 'INVALID_STATE');
      assert.equal((await api.get(`/api/events/${body.event.id}`)).body.event.status, 'draft');
    });

    test('with a tier: 200, status published, and it appears on the public list', async () => {
      const { body } = await api.post('/api/events', { ...NEW_EVENT, title: 'Publish Me 1' });
      await api.post(`/api/events/${body.event.id}/tiers`, { name: 'General', priceCents: 500_000, capacity: 10 });
      const res = await api.post(`/api/events/${body.event.id}/publish`);
      assert.equal(res.status, 200);
      assert.equal(res.body.event.status, 'published');
      const list = await api.get('/api/events?q=Publish%20Me%201');
      assert.deepEqual(list.body.events.map((e) => e.id), [body.event.id]);
    });

    test('publishing twice is harmless', async () => {
      const { id } = await publishedEvent({ title: 'Twice' });
      assert.equal((await api.post(`/api/events/${id}/publish`)).status, 200);
    });

    test('unpublish: 200, back to draft, gone from the list', async () => {
      const { id } = await publishedEvent({ title: 'Unpublish Me 2' });
      const res = await api.post(`/api/events/${id}/unpublish`);
      assert.equal(res.status, 200);
      assert.equal(res.body.event.status, 'draft');
      assert.deepEqual((await api.get('/api/events?q=Unpublish%20Me%202')).body.events, []);
    });

    test('an unknown event id -> 404 for both', async () => {
      expectError(await api.post('/api/events/nope/publish'), 404, 'NOT_FOUND');
      expectError(await api.post('/api/events/nope/unpublish'), 404, 'NOT_FOUND');
    });

    test('GET on these URLs is 405', async () => {
      expectError(await api.get('/api/events/x/publish'), 405, 'METHOD_NOT_ALLOWED');
      expectError(await api.get('/api/events/x/unpublish'), 405, 'METHOD_NOT_ALLOWED');
    });
  });

  describe('GET /api/events (S05: search, filter and sort)', () => {
    // A separate server, so these tests see only the events made here.
    let searchServer;
    let search;
    let ids;
    before(async () => {
      searchServer = await startApp();
      search = apiClient(searchServer.url);
      const make = async (fields, tiers) => {
        const { body } = await search.post('/api/events', { ...NEW_EVENT, ...fields });
        for (const tier of tiers) await search.post(`/api/events/${body.event.id}/tiers`, tier);
        return body.event.id;
      };
      ids = {
        jazz: await make({ title: 'Abuja Jazz Night', city: 'Abuja', venue: 'Jabi Lake Park', startsAt: at(10) }, [{ name: 'Standard', priceCents: 800_000, capacity: 40 }]),
        food: await make({ title: 'Lagos Food Festival', city: 'Lagos', venue: 'Tafawa Balewa Square', startsAt: at(5) }, [{ name: 'Entry', priceCents: 200_000, capacity: 200 }, { name: 'Family', priceCents: 600_000, capacity: 30 }]),
        tech: await make({ title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Landmark Centre', startsAt: at(20) }, [{ name: 'General', priceCents: 500_000, capacity: 100 }]),
        comedy: await make({ title: 'Comedy Live', city: 'Port Harcourt', venue: 'Jabi Hall', startsAt: at(15) }, [{ name: 'Gold', priceCents: 1_500_000, capacity: 3 }]),
        draft: await make({ title: 'Secret Draft', city: 'Lagos', venue: 'Somewhere', startsAt: at(2) }, [{ name: 'General', priceCents: 100_000, capacity: 10 }]),
      };
      for (const key of ['jazz', 'food', 'tech', 'comedy']) await search.post(`/api/events/${ids[key]}/publish`); // the draft stays a draft
    });
    after(() => searchServer.close());
    const names = (res) => res.body.events.map((e) => e.title);

    test('with no options: every PUBLISHED event, soonest first, never the draft', async () => {
      const res = await search.get('/api/events');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body), ['count', 'events']);
      assert.equal(res.body.count, 4);
      assert.deepEqual(names(res), ['Lagos Food Festival', 'Abuja Jazz Night', 'Comedy Live', 'Lagos Tech Meetup']);
    });

    test('each result is a small summary: id, title, city, venue, startsAt, status, tierCount, minPriceCents, seatsLeft', async () => {
      const [first] = (await search.get('/api/events')).body.events;
      assert.deepEqual(Object.keys(first).sort(), ['city', 'id', 'minPriceCents', 'seatsLeft', 'startsAt', 'status', 'tierCount', 'title', 'venue']);
      assert.equal(first.minPriceCents, 200_000); // the cheapest tier
      assert.equal(first.seatsLeft, 230); // across ALL tiers
      assert.equal(first.tierCount, 2);
      assert.equal(first.status, 'published');
    });

    test('?q=JAZZ finds Abuja Jazz Night (case does not matter; the venue is searched too)', async () => {
      assert.deepEqual(names(await search.get('/api/events?q=JAZZ')), ['Abuja Jazz Night']);
      assert.deepEqual(names(await search.get('/api/events?q=jabi')), ['Abuja Jazz Night', 'Comedy Live']); // venues "Jabi Lake Park" and "Jabi Hall"
      assert.deepEqual(names(await search.get('/api/events?q=%20%20jazz%20')), ['Abuja Jazz Night']); // spaces are ignored
    });

    test('?city=lagos finds only the Lagos events, whatever the capital letters', async () => {
      assert.deepEqual(names(await search.get('/api/events?city=lagos')), ['Lagos Food Festival', 'Lagos Tech Meetup']);
      assert.deepEqual(names(await search.get('/api/events?city=LAGOS')), ['Lagos Food Festival', 'Lagos Tech Meetup']);
      assert.deepEqual(names(await search.get('/api/events?city=Port%20Harcourt')), ['Comedy Live']);
    });

    test('?maxPriceCents=500000&sort=price: cheapest tier within the maximum, cheapest first', async () => {
      assert.deepEqual(names(await search.get('/api/events?maxPriceCents=500000&sort=price')), ['Lagos Food Festival', 'Lagos Tech Meetup']);
      assert.deepEqual(names(await search.get('/api/events?maxPriceCents=199999')), []);
    });

    test('?sort=price puts the cheapest first; ?sort=availability puts the most seats first', async () => {
      assert.deepEqual(names(await search.get('/api/events?sort=price')), ['Lagos Food Festival', 'Lagos Tech Meetup', 'Abuja Jazz Night', 'Comedy Live']);
      assert.deepEqual(names(await search.get('/api/events?sort=availability')), ['Lagos Food Festival', 'Lagos Tech Meetup', 'Abuja Jazz Night', 'Comedy Live']);
    });

    test('?to=<a date> includes events that day (a date-only "to" means the END of that day); ?from= the start', async () => {
      assert.deepEqual(names(await search.get(`/api/events?to=${dateOf(10)}`)), ['Lagos Food Festival', 'Abuja Jazz Night']);
      assert.deepEqual(names(await search.get(`/api/events?from=${dateOf(10)}&to=${dateOf(15)}`)), ['Abuja Jazz Night', 'Comedy Live']);
      assert.deepEqual(names(await search.get(`/api/events?from=${dateOf(21)}`)), []);
    });

    test('options combine: an event must pass every one', async () => {
      assert.deepEqual(names(await search.get('/api/events?city=lagos&maxPriceCents=300000')), ['Lagos Food Festival']);
      assert.deepEqual(names(await search.get('/api/events?q=lagos&city=abuja')), []);
    });

    test('?onlyAvailable=true hides sold-out events', async () => {
      // Sell every seat of Comedy Live (3 seats), through the API.
      const comedy = (await search.get(`/api/events/${ids.comedy}`)).body.event;
      const booked = await search.post('/api/bookings', { eventId: ids.comedy, tierId: comedy.tiers[0].id, quantity: 3, customer: 'Ada' });
      assert.equal(booked.status, 201);
      assert.ok(!names(await search.get('/api/events?onlyAvailable=true')).includes('Comedy Live'));
      assert.ok(names(await search.get('/api/events?onlyAvailable=false')).includes('Comedy Live'));
      assert.equal((await search.get('/api/events?sort=availability')).body.events.at(-1).title, 'Comedy Live'); // 0 seats: last
    });

    test('empty options mean "not given"; nothing found is 200 with an empty list', async () => {
      assert.equal((await search.get('/api/events?q=&city=&sort=&maxPriceCents=')).body.count, 4);
      const none = await search.get('/api/events?q=zzzzz');
      assert.equal(none.status, 200);
      assert.deepEqual(none.body, { count: 0, events: [] });
    });

    test('bad options -> 400 VALIDATION (a bad date, a price that is not whole, an unknown sort, a wrong yes/no)', async () => {
      for (const query of [
        'from=tomorrow', 'to=2026-02-30', 'from=05/12/2026', 'maxPriceCents=9.99', 'maxPriceCents=abc', 'maxPriceCents=-1',
        'maxPriceCents=1e3', 'maxPriceCents=99999999999999999999', 'onlyAvailable=yes', 'onlyAvailable=1', 'sort=popularity', 'sort=DATE',
      ]) {
        expectError(await search.get(`/api/events?${query}`), 400, 'VALIDATION');
      }
    });

    test('an option that does not exist is refused, so a typo cannot silently show everything', async () => {
      const res = await search.get('/api/events?citty=Lagos');
      expectError(res, 400, 'VALIDATION');
      assert.match(res.body.error.message, /citty/);
      expectError(await search.get('/api/events?page=2'), 400, 'VALIDATION');
    });

    test('searching changes nothing: the same request gives the same answer, and HEAD works', async () => {
      const a = await search.get('/api/events?city=lagos&sort=price');
      const b = await search.get('/api/events?city=lagos&sort=price');
      assert.deepEqual(a.body, b.body);
      const head = await search.call('HEAD', '/api/events');
      assert.equal(head.status, 200);
      assert.equal(head.text, '');
    });

    test('a repeated option uses the last value, and "__proto__" is just an unknown option', async () => {
      assert.deepEqual(names(await search.get('/api/events?city=abuja&city=lagos')), ['Lagos Food Festival', 'Lagos Tech Meetup']);
      expectError(await search.get('/api/events?__proto__=x'), 400, 'VALIDATION');
      assert.equal({}.x, undefined);
    });
  });
});
