/**
 * The battle camera's numbers, in one place to tune them (the mockup's sliders). Sizes are in "x":
 * multiples of Showdown's 96px sprites (3.5x = 336px). Positions are field coordinates (the field is
 * 1280x566 from y 44, above the command bar).
 */
export const CAMERA_TUNING = {
  /** While the turn plays: ours are nearer, so bigger. */
  rest: { own: 3.5, foe: 2.5 },
  /** Choosing a move: the camera comes close to our side; `feetY` is where the chooser's feet land. */
  choosing: { own: 4, foe: 2.25, feetY: 552 },
  /** Choosing a target: the camera backs off onto the opponent's; `feetY` is where the target's feet land. Ours can't get smaller than theirs. */
  target: { own: 3.2, foe: 3, feetY: 328 },
  /** How far the camera turns towards the one choosing or the target (0 none, 0.4 a lot). */
  pan: 0.15,
  /** The camera's moves between phases. */
  durationMs: 350,
  easing: 'inOut' as CameraEasing,
  /** Darkens whoever isn't choosing (the partner; ours while picking a target). */
  dimOthers: true,
  /** How dark they get (0 not at all, 1 black). */
  dimAmount: 0.45,
} as const;

/**
 * The 3D model under the camera: how far each thing is (ours at 1). The further, the less it moves and
 * changes size when the camera does.
 */
export const CAMERA_DEPTHS = {
  own: 1,
  foe: 2,
  /** Where the ground meets the sky. */
  groundEdge: 3.2,
  clouds: 8,
  /** The vanishing point's height on the field. */
  horizonY: 256,
} as const;

export type CameraEasing = 'inOut' | 'out' | 'linear';
