// App.jsx: the React screen. Event and booking operations go through the REST API;
// this component keeps only transient form and display state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '../domain/money.js';
import { SORT_OPTIONS } from '../domain/eventSearch.js';
import { compareText, mergeSort } from '../domain/sorting.js';
import { BookingState, canTransition } from '../domain/bookingStateMachine.js';
import { MAX_TICKETS_PER_BOOKING } from '../domain/ticketLimits.js';
import { requestJson } from './api.js';
import { clearSession, getSession, saveSession } from './session.js';

// ---------- small helpers ----------

// "Ada Obi" -> "AO": used for the round avatars in the waitlist.
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Shared Tailwind class strings, so every field and button looks the same.
const field = 'w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-base placeholder:text-ink/35 focus:border-cobalt';
const btnPrimary = 'w-full rounded-xl bg-cobalt px-5 py-3.5 text-base font-bold text-white shadow-lg shadow-cobalt/25 transition hover:bg-cobalt/90 active:scale-[0.99] disabled:opacity-40';
const btnQuiet = 'rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-semibold transition hover:border-ink/40 disabled:opacity-40';

function searchPath(filters) {
  const query = new URLSearchParams();
  for (const key of ['q', 'city', 'from', 'to']) {
    if (filters[key]) query.set(key, filters[key]);
  }
  const maxNaira = filters.maxNaira.trim();
  if (maxNaira) {
    const naira = Number(maxNaira);
    query.set('maxPriceCents', Number.isFinite(naira) ? String(Math.round(naira * 100)) : maxNaira);
  }
  query.set('onlyAvailable', String(filters.onlyAvailable));
  query.set('sort', filters.sortBy);
  return `/api/events?${query}`;
}

// ---------- the page ----------

export default function App() {
  const [session, setSession] = useState(getSession);
  const user = session?.user ?? null;
  const [page, setPage] = useState('browse');
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authRole, setAuthRole] = useState('attendee');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const logId = useRef(0);
  const [log, setLog] = useState([]);
  const [filters, setFilters] = useState({
    q: '', city: '', from: '', to: '', maxNaira: '', onlyAvailable: false, sortBy: 'date',
  });
  const [allEvents, setAllEvents] = useState([]);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [searchLoading, setSearchLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [event, setEvent] = useState(null);
  const [waitlists, setWaitlists] = useState({});
  const [eventError, setEventError] = useState('');
  const [eventLoading, setEventLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tierId, setTierId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [customer, setCustomer] = useState('');
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState(null);
  const [foundTierName, setFoundTierName] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshData = useCallback(() => setRefreshKey((current) => current + 1), []);

  const setF = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const cities = mergeSort(
    [...new Set((allEvents.length ? allEvents : results).map((summary) => summary.city))],
    compareText,
  );

  useEffect(() => {
    if (!session) return undefined;
    const controller = new AbortController();
    requestJson('/api/auth/me', { signal: controller.signal })
      .then(({ user: currentUser }) => {
        if (currentUser.id !== session.user.id || currentUser.role !== session.user.role) {
          setSession(saveSession({ ...session, user: currentUser }));
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        if (error.code === 'UNAUTHENTICATED') {
          clearSession();
          setSession(null);
        }
      });
    return () => controller.abort();
  }, [session?.token]);

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/events', { signal: controller.signal })
      .then(({ events: summaries }) => setAllEvents(summaries))
      .catch((error) => {
        if (error.name !== 'AbortError') setEventError(`${error.code ?? 'ERROR'}: ${error.message}`);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setSearchLoading(true);
    const timer = setTimeout(() => {
      requestJson(searchPath(filters), { signal: controller.signal })
        .then(({ events: summaries }) => {
          setResults(summaries);
          setSearchError('');
          setSearchLoading(false);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setSearchError(`${error.code ?? 'ERROR'}: ${error.message}`);
            setSearchLoading(false);
          }
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    if (selectedId || results.length === 0) return;
    const initial = results.find((summary) => summary.title === 'Lagos Night of Tech') ?? results[0];
    setSelectedId(initial.id);
  }, [results, selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    setEventLoading(true);
    const waitlistRequest = session
      ? requestJson(`/api/events/${encodeURIComponent(selectedId)}/waitlists`, { signal: controller.signal })
      : Promise.resolve({ waitlists: [] });
    Promise.all([
      requestJson(`/api/events/${encodeURIComponent(selectedId)}`, { signal: controller.signal }),
      waitlistRequest,
    ])
      .then(([eventResponse, waitlistResponse]) => {
        setEvent(eventResponse.event);
        setWaitlists(Object.fromEntries(
          waitlistResponse.waitlists.map((waitlist) => [waitlist.tierId, waitlist.entries]),
        ));
        setEventError('');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setEventError(`${error.code ?? 'ERROR'}: ${error.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, session?.token, refreshKey]);

  useEffect(() => {
    const reference = lookup.trim();
    if (!reference) {
      setFound(null);
      setLookupError('');
      return undefined;
    }
    if (!session) {
      setFound(null);
      setLookupError('Sign in to view your tickets.');
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestJson(`/api/bookings/${encodeURIComponent(reference)}`, { signal: controller.signal })
        .then(({ booking }) => {
          setFound(booking);
          setLookupError('');
        })
        .catch((error) => {
          if (error.name === 'AbortError') return;
          setFound(null);
          setLookupError(error.status === 404 ? '' : `${error.code ?? 'ERROR'}: ${error.message}`);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [lookup, session?.token, refreshKey]);

  useEffect(() => {
    if (!found) {
      setFoundTierName('');
      return undefined;
    }
    if (event?.id === found.eventId) {
      setFoundTierName(event.tiers.find((item) => item.id === found.tierId)?.name ?? 'Ticket');
      return undefined;
    }
    const controller = new AbortController();
    requestJson(`/api/events/${encodeURIComponent(found.eventId)}`, { signal: controller.signal })
      .then(({ event: bookingEvent }) => {
        setFoundTierName(bookingEvent.tiers.find((item) => item.id === found.tierId)?.name ?? 'Ticket');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setFoundTierName('Ticket');
      });
    return () => controller.abort();
  }, [event, found]);

  const say = (kind, text) => {
    const id = logId.current++;
    setLog((current) => [{ id, kind, text }, ...current].slice(0, 6));
  };

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      const message = await action();
      if (message) say('ok', message);
    } catch (error) {
      say('error', `${error.code ?? 'ERROR'}: ${error.message}`);
    } finally {
      setBusy(false);
      setRefreshKey((current) => current + 1);
    }
  }

  async function submitAuth(e) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const path = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = {
        email: authEmail,
        password: authPassword,
        ...(authMode === 'signup' ? { role: authRole } : {}),
      };
      const result = await requestJson(path, { method: 'POST', body });
      setSession(saveSession(result));
      setAuthPassword('');
      setPage('browse');
    } catch (error) {
      setAuthError(`${error.code ?? 'ERROR'}: ${error.message}`);
    } finally {
      setAuthBusy(false);
    }
  }

  function signOut() {
    clearSession();
    setSession(null);
    setPage('browse');
    setFound(null);
    setLookup('');
    setWaitlists({});
  }

  const activeEvent = event?.id === selectedId ? event : null;
  const tier = activeEvent?.tiers.find((item) => item.id === tierId) ?? activeEvent?.tiers[0];
  const maxQuantity = tier ? Math.min(MAX_TICKETS_PER_BOOKING, tier.seatsLeft || MAX_TICKETS_PER_BOOKING) : 1;
  useEffect(() => setQuantity((current) => Math.min(current, maxQuantity)), [maxQuantity]);
  const currentWaitlist = tier ? (waitlists[tier.id] ?? []) : [];
  const lineExists = currentWaitlist.length > 0 || (tier?.waitlistSize ?? 0) > 0;
  const waitingCount = Math.max(currentWaitlist.length, tier?.waitlistSize ?? 0);
  const needsWaitlist = Boolean(tier && (quantity > tier.seatsLeft || lineExists));
  const seatsLeftTotal = activeEvent?.tiers.reduce((sum, item) => sum + item.seatsLeft, 0) ?? 0;
  const soldTotal = activeEvent?.tiers.reduce((sum, item) => sum + item.sold, 0) ?? 0;
  const waitingTotal = activeEvent?.tiers.reduce(
    (sum, item) => sum + Math.max(waitlists[item.id]?.length ?? 0, item.waitlistSize ?? 0),
    0,
  ) ?? 0;

  const submit = (e) => {
    e.preventDefault();
    if (!activeEvent || !tier) return;
    if (!user) {
      setAuthError('Sign in as an attendee to book or join a waitlist.');
      return;
    }
    if (user.role !== 'attendee') {
      setAuthError('Only attendee accounts can book tickets.');
      return;
    }
    run(async () => {
      if (needsWaitlist) {
        const result = await requestJson(
          `/api/events/${encodeURIComponent(activeEvent.id)}/tiers/${encodeURIComponent(tier.id)}/waitlist`,
          { method: 'POST', body: { quantity, customer } },
        );
        return `${customer.trim()} is number ${result.position} on the ${tier.name} waitlist`;
      }
      const { booking } = await requestJson('/api/bookings', {
        method: 'POST',
        body: { eventId: activeEvent.id, tierId: tier.id, quantity, customer },
      });
      setLookup(booking.reference);
      return `Booked ${booking.quantity} × ${tier.name} for ${booking.customer}`;
    });
  };

  const cancel = () => run(async () => {
    const { booking } = await requestJson(
      `/api/bookings/${encodeURIComponent(found.reference)}/cancel`,
      { method: 'POST' },
    );
    const nextInLine = found.eventId === activeEvent?.id && found.tierId === tier?.id
      ? currentWaitlist[0]?.customer
      : null;
    return `Cancelled ${booking.reference}.${nextInLine ? ` Next in line: ${nextInLine}.` : ''}`;
  });

  const leave = (targetTier, entry) => run(async () => {
    await requestJson(
      `/api/events/${encodeURIComponent(activeEvent.id)}/tiers/${encodeURIComponent(targetTier.id)}/waitlist/${encodeURIComponent(entry.id)}`,
      { method: 'DELETE' },
    );
    return `${entry.customer} left the ${targetTier.name} waitlist`;
  });

  const bookNext = (targetTier) => run(async () => {
    const { booking } = await requestJson(
      `/api/events/${encodeURIComponent(activeEvent.id)}/tiers/${encodeURIComponent(targetTier.id)}/waitlist/next/book`,
      { method: 'POST' },
    );
    setLookup(booking.reference);
    return `Booked ${booking.quantity} × ${targetTier.name} for ${booking.customer} from the waitlist`;
  });

  const payBooking = (reference, mockResult = 'success') => run(async () => {
    const { booking } = await requestJson(
      `/api/bookings/${encodeURIComponent(reference)}/pay`,
      { method: 'POST', body: { mockResult } },
    );
    return `Payment complete for ${booking.reference}`;
  });

  const cancelBooking = (reference) => run(async () => {
    const { booking } = await requestJson(
      `/api/bookings/${encodeURIComponent(reference)}/cancel`,
      { method: 'POST' },
    );
    return `Cancelled ${booking.reference}`;
  });

  if (page === 'tickets' && user?.role === 'attendee') {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-10">
        <AccountBar user={user} page={page} onPage={setPage} onSignOut={signOut} />
        <TicketsPage onCancel={cancelBooking} onPay={payBooking} onExpire={refreshData} />
        <Activity log={log} />
      </main>
    );
  }

  if (page === 'organizer' && user?.role === 'organizer') {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-10">
        <AccountBar user={user} page={page} onPage={setPage} onSignOut={signOut} />
        <OrganizerDashboard onRun={run} refreshKey={refreshKey} />
        <Activity log={log} />
      </main>
    );
  }

  if (!activeEvent) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        <AccountBar user={user} page={page} onPage={setPage} onSignOut={signOut} />
        <AuthPanel
          user={user} mode={authMode} setMode={setAuthMode} email={authEmail} setEmail={setAuthEmail}
          password={authPassword} setPassword={setAuthPassword} role={authRole} setRole={setAuthRole}
          error={authError} busy={authBusy} onSubmit={submitAuth}
        />
        <h1 className="text-3xl font-extrabold">Event Ticketing</h1>
        <p role={eventError ? 'alert' : 'status'} className="rounded-xl bg-white p-5">
          {eventError || searchError || (searchLoading || eventLoading
            ? 'Loading events from the API…'
            : 'No published events yet. Run npm run seed to load sample events.')}
        </p>
        <Activity log={log} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
      <AccountBar user={user} page={page} onPage={setPage} onSignOut={signOut} />
      <AuthPanel
        user={user} mode={authMode} setMode={setAuthMode} email={authEmail} setEmail={setAuthEmail}
        password={authPassword} setPassword={setAuthPassword} role={authRole} setRole={setAuthRole}
        error={authError} busy={authBusy} onSubmit={submitAuth}
      />
      {authError && user && <p role="alert" className="rounded-xl bg-coral/10 p-4 text-coral">{authError}</p>}
      <Browse
        filters={filters} setF={setF} cities={cities} results={results} error={searchError}
        selectedId={activeEvent.id}
        onOpen={(id) => { setSelectedId(id); setTierId(null); setQuantity(1); }}
      />

      {eventError && <p role="alert" className="rounded-xl bg-coral/10 p-4 text-coral">{eventError}</p>}
      <Hero event={activeEvent} seatsLeft={seatsLeftTotal} sold={soldTotal} waiting={waitingTotal} />

      {/* Two columns on large screens (tickets | forms); one stacked column on phones */}
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        {/* LEFT: the ticket tiers, then the waitlists */}
        <div className="space-y-8">
          <section aria-label="Ticket tiers" className="space-y-5">
            {activeEvent.tiers.map((t, i) => (
              <TierTicket key={t.id} tier={t} premium={i > 0} />
            ))}
          </section>
          <Waitlists tiers={activeEvent.tiers} queues={waitlists} onBook={bookNext} onLeave={leave} busy={busy} />
        </div>

        {/* RIGHT: booking form, found ticket, activity. On big screens this column sticks while you scroll. */}
        <div className="space-y-6 lg:sticky lg:top-6">
          <form onSubmit={submit} className="space-y-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-2xl font-extrabold tracking-tight">Get tickets</h2>
            {user?.role !== 'attendee' && (
              <p role={user ? 'alert' : 'status'} className="rounded-xl bg-page p-3 text-sm">
                {user ? 'Sign in with an attendee account to book tickets.' : 'Sign in as an attendee to book tickets or join a waitlist.'}
              </p>
            )}

            {/* Tier picker: big radio-style buttons instead of a dropdown */}
            <div role="radiogroup" aria-label="Ticket type" className="grid grid-cols-2 gap-3">
              {activeEvent.tiers.map((t) => {
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
                  disabled={quantity >= Math.min(MAX_TICKETS_PER_BOOKING, tier.seatsLeft || MAX_TICKETS_PER_BOOKING)}
                  onClick={() => setQuantity(quantity + 1)}>+</button>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Name on the booking</span>
              <input className={field} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Ada Obi" autoComplete="name" />
            </label>

            {/* Live summary: the total (integer kobo maths), or why the button now says "Join waitlist" */}
            <div className={`rounded-xl px-4 py-3 text-sm ${needsWaitlist ? 'bg-gold/25' : 'bg-page'}`}>
              {activeEvent.started ? (
                <p><strong>This event has started.</strong> Booking and the waitlist are closed.</p>
              ) : needsWaitlist ? (
                <p>
                  <strong>
                    {lineExists && quantity <= tier.seatsLeft
                      ? `${waitingCount} already waiting.`
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

            <button className={btnPrimary} disabled={activeEvent.started || busy || (tier.seatsLeft === 0 && !needsWaitlist)}>
              {busy ? 'Please wait…' : needsWaitlist ? 'Join waitlist' : 'Book tickets'}
            </button>
          </form>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-2xl font-extrabold tracking-tight">Find a booking</h2>
            <input className={`${field} font-mono uppercase tracking-widest`} aria-label="Reference code" value={lookup}
              onChange={(e) => setLookup(e.target.value)} placeholder="7K2M-9Q4X" />
            {found ? (
              <Pass
                booking={found}
                tierName={foundTierName || 'Ticket'}
                onCancel={() => cancel(found.reference)}
                onPay={(mockResult) => payBooking(found.reference, mockResult)}
                onExpire={refreshData}
                busy={busy}
              />
            ) : (
              <p role={lookupError ? 'alert' : undefined} className="text-sm text-ink/55">
                {lookupError || (lookup.trim() ? 'No booking with that code.' : 'Type or paste a reference code to see the ticket.')}
              </p>
            )}
          </section>

          <Activity log={log} />
        </div>
      </div>
    </main>
  );
}

// ---------- pieces ----------

function AccountBar({ user, page, onPage, onSignOut }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-ink/5">
      <h1 className="text-xl font-extrabold">Event Ticketing</h1>
      <nav aria-label="Account" className="flex flex-wrap items-center gap-2">
        <button className={btnQuiet} aria-current={page === 'browse' ? 'page' : undefined} onClick={() => onPage('browse')}>Browse events</button>
        {user?.role === 'attendee' && (
          <button className={btnQuiet} aria-current={page === 'tickets' ? 'page' : undefined} onClick={() => onPage('tickets')}>My tickets</button>
        )}
        {user?.role === 'organizer' && (
          <button className={btnQuiet} aria-current={page === 'organizer' ? 'page' : undefined} onClick={() => onPage('organizer')}>Organizer dashboard</button>
        )}
        {user ? (
          <>
            <span className="px-2 text-sm text-ink/65">{user.email}</span>
            <button className={btnQuiet} onClick={onSignOut}>Sign out</button>
          </>
        ) : <span className="text-sm text-ink/65">Browsing as a visitor</span>}
      </nav>
    </header>
  );
}

function AuthPanel({ user, mode, setMode, email, setEmail, password, setPassword, role, setRole, error, busy, onSubmit }) {
  if (user) return null;
  return (
    <section aria-label="Sign in or create an account" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold">{mode === 'signup' ? 'Create an account' : 'Sign in'}</h2>
        <button className={btnQuiet} type="button" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
          {mode === 'signup' ? 'I already have an account' : 'Create an account'}
        </button>
      </div>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Email</span>
          <input className={field} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Password (at least 8 characters)</span>
          <input className={field} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === 'signup' && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Account type</span>
            <select className={field} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="attendee">Attendee</option>
              <option value="organizer">Organizer</option>
            </select>
          </label>
        )}
        <div className="flex items-end">
          <button className={btnPrimary} disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      <p className="mt-3 text-xs text-ink/55">Staff accounts are provisioned by an administrator. Passwords are never stored in the browser or returned by the API.</p>
    </section>
  );
}

function TicketsPage({ onCancel, onPay, onExpire }) {
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    requestJson('/api/bookings', { signal: controller.signal })
      .then(async ({ bookings }) => {
        const detailed = await Promise.all(bookings.map(async (booking) => {
          const { event } = await requestJson(`/api/events/${encodeURIComponent(booking.eventId)}`, { signal: controller.signal });
          return {
            ...booking,
            eventTitle: event.title,
            tierName: event.tiers.find((tier) => tier.id === booking.tierId)?.name ?? 'Ticket',
          };
        }));
        setTickets(detailed);
        setError('');
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(`${cause.code ?? 'ERROR'}: ${cause.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-3xl font-extrabold">My tickets</h2>
      {loading && <p role="status">Loading your tickets…</p>}
      {error && <p role="alert" className="rounded-xl bg-coral/10 p-4 text-coral">{error}</p>}
      {!loading && !error && tickets.length === 0 && <p className="rounded-xl bg-white p-5">You do not have any bookings yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {tickets.map((ticket) => (
          <article key={ticket.reference} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <h3 className="font-bold">{ticket.eventTitle}</h3>
            <Pass booking={ticket} tierName={ticket.tierName} onCancel={() => onCancel(ticket.reference)}
              onPay={(result) => onPay(ticket.reference, result)} onExpire={onExpire} />
          </article>
        ))}
      </div>
    </section>
  );
}

function OrganizerDashboard({ onRun, refreshKey }) {
  const [events, setEvents] = useState([]);
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');
  const [venue, setVenue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [tierName, setTierName] = useState('General');
  const [priceNaira, setPriceNaira] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/organizer/events', { signal: controller.signal })
      .then(({ events: owned }) => { setEvents(owned); setError(''); })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(`${cause.code ?? 'ERROR'}: ${cause.message}`);
      });
    return () => controller.abort();
  }, [refreshKey]);

  async function createEvent(e) {
    e.preventDefault();
    setError('');
    const price = /^\d+(?:\.\d{1,2})?$/.test(priceNaira) ? Number(priceNaira) : NaN;
    const capacityValue = /^\d+$/.test(capacity) ? Number(capacity) : NaN;
    if (!Number.isFinite(price) || !Number.isSafeInteger(capacityValue) || capacityValue < 1) {
      setError('Enter a non-negative price with at most two decimal places and a whole-number capacity.');
      return;
    }
    await onRun(async () => {
      const { event } = await requestJson('/api/events', {
        method: 'POST',
        body: { title, city, venue, startsAt: new Date(startsAt).toISOString() },
      });
      await requestJson(`/api/events/${encodeURIComponent(event.id)}/tiers`, {
        method: 'POST',
        body: { name: tierName, priceCents: Math.round(price * 100), capacity: capacityValue },
      });
      await requestJson(`/api/events/${encodeURIComponent(event.id)}/publish`, { method: 'POST' });
      return `Published ${event.title}`;
    }).catch((cause) => setError(`${cause.code ?? 'ERROR'}: ${cause.message}`));
  }

  async function togglePublish(event) {
    await onRun(async () => {
      await requestJson(`/api/events/${encodeURIComponent(event.id)}/${event.status === 'published' ? 'unpublish' : 'publish'}`, {
        method: 'POST',
      });
      return event.status === 'published' ? `Unpublished ${event.title}` : `Published ${event.title}`;
    }).catch((cause) => setError(`${cause.code ?? 'ERROR'}: ${cause.message}`));
  }

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-extrabold">Organizer dashboard</h2>
      <form onSubmit={createEvent} className="grid gap-4 rounded-3xl bg-white p-6 shadow-sm sm:grid-cols-2">
        <h3 className="text-xl font-bold sm:col-span-2">Create and publish an event</h3>
        <label><span className="mb-1 block text-sm font-semibold">Event title</span><input className={field} required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">City</span><input className={field} required value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">Venue</span><input className={field} required value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">Date and time</span><input className={field} type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">Ticket tier</span><input className={field} required value={tierName} onChange={(e) => setTierName(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">Price (₦)</span><input className={field} inputMode="decimal" required value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} /></label>
        <label><span className="mb-1 block text-sm font-semibold">Capacity</span><input className={field} inputMode="numeric" required value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        <div className="sm:col-span-2"><button className={btnPrimary}>Create event and publish</button></div>
      </form>
      {error && <p role="alert" className="rounded-xl bg-coral/10 p-4 text-coral">{error}</p>}
      <section aria-label="Your events" className="space-y-3">
        <h3 className="text-xl font-bold">Your events</h3>
        {events.length === 0 ? <p className="rounded-xl bg-white p-4">You have not created any events yet.</p> : events.map((event) => (
          <article key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <div><h4 className="font-bold">{event.title}</h4><p className="text-sm text-ink/60">{event.city} · {event.status} · {event.tiers.length} ticket tier(s)</p></div>
            <button className={btnQuiet} onClick={() => togglePublish(event)}>{event.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          </article>
        ))}
      </section>
    </section>
  );
}

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
function Waitlists({ tiers, queues, onBook, onLeave, busy }) {
  const any = tiers.some((tier) => (queues[tier.id] ?? []).length > 0);
  return (
    <section aria-label="Waitlists" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <h2 className="text-2xl font-extrabold tracking-tight">Waitlist</h2>
      {!any && <p className="mt-2 text-sm text-ink/55">Nobody is waiting. When a tier sells out, anyone who asks for more seats than remain can join here, and the line is strictly first come, first served.</p>}
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {tiers.filter((tier) => (queues[tier.id] ?? []).length > 0).map((t) => (
          <div key={t.id}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-ink/60">{t.name}</h3>
            <ol className="space-y-2">
              {(queues[t.id] ?? []).map((w, i) => (
                <li key={w.id} className={`flex animate-rise items-center gap-3 rounded-2xl p-2.5 ${i === 0 ? 'bg-gold/25 ring-1 ring-gold' : 'bg-page'}`}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">{initials(w.customer)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.customer}{w.isMine ? ' (you)' : ''}</span>
                    <span className="num block text-xs text-ink/60">{i === 0 ? 'Next in line' : `Position ${i + 1}`} · {w.quantity} ticket{w.quantity > 1 ? 's' : ''}</span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {i === 0 && w.isMine && (
                      <button className={btnQuiet} disabled={busy || w.quantity > t.seatsLeft} onClick={() => onBook(t)}>
                        Book them
                      </button>
                    )}
                    {w.isMine && (
                      <button className={btnQuiet} disabled={busy} aria-label={`${w.customer} leaves the waitlist`} onClick={() => onLeave(t, w)}>
                        Leave
                      </button>
                    )}
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

// How each booking state is written on screen. (The state itself, like 'checked_in', is data; this is just wording.)
const STATUS_LABEL = { pending: 'Pending', paid: 'Paid', cancelled: 'Cancelled', refunded: 'Refunded', checked_in: 'Checked in' };

// A booking shown as a ticket: name, details, big reference code, barcode and a cancel button.
function Pass({ booking, tierName, onCancel, onPay, onExpire, busy = false }) {
  // A booking that was cancelled or refunded no longer holds seats: show it faded, with a stamp.
  const cancelled = booking.status === BookingState.CANCELLED || booking.status === BookingState.REFUNDED;
  const [secondsLeft, setSecondsLeft] = useState(null);
  const expirationHandled = useRef(false);
  useEffect(() => {
    if (booking.status !== BookingState.PENDING || !booking.expiresAt) {
      setSecondsLeft(null);
      return undefined;
    }
    expirationHandled.current = false;
    const update = () => {
      const remaining = Math.max(0, Date.parse(booking.expiresAt) - Date.now());
      setSecondsLeft(Math.ceil(remaining / 1000));
      if (remaining === 0 && !expirationHandled.current) {
        expirationHandled.current = true;
        onExpire?.();
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [booking.expiresAt, booking.status, onExpire]);
  const countdown = secondsLeft === null ? '' : [
    Math.floor(secondsLeft / 3600),
    Math.floor((secondsLeft % 3600) / 60),
    secondsLeft % 60,
  ].map((part) => String(part).padStart(2, '0')).join(':');
  return (
    <div className="relative animate-rise overflow-hidden rounded-2xl bg-page">
      <div className={`flex items-center justify-between px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white ${cancelled ? 'bg-ink/60' : 'bg-cobalt'}`}>
        <span>{tierName} ticket</span>
        <span>{STATUS_LABEL[booking.status] ?? booking.status}</span>
      </div>
      <div className={`p-5 ${cancelled ? 'opacity-50' : ''}`}>
        <p className="text-2xl font-extrabold">{booking.customer}</p>
        <p className="num text-sm text-ink/70">{booking.quantity} × {tierName} · {formatMoney(booking.totalCents)}</p>
        {booking.eventTitle && <p className="text-sm text-ink/70">{booking.eventTitle}</p>}
        {/* The reference code, big and spaced out so it is easy to read aloud */}
        <p className="mt-4 font-mono text-3xl font-bold tracking-[0.18em]">{booking.reference}</p>
        <div aria-hidden className="barcode mt-3 h-10 opacity-80" />
      </div>
      {/* Diagonal CANCELLED stamp, shown only for cancelled bookings */}
      {cancelled && (
        <p aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded-lg border-4 border-coral px-4 py-1 text-3xl font-extrabold uppercase tracking-widest text-coral">{STATUS_LABEL[booking.status]}</span>
        </p>
      )}
      <div className="border-t-2 border-dashed border-ink/15 px-5 py-3">
        {booking.status === BookingState.PENDING && booking.expiresAt && (
          <p role="status" className="mb-3 text-sm font-semibold">
            {secondsLeft === 0 ? 'Checkout expired' : `Checkout hold expires in ${countdown}`}
          </p>
        )}
        {booking.status === BookingState.PENDING && onPay && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={busy || secondsLeft === 0} onClick={() => onPay('success')}>Pay with mock card</button>
            <button className={btnQuiet} disabled={busy || secondsLeft === 0} onClick={() => onPay('declined')}>Simulate declined card</button>
          </div>
        )}
        {/* Asks the state machine whether cancelling is allowed from this state (not for cancelled, refunded or checked-in bookings) */}
        <button className={btnQuiet} disabled={!canTransition(booking.status, BookingState.CANCELLED) || busy} onClick={onCancel}>Cancel booking</button>
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
