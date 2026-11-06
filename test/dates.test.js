// dates.test.js: the strict ISO date parser that S02 (valid dates) and S05 (date filters) rely on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, isDateOnly } from '../src/domain/dates.js';
import { code } from './helpers.js';

test('a time with an offset is exact: 17:00 at +01:00 is 16:00 UTC', () => {
  assert.equal(parseWhen('2026-12-05T17:00:00+01:00'), Date.UTC(2026, 11, 5, 16, 0, 0));
  assert.equal(parseWhen('2026-12-05T17:00:00Z'), Date.UTC(2026, 11, 5, 17, 0, 0));
  assert.equal(parseWhen('2026-12-05T17:00:00-05:30'), Date.UTC(2026, 11, 5, 22, 30, 0));
});

test('a time with NO zone means Lagos time, on every computer', () => {
  assert.equal(parseWhen('2026-12-05T17:00:00'), Date.UTC(2026, 11, 5, 16, 0, 0));
  assert.equal(parseWhen('2026-12-05T17:00'), Date.UTC(2026, 11, 5, 16, 0, 0));
});

test('a date-only value is the start of that day, or the end of it with endOfDay', () => {
  assert.equal(isDateOnly('2026-12-05'), true);
  assert.equal(isDateOnly('2026-12-05T10:00:00Z'), false);
  assert.equal(parseWhen('2026-12-05'), Date.UTC(2026, 11, 4, 23, 0, 0)); // midnight Lagos = 23:00 UTC the day before
  assert.equal(parseWhen('2026-12-05', 'to', { endOfDay: true }), Date.UTC(2026, 11, 5, 22, 59, 59, 999));
});

test('milliseconds: ".5" means 500 ms', () => {
  assert.equal(parseWhen('2026-12-05T17:00:00.5Z') - parseWhen('2026-12-05T17:00:00Z'), 500);
});

test('dates that do not exist are rejected (30 February would silently roll over to March)', () => {
  assert.equal(code(() => parseWhen('2026-02-30')), 'VALIDATION');
  assert.equal(code(() => parseWhen('2027-02-29')), 'VALIDATION'); // 2027 is not a leap year
  assert.doesNotThrow(() => parseWhen('2028-02-29')); // 2028 is
  assert.equal(code(() => parseWhen('2026-04-31')), 'VALIDATION'); // April has 30 days
});

test('impossible times, zones and shapes are rejected', () => {
  for (const bad of [
    '2026-13-01', '2026-00-10', '2026-12-05T24:00:00Z', '2026-12-05T10:60:00Z', '2026-12-05T10:00:60Z',
    '2026-12-05T10:00:00+24:00', '2026-12-05 17:00', 'Dec 5 2026', '5/12/2026', '0099-01-01', '', '   ', 'tomorrow',
  ]) {
    assert.equal(code(() => parseWhen(bad)), 'VALIDATION', `should reject ${JSON.stringify(bad)}`);
  }
  for (const notText of [undefined, null, 20261205, new Date(), {}]) {
    assert.equal(code(() => parseWhen(notText)), 'VALIDATION');
  }
});
