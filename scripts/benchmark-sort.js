// benchmark-sort.js: run with `npm run benchmark:sort`.
// Compares our merge sort, O(n log n), with a simple insertion sort, O(n squared).
// The clue is in the "x previous" columns: what happens to the time when the list DOUBLES?

import { performance } from 'node:perf_hooks';
import { mergeSort, compareNumbers } from '../src/domain/sorting.js';

// A simple, stable O(n squared) sort: take each item and slide it left until it fits.
// For a list twice as long there are about FOUR times as many slides.
function insertionSort(items, compare) {
  const out = items.slice();
  for (let i = 1; i < out.length; i++) {
    const item = out[i];
    let j = i - 1;
    while (j >= 0 && compare(out[j], item) > 0) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = item;
  }
  return out;
}

// The same "random" numbers every run (a tiny seeded generator), so runs are comparable.
function randomList(n) {
  let seed = 99;
  return Array.from({ length: n }, () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % 1_000_000;
  });
}

// Warm up first (so JavaScript's just-in-time compiler has optimised the code), then take the BEST of
// several runs, in milliseconds: the best run has the least noise from garbage collection and other programs.
function time(sorter, list, rounds = 9) {
  for (let w = 0; w < 3; w++) sorter(list, compareNumbers);
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    sorter(list, compareNumbers);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

// ---- Part 1: both sorts, doubling the list each row ----
const sizes = [2_000, 4_000, 8_000, 16_000, 32_000];
console.log('Part 1: sorting random numbers. Each row DOUBLES the list.\n');
console.log('        n   merge sort   x previous   insertion sort   x previous');

let prevMerge = null;
let prevInsertion = null;
for (const n of sizes) {
  const list = randomList(n);
  const merge = time(mergeSort, list);
  const insertion = time(insertionSort, list, 3);
  console.log(
    String(n).padStart(9),
    `${merge.toFixed(2)} ms`.padStart(12),
    (prevMerge ? `${(merge / prevMerge).toFixed(1)}x` : '-').padStart(12),
    `${insertion.toFixed(1)} ms`.padStart(16),
    (prevInsertion ? `${(insertion / prevInsertion).toFixed(1)}x` : '-').padStart(12),
  );
  prevMerge = merge;
  prevInsertion = insertion;
}

// ---- Part 2: merge sort alone, on bigger lists where the timings are steadier ----
// If the time really is n x log2(n), then (time / (n x log2 n)) should stay roughly the SAME in every row.
console.log('\nPart 2: merge sort on bigger lists. If the work is n x log2(n), the last column stays roughly flat.\n');
console.log('        n   merge sort   x previous   ns per (n x log2 n)');
let prev = null;
for (const n of [50_000, 100_000, 200_000, 400_000, 800_000]) {
  const ms = time(mergeSort, randomList(n), 5);
  const perUnit = (ms * 1e6) / (n * Math.log2(n)); // nanoseconds per "n log n" unit of work
  console.log(
    String(n).padStart(9),
    `${ms.toFixed(1)} ms`.padStart(12),
    (prev ? `${(ms / prev).toFixed(1)}x` : '-').padStart(12),
    perUnit.toFixed(1).padStart(21),
  );
  prev = ms;
}

console.log(`
Reading it:
  insertion sort  each doubling costs about 4x: the work grows with n x n, O(n squared).
  merge sort      each doubling costs a little over 2x, and the cost per "n x log2 n" stays about the same:
                  O(n log n). (Small lists are noisy, so trust Part 2 more than the first rows of Part 1.)
Why: merge sort halves the list log2(n) times and merges n items at every level, so n x log n work in total.
Insertion sort compares each item with, on average, half of all the items before it, so n x n work.`);
