import { Service, signal } from '@angular/core';

/**
 * How the WebGL field is laid out, to find what makes it stutter: as designed (`normal`), alone
 * on the stage with every other part of the battle screen hidden (`canvas`), or alone and
 * filling the whole stage (`full`).
 */
export type GlFieldLayout = 'normal' | 'canvas' | 'full';

/**
 * EXPERIMENT (feat/webgl-probe): which battle field to draw. WebGL by default; watching a battle
 * (replays, live), R switches to the DOM field and back and L steps through the WebGL field's layouts.
 */
@Service()
export class GlExperiment {
  readonly glField = signal(true);
  readonly layout = signal<GlFieldLayout>('normal');
}
