// Money is integer paise everywhere. Typed rupees are parsed as text, never
// through floating point, so ₹19.99 is exactly 1999 paise.

const maxPaise = 1_000_000_000_000;

/** Paise for typed rupees such as "1,250.50", or null if it is not a valid amount. */
export function parseRupees(text: string): number | null {
  const cleaned = text.trim().replace(/[₹,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise <= maxPaise ? paise : null;
}

/** Rupees for an input box: 125050 becomes "1250.50". */
export function paiseToInput(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0')}`;
}

const grouped = new Intl.NumberFormat('en-IN');

/** Indian grouping, with paise only when there are any: ₹1,24,600 or ₹19.99. */
export function formatRupees(paise: number): string {
  const absolute = Math.abs(paise);
  const rest = absolute % 100;
  const text = grouped.format(Math.trunc(absolute / 100));
  return `${paise < 0 ? '-' : ''}₹${text}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** Today's calendar date in India as YYYY-MM-DD, matching the API's "today". */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "14 Jan 2026" for a YYYY-MM-DD date, without shifting it across time zones. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
