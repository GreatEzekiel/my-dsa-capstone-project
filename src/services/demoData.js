// Sample events for `npm run start:demo`, so the API has published events to search and book.

function dayAt(days) {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000);
  date.setUTCHours(17, 0, 0, 0);
  return date.toISOString();
}

export async function seedDemoData(events) {
  const make = async (title, city, venue, days, tiers, publish = true) => {
    const event = await events.create({ title, city, venue, startsAt: dayAt(days) });
    for (const [name, priceCents, capacity] of tiers) {
      await events.addTier(event.id, { name, priceCents, capacity });
    }
    if (publish) await events.publish(event.id);
    return event;
  };
  return [
    await make('Lagos Night of Tech', 'Lagos', 'Landmark Centre, Victoria Island', 30, [['Regular', 500_000, 6], ['VIP', 2_000_000, 2]]),
    await make('Abuja Jazz Night', 'Abuja', 'Jabi Lake Park', 12, [['Standard', 800_000, 40], ['Front row', 2_500_000, 4]]),
    await make('Lagos Food Festival', 'Lagos', 'Tafawa Balewa Square', 45, [['Entry', 200_000, 200], ['Family pack', 600_000, 30]]),
    await make('Port Harcourt Comedy Live', 'Port Harcourt', 'Hotel Presidential', 20, [['Silver', 1_000_000, 5], ['Gold', 1_500_000, 3]]),
    await make('Ibadan Book Fair', 'Ibadan', 'Cultural Centre, Mokola', 60, [['Entry', 100_000, 100]], false),
  ];
}
