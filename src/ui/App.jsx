// App.jsx: the whole React screen.
// React only DRAWS. Every rule (capacity, 1 to 10 tickets, FIFO waitlist) is enforced by the
// domain functions imported below. The UI just calls them and shows the result or the error.

import { useReducer, useRef, useState } from 'react';
import { DomainError } from '../domain/errors.js';
import { formatMoney } from '../domain/money.js';
import { searchEvents, SORT_OPTIONS } from '../domain/eventSearch.js';
import { compareText, mergeSort } from '../domain/sorting.js';
import {
  createStore, createEvent, addTier, publishEvent, bookTickets, cancelBooking, findBookingByReference,
  joinWaitlist, leaveWaitlist, takeNextFromWaitlist, listEvents, listEventSummaries, listWaitlist,
  MAX_TICKETS_PER_BOOKING,
} from '../domain/inventory.js';

// ---------- starter data ----------

// An ISO date n days from now at 18:00 Lagos time (17:00 UTC). Events are always in the future:
// a fixed date would silently expire, and the domain refuses bookings once an event has started.
function dayAt(n) {
  const d = new Date(Date.now() + n * 24 * 3600 * 1000);
  d.setUTCHours(17, 0, 0, 0);
  return d.toISOString();
}

// Creates demo data so the screen isn't empty. Every event starts as a DRAFT, gets its tiers, and is then
// PUBLISHED (the last one is left as a draft on purpose: drafts never appear in the public list).
// Prices are whole kobo: 500_000 = ₦5,000.
function seed() {
  const store = createStore();
  const make = (title, city, venue, days, tiers, publish = true) => {
    const event = createEvent(store, { title, city, venue, startsAt: dayAt(days) });
    for (const [name, priceCents, capacity] of tiers) addTier(store, event.id, { name, priceCents, capacity });
    if (publish) publishEvent(store, event.id);
    return event;
  };
  const main = make('Lagos Night of Tech', 'Lagos', 'Landmark Centre, Victoria Island', 30, [['Regular', 500_000, 6], ['VIP', 2_000_000, 2]]);
  make('Abuja Jazz Night', 'Abuja', 'Jabi Lake Park', 12, [['Standard', 800_000, 40], ['Front row', 2_500_000, 4]]);
  make('Lagos Food Festival', 'Lagos', 'Tafawa Balewa Square', 45, [['Entry', 200_000, 200], ['Family pack', 600_000, 30]]);
  make('Port Harcourt Comedy Live', 'Port Harcourt', 'Hotel Presidential', 20, [['Silver', 1_000_000, 5], ['Gold', 1_500_000, 3]]);
  make('Ibadan Book Fair', 'Ibadan', 'Cultural Centre, Mokola', 60, [['Entry', 100_000, 100]], false); // a draft
  return { store, eventId: main.id };
}

// ---------- small helpers ----------

// "Ada Obi" -> "AO": used for the round avatars in the waitlist.
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Shared Tailwind class strings, so every field and button looks the same.
const field = 'w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-base placeholder:text-ink/35 focus:border-cobalt';
const btnPrimary = 'w-full rounded-xl bg-cobalt px-5 py-3.5 text-base font-bold text-white shadow-lg shadow-cobalt/25 transition hover:bg-cobalt/90 active:scale-[0.99] disabled:opacity-40';
const btnQuiet = 'rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-semibold transition hover:border-ink/40 disabled:opacity-40';

// ---------- the page ----------

export default function App() {
  // ----- state -----

  // The domain store is a plain mutable object, not React state. useRef keeps the SAME object between
  // renders; the `if` makes sure seed() runs only once, on the first render.
  const app = useRef(null);
  if (!app.current) app.current = seed();
  const { store, eventId } = app.current;

  // React can't see changes to the store, so after every action we call refresh().
  // It bumps a counter, which forces a re-render so the screen shows the new data.
  const [, refresh] = useReducer((n) => n + 1, 0);

  // The "Recent activity" messages, newest first. logId gives each one a unique key.
  const logId = useRef(0);
  const [log, setLog] = useState([]);

  // Which event is open (the main screen shows this one). Starts on the first demo event.
  const [selectedId, setSelectedId] = useState(eventId);

  // The search form. Everything is kept as the text the person typed; it is converted below.
  const [filters, setFilters] = useState({ q: '', city: '', from: '', to: '', maxNaira: '', onlyAvailable: false, sortBy: 'date' });
  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));

  // Form fields. tierId null means "use the first tier" (resolved below).
  const [tierId, setTierId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [customer, setCustomer] = useState('');
  const [lookup, setLookup] = useState('');

  // ----- values worked out on every render -----

  // A fresh read-only snapshot of the event and its tiers (with seatsLeft and waitlistSize).
  const event = listEvents(store).find((e) => e.id === selectedId);
  // The chosen tier, or the first one. (If the tier chosen earlier belongs to another event, `find` gives
  // undefined and `??` falls back to the first tier.)
  const tier = event.tiers.find((t) => t.id === tierId) ?? event.tiers[0];

  // ----- search (Build 2) -----
  // The public list: PUBLISHED events only. Then the pure search functions filter and sort a NEW list.
  const summaries = listEventSummaries(store);
  // The city drop-down lists each city once, sorted with our own merge sort.
  const cities = mergeSort([...new Set(summaries.map((e) => e.city))], compareText);
  let results = [];
  let searchError = null;
  try {
    results = searchEvents(summaries, {
      q: filters.q,
      city: filters.city || undefined, // "" means "any city"
      from: filters.from || undefined, // <input type="date"> gives "2026-12-05", or "" when empty
      to: filters.to || undefined,
      // Naira typed by the person -> whole kobo. Text that isn't a number becomes NaN and the domain refuses it.
      maxPriceCents: filters.maxNaira.trim() === '' ? undefined : Math.round(Number(filters.maxNaira) * 100),
      onlyAvailable: filters.onlyAvailable,
    }, filters.sortBy);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    searchError = `${e.code}: ${e.message}`; // shown under the form instead of crashing
  }
  // The button becomes "Join waitlist" when seats are short, OR when people are already waiting
  // (they are ahead of you even if seats exist: the domain enforces this too, with WAITLIST_FIRST).
  const lineExists = tier.waitlistSize > 0;
  const needsWaitlist = quantity > tier.seatsLeft || lineExists;

  // Totals for the hero's stat chips.
  const seatsLeftTotal = event.tiers.reduce((sum, t) => sum + t.seatsLeft, 0);
  const soldTotal = event.tiers.reduce((sum, t) => sum + t.sold, 0);
  const waitingTotal = event.tiers.reduce((sum, t) => sum + t.waitlistSize, 0);

  // Look up the typed reference on every keystroke. This is cheap because it is one O(1) Map lookup.
  // A failed lookup (still typing, or wrong code) is normal here, so the catch simply ignores it.
  let found = null;
  try { found = lookup.trim() ? findBookingByReference(store, lookup) : null; } catch { /* not found yet */ }

  // ----- actions -----

  // Adds a message to the activity list, keeping the latest 6.
  // The id is made OUTSIDE the updater function, because React may call updaters twice in dev.
  const say = (kind, text) => {
    const id = logId.current++;
    setLog((l) => [{ id, kind, text }, ...l].slice(0, 6));
  };

  // EVERY button goes through run(). It calls the domain function and shows the success message,
  // or turns a DomainError (SOLD_OUT, VALIDATION...) into a readable red one.
  // Any other error is a real bug, so it is re-thrown instead of hidden.
  // `finally` always refreshes, because even a failed action may have changed what should be shown.
  function run(fn) {
    try {
      const message = fn();
      if (message) say('ok', message);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      say('error', `${e.code}: ${e.message}`);
    } finally {
      refresh();
    }
  }

  // The booking form's submit handler: books, or joins the waitlist when seats are short.
  const submit = (e) => {
    e.preventDefault(); // stop the browser reloading the page
    run(() => {
      const args = { eventId: event.id, tierId: tier.id, quantity, customer };
      if (needsWaitlist) {
        const { position } = joinWaitlist(store, args);
        return `${customer.trim()} is number ${position} on the ${tier.name} waitlist`;
      }
      const b = bookTickets(store, args);
      setLookup(b.reference); // fill the lookup box so the new ticket appears on the right
      return `Booked ${b.quantity} × ${tier.name} for ${b.customer}`;
    });
  };

  // Cancels the looked-up booking and names who is next in line.
  const cancel = () => run(() => {
    const r = cancelBooking(store, found.reference);
    return r.nextInLine
      ? `Cancelled ${found.reference}. Next in line: ${r.nextInLine.customer}`
      : `Cancelled ${found.reference}. Nobody is waiting`;
  });

  // Removes one person from a tier's waitlist (everyone behind them moves up).
  const leave = (t, w) => run(() => {
    leaveWaitlist(store, { tierId: t.id, entryId: w.id });
    return `${w.customer} left the ${t.name} waitlist`;
  });

  // Books the person at the front of a tier's waitlist.
  const bookNext = (t) => run(() => {
    const b = takeNextFromWaitlist(store, t.id);
    setLookup(b.reference);
    return `Booked ${b.quantity} × ${t.name} for ${b.customer} from the waitlist`;
  });

  // ----- what appears on screen -----

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
      <Browse
        filters={filters} setF={setF} cities={cities} results={results} error={searchError}
        selectedId={event.id}
        onOpen={(id) => { setSelectedId(id); setTierId(null); setQuantity(1); }}
      />

      <Hero event={event} seatsLeft={seatsLeftTotal} sold={soldTotal} waiting={waitingTotal} />

      {/* Two columns on large screens (tickets | forms); one stacked column on phones */}
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        {/* LEFT: the ticket tiers, then the waitlists */}
        <div className="space-y-8">
          <section aria-label="Ticket tiers" className="space-y-5">
            {event.tiers.map((t, i) => (
              <TierTicket key={t.id} tier={t} premium={i > 0} />
            ))}
          </section>
          <Waitlists store={store} tiers={event.tiers} onBook={bookNext} onLeave={leave} />
        </div>

        {/* RIGHT: booking form, found ticket, activity. On big screens this column sticks while you scroll. */}
        <div className="space-y-6 lg:sticky lg:top-6">
          <form onSubmit={submit} className="space-y-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-2xl font-extrabold tracking-tight">Get tickets</h2>

            {/* Tier picker: big radio-style buttons instead of a dropdown */}
            <div role="radiogroup" aria-label="Ticket type" className="grid grid-cols-2 gap-3">
              {event.tiers.map((t) => {
                const selected = t.id === tier.id;
                return (
                  <button type="button" role="radio" aria-checked={selected} key={t.id} onClick={() => setTierId(t.id)}
                    className={`rounded-2xl border-2 p-3 text-left transition ${selected ? 'border-cobalt bg-cobalt/5' : 'border-ink/10 hover:border-ink/25'}`}>
                    <span className="block font-bold">{t.name}</span>
                    <span className="num block text-sm text-ink/70">{formatMoney(t.priceCents)}</span>
                    <span className={`num mt-1 block text-xs font-semibold ${t.seatsLeft === 0 ? 'text-coral' : 'text-mint'}`}>
                      {t.seatsLeft === 0 ? 'Sold out' : `${t.seatsLeft} left`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quantity stepper: the − and + buttons keep the number inside 1..10,
                so the UI never sends a quantity the domain would reject */}
            <div className="flex items-center justify-between">
              <span className="font-semibold">How many?</span>
              <div className="flex items-center gap-3">
                <button type="button" aria-label="One fewer ticket" className={`${btnQuiet} size-10 text-lg`}
                  disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</button>
                <span className="num w-6 text-center text-xl font-extrabold" aria-live="polite">{quantity}</span>
                <button type="button" aria-label="One more ticket" className={`${btnQuiet} size-10 text-lg`}
                  disabled={quantity >= MAX_TICKETS_PER_BOOKING} onClick={() => setQuantity(quantity + 1)}>+</button>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Name on the booking</span>
              <input className={field} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Ada Obi" autoComplete="name" />
            </label>

            {/* Live summary: the total (integer kobo maths), or why the button now says "Join waitlist" */}
            <div className={`rounded-xl px-4 py-3 text-sm ${needsWaitlist ? 'bg-gold/25' : 'bg-page'}`}>
              {event.started ? (
                <p><strong>This event has started.</strong> Booking and the waitlist are closed.</p>
              ) : needsWaitlist ? (
                <p>
                  <strong>
                    {lineExists && quantity <= tier.seatsLeft
                      ? `${tier.waitlistSize} already waiting.`
                      : tier.seatsLeft === 0 ? `${tier.name} is sold out.` : `Only ${tier.seatsLeft} left.`}
                  </strong>{' '}
                  {lineExists && quantity <= tier.seatsLeft
                    ? 'Seats go to the people ahead of you first. Join the line to keep it fair.'
                    : "Join the waitlist and we'll name you when seats free up."}
                </p>
              ) : (
                <p className="num flex justify-between"><span>{quantity} × {formatMoney(tier.priceCents)}</span><strong className="text-base">{formatMoney(tier.priceCents * quantity)}</strong></p>
              )}
            </div>

            <button className={btnPrimary} disabled={event.started}>{needsWaitlist ? 'Join waitlist' : 'Book tickets'}</button>
          </form>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-2xl font-extrabold tracking-tight">Find a booking</h2>
            <input className={`${field} font-mono uppercase tracking-widest`} aria-label="Reference code" value={lookup}
              onChange={(e) => setLookup(e.target.value)} placeholder="7K2M-9Q4X" />
            {found ? (
              <Pass booking={found} tierName={event.tiers.find((t) => t.id === found.tierId).name} onCancel={cancel} />
            ) : (
              <p className="text-sm text-ink/55">{lookup.trim() ? 'No booking with that code.' : 'Type or paste a reference code to see the ticket.'}</p>
            )}
          </section>

          <Activity log={log} />
        </div>
      </div>
    </main>
  );
}

// ---------- pieces ----------

// The search panel (S05): a form on top, the matching events below. Pressing an event opens it in the main screen.
function Browse({ filters, setF, cities, results, error, selectedId, onOpen }) {
  const label = 'mb-1 block text-xs font-bold uppercase tracking-wider text-ink/60';
  return (
    <section aria-label="Find an event" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <h2 className="text-2xl font-extrabold tracking-tight">Find an event</h2>

      {/* The criteria. Each control has an aria-label so screen readers (and the tests) can name it. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="sm:col-span-2"><span className={label}>Search</span>
          <input className={field} aria-label="Search events" placeholder="Title or venue, like “jazz”" value={filters.q} onChange={(e) => setF({ q: e.target.value })} />
        </label>
        <label><span className={label}>City</span>
          <select className={field} aria-label="City" value={filters.city} onChange={(e) => setF({ city: e.target.value })}>
            <option value="">Any city</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label><span className={label}>Sort by</span>
          <select className={field} aria-label="Sort by" value={filters.sortBy} onChange={(e) => setF({ sortBy: e.target.value })}>
            {/* The labels people see, for the three sort options the domain accepts */}
            {SORT_OPTIONS.map((o) => <option key={o} value={o}>{{ date: 'Date, soonest first', price: 'Price, cheapest first', availability: 'Most seats left' }[o]}</option>)}
          </select>
        </label>
        <label><span className={label}>From</span>
          <input className={field} type="date" aria-label="From date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
        </label>
        <label><span className={label}>Until (included)</span>
          <input className={field} type="date" aria-label="To date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
        </label>
        <label><span className={label}>Max price (₦)</span>
          <input className={`${field} num`} inputMode="decimal" aria-label="Maximum price in naira" placeholder="5000" value={filters.maxNaira} onChange={(e) => setF({ maxNaira: e.target.value })} />
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-cobalt" checked={filters.onlyAvailable} onChange={(e) => setF({ onlyAvailable: e.target.checked })} />
          Only with seats left
        </label>
      </div>

      {/* A refused search (for example a price that isn't a number) shows the domain's own message */}
      {error && <p role="alert" className="mt-4 rounded-xl bg-coral/10 px-4 py-2.5 text-sm font-medium text-coral">{error}</p>}

      <p aria-live="polite" className="num mt-4 text-sm font-semibold text-ink/60">
        {error ? '' : `${results.length} ${results.length === 1 ? 'event' : 'events'}`}
      </p>

      <ul aria-label="Search results" className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {results.map((e) => {
          const open = e.id === selectedId;
          return (
            <li key={e.id}>
              <button aria-label={`Open ${e.title}`} aria-pressed={open} onClick={() => onOpen(e.id)}
                className={`h-full w-full rounded-2xl border-2 p-4 text-left transition ${open ? 'border-cobalt bg-cobalt/5' : 'border-ink/10 hover:border-ink/30'}`}>
                <span className="block font-bold leading-tight">{e.title}</span>
                <span className="mt-1 block text-sm text-ink/65">
                  {e.city} · {new Date(e.startsAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' })}
                </span>
                <span className="num mt-2 block text-sm font-semibold">{e.minPriceCents === null ? 'No tickets yet' : `from ${formatMoney(e.minPriceCents)}`}</span>
                <span className={`num block text-xs font-bold ${e.seatsLeft === 0 ? 'text-coral' : 'text-mint'}`}>{e.seatsLeft === 0 ? 'Sold out' : `${e.seatsLeft} seats left`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!error && results.length === 0 && <p className="mt-2 text-sm text-ink/55">No events match. Try fewer filters.</p>}
    </section>
  );
}

// The dark banner at the top: date block, event name, venue and three live stats.
function Hero({ event, seatsLeft, sold, waiting }) {
  const d = new Date(event.startsAt);
  const tz = { timeZone: 'Africa/Lagos' }; // show Lagos time no matter where the browser is
  return (
    <header className="relative overflow-hidden rounded-3xl bg-navy p-6 text-white sm:p-10">
      {/* Decoration only (aria-hidden): a glowing blob and a dot grid */}
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 size-96 rounded-full bg-cobalt/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.1] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]" />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        {/* Calendar-style date block */}
        <div className="w-24 shrink-0 rounded-2xl bg-gold px-3 py-3 text-center text-navy">
          <p className="text-xs font-bold uppercase tracking-widest">{d.toLocaleDateString('en-NG', { ...tz, month: 'short' })}</p>
          <p className="num text-5xl font-extrabold leading-none">{d.toLocaleDateString('en-NG', { ...tz, day: 'numeric' })}</p>
          <p className="mt-1 text-xs font-semibold">{d.toLocaleDateString('en-NG', { ...tz, weekday: 'short' })}</p>
        </div>
        <div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{event.title}</h1>
          <p className="mt-3 text-lg text-white/75">
            {event.venue}, {event.city} · {d.toLocaleTimeString('en-NG', { ...tz, hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Live stats chips */}
      <dl className="relative mt-8 grid grid-cols-3 gap-3 sm:max-w-md">
        {[['Seats left', seatsLeft], ['Sold', sold], ['Waiting', waiting]].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <dd className="num text-3xl font-extrabold">{value}</dd>
            <dt className="text-xs font-semibold uppercase tracking-wider text-white/65">{label}</dt>
          </div>
        ))}
      </dl>
    </header>
  );
}

// One ticket-shaped card. `premium` makes it the dark gold-trimmed VIP style.
function TierTicket({ tier, premium }) {
  const soldOut = tier.seatsLeft === 0;
  const pct = (tier.sold / tier.capacity) * 100; // how full the progress bar is
  return (
    <article className={`relative flex animate-rise overflow-hidden rounded-3xl shadow-sm ring-1 ${premium ? 'bg-navy text-white ring-white/10' : 'bg-white ring-ink/5'}`}>
      {/* Left: name, price, progress */}
      <div className="flex-1 p-6">
        <p className={`text-xs font-bold uppercase tracking-[0.2em] ${premium ? 'text-gold' : 'text-cobalt'}`}>{premium ? 'Premium access' : 'General admission'}</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{tier.name}</h2>
        <p className="num mt-1 text-xl font-semibold">{formatMoney(tier.priceCents)}</p>
        {/* Progress bar: the filled width is sold / capacity as a percentage; it turns coral when full */}
        <div className={`mt-5 h-2.5 overflow-hidden rounded-full ${premium ? 'bg-white/15' : 'bg-page'}`} role="img" aria-label={`${tier.sold} of ${tier.capacity} sold`}>
          <div className={`h-full rounded-full transition-all duration-500 ${soldOut ? 'bg-coral' : premium ? 'bg-gold' : 'bg-cobalt'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="num mt-2 text-sm opacity-70">{tier.sold} of {tier.capacity} sold</p>
      </div>

      {/* Right: the tear-off stub with the big seats-left number.
          The two circles are page-coloured, so they look like punched holes in the ticket. */}
      <div className={`relative flex w-32 flex-col items-center justify-center border-l-2 border-dashed p-4 text-center sm:w-40 ${premium ? 'border-white/25' : 'border-ink/20'}`}>
        <span aria-hidden className="absolute -left-3.5 -top-3.5 size-7 rounded-full bg-page" />
        <span aria-hidden className="absolute -bottom-3.5 -left-3.5 size-7 rounded-full bg-page" />
        {soldOut ? (
          <p className="-rotate-6 rounded-md border-2 border-coral px-2 py-1 text-lg font-extrabold uppercase leading-tight tracking-wide text-coral">Sold out</p>
        ) : (
          <>
            <p className="num text-6xl font-extrabold leading-none">{tier.seatsLeft}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest opacity-60">seats left</p>
          </>
        )}
      </div>
    </article>
  );
}

// The waiting lines, one list per tier. The first person gets a highlight and a "Book them" button.
function Waitlists({ store, tiers, onBook, onLeave }) {
  const any = tiers.some((t) => t.waitlistSize > 0);
  return (
    <section aria-label="Waitlists" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <h2 className="text-2xl font-extrabold tracking-tight">Waitlist</h2>
      {!any && <p className="mt-2 text-sm text-ink/55">Nobody is waiting. When a tier sells out, anyone who asks for more seats than remain can join here, and the line is strictly first come, first served.</p>}
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {tiers.filter((t) => t.waitlistSize > 0).map((t) => (
          <div key={t.id}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-ink/60">{t.name}</h3>
            <ol className="space-y-2">
              {listWaitlist(store, t.id).map((w, i) => (
                <li key={w.id} className={`flex animate-rise items-center gap-3 rounded-2xl p-2.5 ${i === 0 ? 'bg-gold/25 ring-1 ring-gold' : 'bg-page'}`}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">{initials(w.customer)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.customer}</span>
                    <span className="num block text-xs text-ink/60">{i === 0 ? 'Next in line' : `Position ${i + 1}`} · {w.quantity} ticket{w.quantity > 1 ? 's' : ''}</span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {i === 0 && <button className={btnQuiet} onClick={() => onBook(t)}>Book them</button>}
                    {/* Anyone can give up their place; the aria-label says WHO, since every row has a Leave button */}
                    <button className={btnQuiet} aria-label={`${w.customer} leaves the waitlist`} onClick={() => onLeave(t, w)}>Leave</button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

// A booking shown as a ticket: name, details, big reference code, barcode and a cancel button.
function Pass({ booking, tierName, onCancel }) {
  const cancelled = booking.status === 'CANCELLED';
  return (
    <div className="relative animate-rise overflow-hidden rounded-2xl bg-page">
      <div className={`flex items-center justify-between px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white ${cancelled ? 'bg-ink/60' : 'bg-cobalt'}`}>
        <span>{tierName} ticket</span>
        <span>{cancelled ? 'Cancelled' : 'Pending'}</span>
      </div>
      <div className={`p-5 ${cancelled ? 'opacity-50' : ''}`}>
        <p className="text-2xl font-extrabold">{booking.customer}</p>
        <p className="num text-sm text-ink/70">{booking.quantity} × {tierName} · {formatMoney(booking.totalCents)}</p>
        {/* The reference code, big and spaced out so it is easy to read aloud */}
        <p className="mt-4 font-mono text-3xl font-bold tracking-[0.18em]">{booking.reference}</p>
        <div aria-hidden className="barcode mt-3 h-10 opacity-80" />
      </div>
      {/* Diagonal CANCELLED stamp, shown only for cancelled bookings */}
      {cancelled && (
        <p aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded-lg border-4 border-coral px-4 py-1 text-3xl font-extrabold uppercase tracking-widest text-coral">Cancelled</span>
        </p>
      )}
      <div className="border-t-2 border-dashed border-ink/15 px-5 py-3">
        <button className={btnQuiet} disabled={cancelled} onClick={onCancel}>Cancel booking</button>
      </div>
    </div>
  );
}

// The latest messages. aria-live makes screen readers announce new ones. Green = success, red = refused.
function Activity({ log }) {
  return (
    <section aria-live="polite" aria-label="Recent activity" className="space-y-2">
      {log.map((l) => (
        <p key={l.id} className={`animate-rise rounded-xl px-4 py-2.5 text-sm font-medium ${l.kind === 'error' ? 'bg-coral/10 text-coral' : 'bg-mint/10 text-mint'}`}>{l.text}</p>
      ))}
    </section>
  );
}
