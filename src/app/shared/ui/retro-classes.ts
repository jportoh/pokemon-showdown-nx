/*
 * Class lists for controls in the "retro" style (the home menu, the page frame, the Battle page), on
 * the retro boxes. Only looks: each control adds its own position and size. Colours come from the
 * `retro-*` palette in styles.css. Focus shows with the app's yellow ring (styles.css).
 */

/** The main action: the accent colour with white text. */
export const RETRO_PRIMARY_BUTTON =
  'cursor-pointer rounded-md border-2 border-retro-bar bg-retro-accent font-bold text-white enabled:hover:bg-retro-accent-hover disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400';

/** Other actions: a quieter button with the outline colour. */
export const RETRO_SECONDARY_BUTTON =
  'cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button font-bold text-retro-ink enabled:hover:bg-retro-select disabled:cursor-not-allowed disabled:border-gray-600 disabled:text-gray-400';

/** A text field. */
export const RETRO_INPUT = 'rounded-md border-2 border-retro-outline bg-retro-input p-[0_10px] text-base text-retro-ink placeholder:text-gray-400';

/** The console button bound to a control (ZR, L…), in a pill at the left of a 48px-tall button. */
export const RETRO_SHORTCUT_PILL = 'absolute top-[10px] left-[10px] block h-6 w-9 rounded-sm bg-retro-select text-center text-sm leading-6 font-bold';
