# Testing the API with Postman

Postman sends requests to a server and checks the answers. This project ships a ready-made **collection** (84 requests, about 345 automatic
checks, mostly **POST** and **GET**) and an **environment** (the server address).

Files: `postman/event-ticketing.postman_collection.json` and `postman/local.postman_environment.json`.
Every endpoint is described in [api.md](api.md).

## 1. Start the server **in demo mode**

```bash
npm install          # once
npm run start:demo   # http://localhost:3000, with sample events and the practice-only route
```

Leave that terminal open. It prints one line per request, ending with a **request id**.
(`npm start` also works, but folder 5 needs demo mode. Port 3000 busy? `PORT=3001 npm run start:demo`, then change `baseUrl`.)

## 2. Import into Postman

1. **Import** (top left): drop in **both** files from `postman/`.
2. Top-right drop-down: choose **Event Ticketing: local**. (Its `baseUrl` must be `http://localhost:3000`.)

## 3. Run it

Right-click the collection, **Run collection**, **Run**. Everything should be green.
**Run it from top to bottom:** requests pass ids to each other through *collection variables*
(request 2.1 saves `eventId`, 2.4 saves `tierId`, 4.1 saves `reference`...). You can also press **Send** on one request at a time, **in order**,
and read the **Test Results** tab.
You can run the whole collection as often as you like: each run makes its **own** uniquely tagged events (the tag is in the title, for example `Postman Jazz PMM2X9K`).

## 4. The folders

| Folder | Requests | What it shows |
|--------|:--------:|---------------|
| **1. Health** | 4 | `GET /health`, `HEAD`, a query string, a trailing slash |
| **2. Events** (POST + GET) | 8 | create a **draft** (`POST`), read it (`GET`), see it is **not** on the public list, add 2 tiers (`POST`), publish (`POST`), see it **is** on the list (`GET`) |
| **3. Search** (GET) | 17 | a second event; search by text, city, price, dates; **three sorts that give three different orders**; four bad inputs that give `400` |
| **4. Bookings** (POST + GET) | 17 | book 2 of 3 seats, read the booking (also in lower case), `SOLD_OUT`, bad quantities, a client trying to set its own price, cancel, cancel twice, seats come back, a draft can't be booked |
| **5. Booking life cycle** (demo mode) | 14 | `pending → paid → checked_in`; **paying a cancelled booking is refused (`409 INVALID_TRANSITION`)**; a refund gives the seat back |
| **6. Errors** | 12 | every error has exactly `{ error: { code, message } }`, with no stack trace |
| **7. Static files** | 4 | `/`, `/styles.css`, `/app.js`, `/favicon.svg` |
| **8. Security** | 8 | attempts to climb out of `public/` are never served |

**Every response** is checked by the collection-level tests: an `X-Request-Id` header, and for errors the exact shape and no stack trace.

## 5. Where to look inside Postman

- **The request** (left): method, URL, and the **Body** tab (choose **raw** and **JSON**).
- **Pre-request Script** tab: code that runs *before* sending. Request 2.1 uses it to make a fresh tag and a date 30 days away.
- **Tests** tab: code that runs *after* the answer. `pm.test('name', () => ...)` is one check; `pm.collectionVariables.set('eventId', ...)` saves a value for the next request.
- **Variables**: click the collection, **Variables** tab, to watch `eventId`, `tierId`, `reference` change as you go.
- **Console** (bottom left, or View, Show Postman Console) shows the exact request that was sent.

## 6. Things to try by hand

- **Follow one request through the log.** Send any request, copy the `X-Request-Id` response header, and find it in the terminal where the server runs.
- **Make it sell out.** Run 4.1 (books 2 of 3 seats), then send 4.5 several times: `409 SOLD_OUT`, and the seat count never moves.
- **Try to cheat.** Look at 4.10: it sends `"status": "paid"` and `"totalCents": 1` with the booking. Both are ignored.
- **Pay a cancelled booking** (5.6 then 5.7): the state machine says no, and 5.8 proves nothing changed.
- **Search your own way.** Open 3.4 and change the Params: `city`, `maxPriceCents=800000`, `sort=availability`, `onlyAvailable=true`. Add a typo (`citty`) and read the `400`.
- **Break the JSON.** In 2.1 delete the last `}`: `400 BAD_JSON`. Change the Content-Type header to `text/plain`: `415`.
- **Use the demo data.** After `npm run start:demo`, send `GET {{baseUrl}}/api/events`: 4 published events (the 5th, *Ibadan Book Fair*, is a draft and stays hidden).

## 7. Running the same collection without the Postman app (optional)

[Newman](https://github.com/postmanlabs/newman) is Postman's command-line runner. It is not a dependency of this project:

```bash
npm run start:demo                      # in one terminal
npx newman run postman/event-ticketing.postman_collection.json -e postman/local.postman_environment.json   # in another
```

This is how the collection was checked while it was written. Results: **84 requests, 345 assertions, 0 failures**, on **four runs in a row against the same server** (so it is re-runnable),
and 0 errors in the server log. Against a normal `npm start` server, folders 1 to 4 and 6 to 8 pass, and folder 5 fails on purpose (404: the practice route is not there),
which is how I checked that the collection can fail.

## 8. When something is red

| You see | Probably | Fix |
|---------|----------|-----|
| `Error: connect ECONNREFUSED 127.0.0.1:3000` | The server is not running | `npm run start:demo` |
| Folder 5 is all `404` | The server was started without demo mode | Stop it, then `npm run start:demo` |
| A request in folders 2 to 5 fails with `404` or `400` and the URL contains `{{eventId}}` | You ran it before the request that saves that id | Run the folder from request 1 (or the whole collection) |
| Failures after you **restarted** the server in the middle of a run | The data lives in memory and was lost | Run the whole collection again from the top |
| `POST` requests get `415` | Postman sent no `Content-Type` | Body tab: **raw**, then **JSON** |
| Only the "Climb" requests fail | Your Postman tidied the URL differently | Read the status and the server log line: it must be `400` or `404` |

## 9. Adding your own requests

When the next stories add routes, add requests here and keep the habit: one `pm.test` for the status, one for the body, a `pm.collectionVariables.set` for any id you need
later, and let the collection-level tests check the error shape. A good new request is one that **should fail** (a bad quantity, a missing field): errors are where bugs hide.
