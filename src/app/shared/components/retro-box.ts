import { Component, computed, input } from '@angular/core';

/**
 * A Gen 3 style menu box: an outline around a rim and the panel inside (colours from the retro
 * palette in styles.css), where the content goes
 * (positioned from the inside's top-left corner). Fixed pixel sizes, as everything on the stage (see
 * styles.css): the box itself never resizes with its content.
 */
@Component({
  selector: 'app-retro-box',
  host: { class: 'block' },
  template: `
    <div class="block rounded-[14px] bg-retro-outline p-[3px]" [style.width.px]="width()" [style.height.px]="height()">
      <div
        class="relative block rounded-[11px] border-[3px] border-retro-rim bg-retro-panel text-retro-ink"
        [style.width.px]="innerWidth()"
        [style.height.px]="innerHeight()"
      >
        <ng-content />
      </div>
    </div>
  `,
})
export class RetroBox {
  /** Outer size in px, outline included. */
  readonly width = input.required<number>();
  readonly height = input.required<number>();

  // The inside is the box less the outline's 3px on each side (the rim sits within it).
  protected readonly innerWidth = computed(() => this.width() - 6);
  protected readonly innerHeight = computed(() => this.height() - 6);
}
