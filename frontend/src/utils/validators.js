// Shared input validators for the "add a person" forms (volunteers, guides,
// public registration, signature). Keeping them here means every screen checks
// a phone number / Israeli ID the exact same way.

// Strip everything that isn't a digit (spaces, dashes, parentheses, +).
function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}


// An Israeli phone number is valid when it's 9–10 digits starting with 0
// (landline: 0X + 7 digits = 9; mobile: 05X + 7 digits = 10). An international
// "+972..." prefix is accepted by first normalizing it back to a leading 0.
export function isValidIsraeliPhone(value) {
  let digits = digitsOnly(value);

  // Normalize a +972 / 972 country code to the local leading-zero form.
  if (digits.startsWith('972')) {
    digits = `0${digits.slice(3)}`;
  }

  return /^0\d{8,9}$/.test(digits);
}


// An Israeli ID number (תעודת זהות) is valid when, padded to 9 digits, it
// passes the official check-digit test: each digit is multiplied by an
// alternating 1/2 weight, any product over 9 has 9 subtracted, and the total
// must be divisible by 10.
export function isValidIsraeliId(value) {
  const digits = digitsOnly(value);

  // Must be 1–9 digits (real IDs are up to 9; we pad shorter ones).
  if (digits.length === 0 || digits.length > 9) {
    return false;
  }

  const padded = digits.padStart(9, '0');

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    let digit = Number(padded[index]);

    // Every second digit (odd index) is doubled.
    if (index % 2 === 1) {
      digit *= 2;

      // A two-digit product is folded back by subtracting 9.
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return sum % 10 === 0;
}
