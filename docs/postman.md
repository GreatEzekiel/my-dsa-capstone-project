# Testing the server with Postman

Postman is a program for sending requests to a server and checking the answers. This project ships a ready-made
**collection** (22 requests, each with automatic checks) and an **environment** (the server address).

Files: `postman/event-ticketing.postman_collection.json` and `postman/local.postman_environment.json`.

## 1. Start the server

```bash
npm install     # once
npm start       # listens on http://localhost:3000
```

Leave that terminal open. It prints one line for every request it receives, with a **request id** at the end.
(Port 3000 busy? `PORT=3001 npm start`, then change `baseUrl` in step 3.)

## 2. Import the files into Postman

1. Click **Import** (top left), and drop in **both** files from the `postman/` folder.
2. In the top-right drop-down, choose the environment **Event Ticketing: local**.

## 3. Check the address

Click the environment's name, then the eye icon. `baseUrl` must be `http://localhost:3000` (or your own port).

## 4. Run everything at once

Right-click the collection, choose **Run collection**, then **Run**. You should see **all tests green** (about 109 checks).

## 5. What each request proves

| # | Request | Expect | What it shows |
|---|---------|--------|---------------|
| 1 | `GET /health` | `200`, body exactly `{"status":"ok"}` | The server is alive (the main "Done when") |
| 1 | `HEAD /health` | `200`, no body, `Content-Length: 15` | HEAD is GET without the body |
| 2 | `GET /api/nothing-here` | `404`, `NOT_FOUND`, JSON | Unknown API path |
| 2 | `POST /health` | `405`, `Allow: GET, HEAD` | Path exists, method does not |
| 2 | `POST /api/events` with `{ "title": ` | `400`, `BAD_JSON` | Broken JSON |
| 2 | `POST /api/events` as `text/plain` | `415` | The body must be sent as JSON |
| 3 | `GET /`, `/styles.css`, `/app.js`, `/favicon.svg` | `200` with the right `Content-Type` | Static files from `public/` |
| 4 | 8 "climbing" requests (`..%2f`, `%2e%2e`, a backslash, a null byte, `.env`...) | `400` or `404`, never `200` | Nothing outside `public/` is ever served |

**Every response** is also checked: it has an `X-Request-Id` header, and every error has **exactly** `{ "error": { "code", "message" } }` with **no stack trace**.

## 6. Running the same collection without the Postman app (optional)

```bash
npx newman run postman/event-ticketing.postman_collection.json -e postman/local.postman_environment.json
```
This is how the collection was checked while it was written: 22 requests, 109 assertions, 0 failures.

## 7. When something is red

| You see | Probably | Fix |
|---------|----------|-----|
| `Error: connect ECONNREFUSED 127.0.0.1:3000` | The server is not running | `npm start` |
| Everything `404` | `baseUrl` points at another program | Check the environment, and the port in the terminal |
| `POST` requests get `415` | Postman sent no `Content-Type` | Body tab, choose **raw**, then **JSON** |
