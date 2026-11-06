// demoData.js
// Sample events for `npm run start:demo`, so that GET /api/events has something to show the moment the server starts.
// (The store lives in memory: it starts empty every time the server starts, and everything is lost when it stops.)

import { addTier, createEvent, publishEvent } from '../domain/inventory.js';

// An ISO date n days from now at 18:00 Lagos time (17:00 UTC). Always in the future, so the events can be booked.
function dayAt(n) {
  const date = new Date(Date.now() + n * 24 * 3600 * 1000);
  date.setUTCHours(17, 0, 0, 0);
  return date.toISOString();
}

export function seedDemoData(store) {
  const make = (title, city, venue, days, tiers, publish = true) => {
    const event = createEvent(store, { title, city, venue, startsAt: dayAt(days) });
    for (const [name, priceCents, capacity] of tiers) addTier(store, event.id, { name, priceCents, capacity });
    if (publish) publishEvent(store, event.id);
    return event;
  };
  return [
    make('Lagos Night of Tech', 'Lagos', 'Landmark Centre, Victoria Island', 30, [['Regular', 500_000, 6], ['VIP', 2_000_000, 2]]),
    make('Abuja Jazz Night', 'Abuja', 'Jabi Lake Park', 12, [['Standard', 800_000, 40], ['Front row', 2_500_000, 4]]),
    make('Lagos Food Festival', 'Lagos', 'Tafawa Balewa Square', 45, [['Entry', 200_000, 200], ['Family pack', 600_000, 30]]),
    make('Port Harcourt Comedy Live', 'Port Harcourt', 'Hotel Presidential', 20, [['Silver', 1_000_000, 5], ['Gold', 1_500_000, 3]]),
    make('Ibadan Book Fair', 'Ibadan', 'Cultural Centre, Mokola', 60, [['Entry', 100_000, 100]], false), // a DRAFT: not in the public list
  ];
}
