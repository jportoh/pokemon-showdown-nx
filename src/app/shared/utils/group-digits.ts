/** 14857 → "14,857" (Brewser's toLocaleString isn't to be trusted). */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
