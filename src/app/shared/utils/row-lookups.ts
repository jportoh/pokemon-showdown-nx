import { signal } from '@angular/core';

export type RowLookup<T> = T | 'loading' | 'failed';

/**
 * Something looked up for each row shown (a download per row), a few at a time so the console keeps
 * up. Rows moved out of sight before their turn are dropped from the queue; results are kept by key.
 */
export class RowLookups<T> {
  private readonly resultsSignal = signal<ReadonlyMap<string, RowLookup<T>>>(new Map());
  /** Rows waiting for their turn, the first first. */
  private queue: string[] = [];
  private running = 0;
  private stopped = false;

  /** Each key's result, 'loading' while queued or on its way. */
  readonly results = this.resultsSignal.asReadonly();

  /** @param changed called after each result (to render: Brewser needs asking). */
  constructor(
    private readonly lookUp: (key: string) => Promise<T>,
    private readonly atOnce: number,
    private readonly changed: () => void,
  ) {}

  /** The rows shown now: those not looked up yet are queued, in this order. */
  show(keys: readonly string[]): void {
    const results = new Map(this.resultsSignal());
    for (const key of this.queue) if (!keys.includes(key)) results.delete(key);
    this.queue = keys.filter((key) => !results.has(key) || this.queue.includes(key));
    for (const key of this.queue) results.set(key, 'loading');
    this.resultsSignal.set(results);
    this.next();
  }

  /** Forgets the failed lookups, so they're tried again the next time their rows show. */
  retryFailed(): void {
    this.resultsSignal.update((results) => new Map([...results].filter(([, result]) => result !== 'failed')));
  }

  /** No more lookups (the page is gone). */
  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  private next(): void {
    while (this.running < this.atOnce && this.queue.length > 0) {
      const key = this.queue.shift()!;
      this.running++;
      this.lookUp(key).then(
        (result) => this.settle(key, result),
        () => this.settle(key, 'failed'),
      );
    }
  }

  private settle(key: string, result: RowLookup<T>): void {
    this.running--;
    if (this.stopped) return;
    this.resultsSignal.update((results) => new Map(results).set(key, result));
    this.changed();
    this.next();
  }
}
