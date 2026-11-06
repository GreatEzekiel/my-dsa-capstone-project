// ids.js
// Identifiers and booking reference codes.
// We use the Web Crypto API (globalThis.crypto) instead of Math.random():
// Math.random() is predictable, so someone could guess other people's codes.
// globalThis.crypto is a secure random source, and it exists in both Node 22 and
// browsers, so the React UI can import this same file.

// A long unique id (UUID v4) for events, tiers, bookings and waitlist entries.
export const newId = () => globalThis.crypto.randomUUID();

// Crockford base32: digits plus letters, with I, L, O and U left out so a code
// read aloud on the phone can't be confused (I vs 1, O vs 0).
// It has exactly 32 symbols, which matters below.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Makes a code like "7K2M-9Q4X": 8 characters, split in two halves for easy reading.
export function newReference() {
  // Ask the OS for 8 random bytes (each 0 to 255).
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const b of bytes) {
    // `b & 31` keeps the lowest 5 bits, giving a number 0 to 31.
    // Because the alphabet has exactly 32 symbols, every symbol is equally likely
    // (no "modulo bias" that % 30 or % 36 would cause).
    code += ALPHABET[b & 31];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Turns anything a person types into the key we store the booking under:
// "7k2m 9q4x", "7K2M-9Q4X" and "7k2m9q4x" all become "7K2M9Q4X".
// This is why the lookup forgives case, spaces and hyphens.
// It also applies the Crockford reading rule: O is read as 0, and I or L as 1.
// That is safe because our codes NEVER contain O, I or L, so a person who
// misreads "0" as "O" over the phone still finds their booking.
export const referenceKey = (ref) =>
  String(ref)
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
