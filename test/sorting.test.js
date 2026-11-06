// sorting.test.js: the hand-written merge sort.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeSort, compareNumbers, compareText } from '../src/domain/sorting.js';
import { code, deepFreeze } from './helpers.js';

// A tiny seeded random generator: the "random" data is the same on every run, so failures can be repeated.
function seeded(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s % n;
  };
}

test('sorts numbers smallest first, and largest first with a reversed comparator', () => {
  assert.deepEqual(mergeSort([5, 2, 9, 1, 5, 6], compareNumbers), [1, 2, 5, 5, 6, 9]);
  assert.deepEqual(mergeSort([5, 2, 9, 1], (a, b) => compareNumbers(b, a)), [9, 5, 2, 1]);
});

test('empty list, one item, two items', () => {
  assert.deepEqual(mergeSort([], compareNumbers), []);
  assert.deepEqual(mergeSort([7], compareNumbers), [7]);
  assert.deepEqual(mergeSort([2, 1], compareNumbers), [1, 2]);
});

test('already sorted, reversed, and all-equal inputs', () => {
  assert.deepEqual(mergeSort([1, 2, 3, 4, 5], compareNumbers), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeSort([5, 4, 3, 2, 1], compareNumbers), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeSort([3, 3, 3], compareNumbers), [3, 3, 3]);
});

test('it is STABLE: items that compare equal keep their original order', () => {
  // Sort only by `group`. Within each group the `n` values must stay in the order they started.
  const items = [
    { group: 'b', n: 1 }, { group: 'a', n: 2 }, { group: 'b', n: 3 },
    { group: 'a', n: 4 }, { group: 'c', n: 5 }, { group: 'a', n: 6 }, { group: 'b', n: 7 },
  ];
  const sorted = mergeSort(items, (x, y) => compareText(x.group, y.group));
  assert.deepEqual(sorted.map((i) => `${i.group}${i.n}`), ['a2', 'a4', 'a6', 'b1', 'b3', 'b7', 'c5']);
});

test('it returns a NEW array and never modifies the one it was given', () => {
  const input = deepFreeze([3, 1, 2]); // frozen: any write would throw
  const output = mergeSort(input, compareNumbers);
  assert.notEqual(output, input);
  assert.deepEqual(input, [3, 1, 2]); // untouched
  // Even the trivial cases give back a different array object.
  const empty = [];
  const one = [1];
  assert.notEqual(mergeSort(empty, compareNumbers), empty);
  assert.notEqual(mergeSort(one, compareNumbers), one);
});

test('it matches the built-in sort on thousands of random lists (used here ONLY as a checking oracle)', () => {
  const rand = seeded(2026);
  for (let round = 0; round < 300; round++) {
    // Few distinct keys, so there are MANY ties and stability really gets tested.
    const items = Array.from({ length: rand(60) }, (_, i) => ({ key: rand(6), original: i }));
    const mine = mergeSort(items, (a, b) => compareNumbers(a.key, b.key));
    const expected = [...items].sort((a, b) => a.key - b.key); // the built-in sort is stable in Node 22
    assert.deepEqual(mine, expected);
  }
});

test('it can sort a large list, in order', () => {
  const rand = seeded(7);
  const big = Array.from({ length: 50_000 }, () => rand(1_000_000));
  const sorted = mergeSort(big, compareNumbers);
  assert.equal(sorted.length, big.length);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1] <= sorted[i]);
});

test('it does NOT use the built-in sort: calling it would throw', () => {
  const original = Array.prototype.sort;
  const originalToSorted = Array.prototype.toSorted;
  Array.prototype.sort = () => { throw new Error('the built-in sort was called'); };
  Array.prototype.toSorted = () => { throw new Error('the built-in toSorted was called'); };
  try {
    assert.deepEqual(mergeSort([3, 1, 2], compareNumbers), [1, 2, 3]);
  } finally {
    Array.prototype.sort = original; // always put it back, or every later test would break
    Array.prototype.toSorted = originalToSorted;
  }
});

test('the source files for sorting and search never mention the built-in sort calls', () => {
  for (const file of ['sorting.js', 'eventSearch.js']) {
    const source = readFileSync(new URL(`../src/domain/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.(sort|toSorted)\s*\(/, `${file} must not call the built-in sort`);
  }
});

test('bad arguments are VALIDATION errors', () => {
  assert.equal(code(() => mergeSort('abc', compareNumbers)), 'VALIDATION');
  assert.equal(code(() => mergeSort(null, compareNumbers)), 'VALIDATION');
  assert.equal(code(() => mergeSort([1, 2], undefined)), 'VALIDATION');
  assert.equal(code(() => mergeSort([1, 2], 'nope')), 'VALIDATION');
  // A comparator that does not return a number would scramble the order silently, so it is refused.
  assert.equal(code(() => mergeSort([1, 2, 3], () => undefined)), 'VALIDATION');
  assert.equal(code(() => mergeSort([1, 2, 3], () => NaN)), 'VALIDATION');
  assert.equal(code(() => mergeSort([1, 2, 3], () => 'a')), 'VALIDATION');
});

test('compareText ignores case and puts "Event 2" before "Event 10"', () => {
  assert.deepEqual(mergeSort(['event 10', 'Event 2', 'Alpha'], compareText), ['Alpha', 'Event 2', 'event 10']);
});
