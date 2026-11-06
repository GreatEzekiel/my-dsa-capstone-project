// waitlistQueue.js
// A first-in-first-out (FIFO) queue built by hand as a linked list.
//
// Why not an array? array.shift() removes the first item but must slide every
// other item one place left: O(n). A linked list just moves a pointer: O(1).
//
//   head -> [A] -> [B] -> [C] <- tail
//   dequeue removes A (from the head), enqueue adds D after C (at the tail).

// One link in the chain: a value, and a pointer to the next link.
class QueueNode {
  constructor(value) {
    this.value = value;
    this.next = null; // nothing after it yet
  }
}

export class Queue {
  // The `#` makes these fields truly private: code outside the class cannot touch
  // them, so nobody can break the chain by editing head or tail by hand.
  #head = null; // front of the line: the next to leave
  #tail = null; // back of the line: where new people join
  #size = 0; // kept as a number so `size` never has to count the list

  // `get` lets you write queue.size (no brackets). O(1).
  get size() {
    return this.#size;
  }

  // Add to the back. O(1): we already hold the tail, so no walking the list.
  enqueue(value) {
    const node = new QueueNode(value);
    if (this.#tail) this.#tail.next = node; // chain it after the current last node
    else this.#head = node; // queue was empty: the new node is also the head
    this.#tail = node;
    this.#size += 1;
    return this.#size; // the new person's position in line (1 = first)
  }

  // Remove from the front and return it. O(1).
  dequeue() {
    if (!this.#head) return undefined; // empty queue: nothing to return
    const node = this.#head;
    this.#head = node.next; // the second node becomes the front
    if (!this.#head) this.#tail = null; // we removed the last one: reset the tail too
    this.#size -= 1;
    return node.value;
  }

  // Look at the front without removing it. O(1).
  peek() {
    return this.#head?.value; // `?.` returns undefined instead of crashing when empty
  }

  // Removes the FIRST item for which predicate(item) is true, from anywhere in the line, and returns it
  // (or undefined if none matches). Used when someone leaves the waitlist.
  // O(n): we must walk the chain to find them. Everyone behind them simply moves up one place,
  // because we only re-point one `next` link.
  remove(predicate) {
    let prev = null; // the node just before `n`, so we can stitch the chain back together
    for (let n = this.#head; n; prev = n, n = n.next) {
      if (!predicate(n.value)) continue;
      if (prev) prev.next = n.next; // middle or end: skip over n
      else this.#head = n.next; // n was the front: the next one becomes the front
      if (n === this.#tail) this.#tail = prev; // n was the back: the one before it becomes the back
      this.#size -= 1;
      return n.value;
    }
    return undefined;
  }

  // Makes `[...queue]` and `for (const x of queue)` work.
  // This walks the whole list, so it is O(n): use it for display only.
  *[Symbol.iterator]() {
    for (let n = this.#head; n; n = n.next) yield n.value;
  }
}
