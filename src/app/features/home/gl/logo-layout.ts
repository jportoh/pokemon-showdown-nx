import { TextStyle } from '@core/gl/gl-textures';

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

/** The logo top left, where the entry screen and the menu draw it (and the title's lands). */
export const HOME_LOGO: LogoPlace = { ballX: 40, ballY: 24, ballScale: 2, textX: 100, textCy: 48, gap: 8, style: { size: 26, bold: true } };
