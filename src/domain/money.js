// money.js
// Money rule: always a whole number of the smallest unit (kobo; "cents" in the brief).
// Decimals are unsafe because 0.1 + 0.2 === 0.30000000000000004 in JavaScript.
// 500000 kobo is exactly ₦5,000.00, with no rounding surprises.

// True only for whole, safe, non-negative numbers: 0, 500000 pass; 9.99, -5, "100", NaN fail.
export const isMoney = (n) => Number.isSafeInteger(n) && n >= 0;

// DISPLAY ONLY. Divides by 100 (which creates a decimal) just to print "₦5,000.00".
// Never use the result in a calculation; calculate with the integers.
export const formatMoney = (cents) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(cents / 100);
