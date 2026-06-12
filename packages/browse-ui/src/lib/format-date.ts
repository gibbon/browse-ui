// Wrappers around Date.prototype.toLocale*String that pass an explicit
// locale list. Bare `toLocaleString()` (or `toLocaleString([])`) falls
// through to V8's host-environment default, which on Windows is the OS
// regional-format setting — not navigator.language. That makes Chrome
// render dates in en-US for users whose browser language is en-AU.
// Passing navigator.languages explicitly skips that fallback.
const locales: Intl.LocalesArgument =
  typeof navigator !== "undefined" && navigator.languages?.length
    ? (navigator.languages as string[])
    : undefined;

type DateInput = string | number | Date;

export function formatDateTime(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString(locales, opts);
}

export function formatTime(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleTimeString(locales, opts);
}

export function formatDate(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(locales, opts);
}
