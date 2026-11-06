# Build 3: Architecture, state machine, server skeleton

*Week 6 of the course. Starts from the finished state of Build 2.*

**You deliver:** a layered design (routes, services, rules, data), a booking life cycle written as an explicit state machine, and a web server that answers `/health` and serves static files.

**You practise:** requirements, system architecture, state diagrams, HTTP basics.

**Done when**
- A diagram of your architecture and your booking states is in `docs/`.
- Invalid state changes (for example paying a cancelled booking) are refused by tests.
- The server starts and `/health` responds.

## User stories in this build

No new stories. The booking state machine designed here is what S07, S09 and S10 will be built on, so every state and every allowed move is written down.

## How to check "Done when"

| Done when | Check | Where |
|-----------|-------|-------|
| A diagram of the architecture and the booking states is in `docs/` | open it on GitHub, or in VS Code with a Mermaid extension | [architecture.md](architecture.md): layers, data model, booking life cycle |
| ...and the diagram is true | `test/booking-state-machine.test.js` compares the state diagram with the code; `test/architecture.test.js` compares the import rules | `npm test` |
| Invalid state changes are refused by tests | all 25 moves tested one by one, then again on real bookings, then 4,000 random moves | `test/booking-state-machine.test.js`, `test/booking-lifecycle.test.js` |
| The server starts and `/health` responds | `npm start`, then open http://localhost:3000/health | `src/server.js` |
| ...and a test does it for you | one test starts the real program, calls `/health`, and stops it | `test/server-process.test.js`, `test/http.test.js` |
| Testing with Postman | import the files in `postman/` | [postman.md](postman.md) |

Also: [code-walkthrough.md](code-walkthrough.md) (Part 3 explains this build line by line) and [ai-log.md](ai-log.md).
