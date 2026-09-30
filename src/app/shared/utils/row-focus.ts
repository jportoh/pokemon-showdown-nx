/**
 * After a list page with fixed row slots changes, focus left on a slot that's now empty (hidden and
 * disabled, as on a last page with fewer rows) moves to the last row still shown.
 */
export function keepFocusOnShownRow(host: HTMLElement): void {
  const focused = host.querySelector('[data-kb-focus]');
  if (!(focused instanceof HTMLButtonElement) || !focused.disabled || !focused.closest('li')) return;
  const shown = [...host.querySelectorAll<HTMLButtonElement>('li button')].filter((row) => !row.disabled);
  shown.at(-1)?.focus();
}
