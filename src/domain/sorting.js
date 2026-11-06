// sorting.js
// A merge sort written from scratch.
//
// Rules from the brief:
//   1. We do NOT use the built-in array sort (nor toSorted). The point is to learn the algorithm.
//   2. It is STABLE: items that compare as equal keep the order they had.
//   3. It returns a NEW array and never modifies the one it was given.
//
// Big O:
//   time  O(n log n)  the list is halved log2(n) times, and each level of halving merges n items once
//   space O(n)        the merged results need room for n items
//   Always n log n, even for already-sorted or reversed input (unlike quicksort's bad cases).

import { DomainError, ErrorCode } from './errors.js';

const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });

/**
 * mergeSort(items, compare) -> a new, sorted array.
 *
 * compare(a, b) must return:  a negative number if a goes first,
 *                             a positive number if b goes first,
 *                             0 if they are equal (the original order is then kept).
 */
export function mergeSort(items, compare) {
  if (!Array.isArray(items)) throw bad('items', 'must be an array');
  if (typeof compare !== 'function') throw bad('compare', 'must be a function');
  return sortPart(items, compare);
}

// The recursive part. "Divide and conquer": split in half, sort each half, merge the halves.
function sortPart(items, compare) {
  // Base case: 0 or 1 items are already sorted. slice() still gives a NEW array,
  // so even a one-item result is never the caller's own array.
  if (items.length < 2) return items.slice();

  const middle = Math.floor(items.length / 2);
  // slice(start, end) COPIES that part, so the original array is never touched.
  const left = sortPart(items.slice(0, middle), compare);
  const right = sortPart(items.slice(middle), compare);
  return merge(left, right, compare);
}

// Merge two ALREADY SORTED arrays into one sorted array. O(left + right): each item is looked at once.
function merge(left, right, compare) {
  const merged = new Array(left.length + right.length);
  let l = 0; // next unused item in `left`
  let r = 0; // next unused item in `right`
  let m = 0; // next free slot in `merged`

  while (l < left.length && r < right.length) {
    const order = compare(left[l], right[r]);
    // A comparator that returns NaN, undefined, or a non-number would silently scramble the order.
    if (typeof order !== 'number' || Number.isNaN(order)) throw bad('compare', 'must return a number');

    // THIS LINE MAKES THE SORT STABLE: on a tie (order === 0) we take from the LEFT half.
    // The left half held the items that were earlier in the original list, so equal items
    // keep their original order. Using "< 0" here instead of "<= 0" would reverse ties.
    if (order <= 0) merged[m++] = left[l++];
    else merged[m++] = right[r++];
  }

  // One side ran out; whatever is left on the other side is already sorted, so copy it over.
  while (l < left.length) merged[m++] = left[l++];
  while (r < right.length) merged[m++] = right[r++];
  return merged;
}

// ---------- ready-made comparators (used by eventSearch.js, and handy in tests) ----------

// Numbers, smallest first. Written out in full because `a - b` breaks for Infinity and NaN.
export const compareNumbers = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Text for people: case-insensitive, and "Event 2" sorts before "Event 10" (numeric: true).
// A Collator is the built-in tool for comparing strings in a language-aware way.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const compareText = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));

// Plain code-unit comparison, for ids: fast, and the same on every machine.
export const compareIds = (a, b) => {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
};
