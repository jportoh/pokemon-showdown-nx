import { TextStyle } from '@core/gl/gl-textures';
import { STAGE_W } from '@core/gl/gl-stage';

/** Where a screen draws the logo (the Poké Ball and POKÉMON SHOWDOWN!), so the title's logo can fly there. */
export interface LogoPlace {
  ballX: number;
  ballY: number;
  ballScale: number;
  /** POKÉMON's left edge; SHOWDOWN! follows it after `gap`. */
  textX: number;
  textCy: number;
  gap: number;
  style: TextStyle;
}

/** The home menu's logo, top left. */
export const HOME_LOGO: LogoPlace = { ballX: 40, ballY: 24, ballScale: 2, textX: 100, textCy: 48, gap: 8, style: { size: 26, bold: true } };

const ENTRY_STYLE: TextStyle = { size: 32, bold: true };

/** The entry screen's logo, centred over its box (it depends on the words' widths). */
export function entryLogo(measure: (value: string, style: TextStyle) => number): LogoPlace {
  const first = measure('POKÉMON', ENTRY_STYLE);
  const second = measure('SHOWDOWN!', ENTRY_STYLE);
  const left = (STAGE_W - (48 + 14 + first + 12 + second)) / 2;
  return { ballX: left, ballY: 34, ballScale: 2, textX: left + 62, textCy: 58, gap: 12, style: ENTRY_STYLE };
}
