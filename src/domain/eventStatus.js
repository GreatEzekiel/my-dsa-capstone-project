// eventStatus.js
// The two states of an event, written once. Lower-case words, like the booking states.
//
//   draft      private: only the organizer's tools can see it; nobody can book it
//   published  public: it shows up in searches and can be booked
//
// publishEvent moves draft -> published; unpublishEvent moves it back.

export const EventStatus = Object.freeze({ DRAFT: 'draft', PUBLISHED: 'published' });
