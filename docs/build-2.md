# Build 2: Event search, sorting, backlog, first tests

*Week 5 of the course. Starts from the finished state of Build 1.*

**You deliver:** search and filter events by text, city, date range and price; sort by date, price or availability using a merge sort you write yourself; the backlog written as user stories; your first automated tests.

**You practise:** sorting algorithms, stability, Big O, Agile and Scrum, writing user stories with acceptance criteria.

**Done when**
- Search, filter and sort work and never change the original list.
- Every user story you are building has acceptance criteria.
- `npm test` runs and passes.

The stories and their acceptance criteria are in [user-stories.md](user-stories.md).
A plain-language explanation of every file is in [code-walkthrough.md](code-walkthrough.md).
What was wrong with the first version, and how it was fixed, is in [ai-log.md](ai-log.md).

## How to check "Done when"

| Done when | Check | Where |
|-----------|-------|-------|
| Search, filter and sort work | `npm run demo:search` | `scripts/demo-search.js` |
| ...and never change the original list | the test "the original list is unchanged" (input is frozen, so any write would throw) | `test/s05-search.test.js` |
| Every story has acceptance criteria | read [user-stories.md](user-stories.md): S02, S03, S04, S05, S06, S16 | `docs/user-stories.md` |
| `npm test` runs and passes | `npm test` | `test/` |
| The merge sort is yours, stable, and O(n log n) | `npm run benchmark:sort` and `test/sorting.test.js` | `src/domain/sorting.js` |
