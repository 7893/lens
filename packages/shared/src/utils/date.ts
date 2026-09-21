/**
 * Formats a date/timestamp/ISO string into YYYYMM (e.g. "202009").
 * Fallback to current UTC date if invalid or undefined.
 */
export function formatYearMonth(dateInput?: string | number | Date | null): string {
  if (!dateInput) {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const d = typeof dateInput === 'number' || typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
