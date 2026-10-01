import { Service, computed, inject } from '@angular/core';
import { AppSettings, ThemeId } from '@core/settings/app-settings';
import { Rgba, rgba } from '../gl-renderer';

/** The retro palette's roles (styles.css's --retro-* variables, which the DOM pages still use). */
export type PaletteRole = 'bg' | 'bar' | 'panel' | 'outline' | 'rim' | 'select' | 'button' | 'input' | 'ink' | 'muted' | 'accent' | 'accentHover' | 'accentText' | 'danger' | 'teal';

export type Palette = Readonly<Record<PaletteRole, Rgba>>;

/**
 * Each theme's palette, as styles.css defines it for the DOM (keep both in step until the DOM pages
 * are gone). Each was checked for WCAG AA there: ink and muted on panel/select, white on accent,
 * accentText/danger/teal on panel and bar.
 */
const THEME_HEX: Record<ThemeId, Record<PaletteRole, string>> = {
  zafiro: {
    bg: '#0a1620', bar: '#050e16', panel: '#102332', outline: '#3f88ad', rim: '#1b3a50', select: '#1a4562', button: '#153246', input: '#071118',
    ink: '#e3f2fa', muted: '#9ec3d5', accent: '#0b76a0', accentHover: '#085f82', accentText: '#6fd3ff', danger: '#ff8a80', teal: '#ffc46b',
  },
  noche: {
    bg: '#121821', bar: '#0b1016', panel: '#1c2632', outline: '#5b7690', rim: '#2b3a4a', select: '#2c4157', button: '#26374a', input: '#0f151c',
    ink: '#e8eef3', muted: '#a9b8c6', accent: '#c94e39', accentHover: '#a83e2c', accentText: '#ff9a85', danger: '#ff8a80', teal: '#7fd1b9',
  },
  ciruela: {
    bg: '#16111e', bar: '#0d0913', panel: '#221a2e', outline: '#8467b0', rim: '#352946', select: '#3c2d55', button: '#2d2240', input: '#110c17',
    ink: '#f1ebf8', muted: '#bcb0cf', accent: '#b8336a', accentHover: '#982955', accentText: '#ff8cc0', danger: '#ff8a80', teal: '#f3c56b',
  },
  esmeralda: {
    bg: '#0e1915', bar: '#08110d', panel: '#15261e', outline: '#4f8f6d', rim: '#22392d', select: '#23432f', button: '#1d3427', input: '#0a130f',
    ink: '#e5f3ea', muted: '#a5c4b2', accent: '#b8432b', accentHover: '#963522', accentText: '#ff9f80', danger: '#ff8a80', teal: '#f0d36b',
  },
  pokeball: {
    bg: '#151313', bar: '#0c0b0b', panel: '#221e1e', outline: '#7a6f6f', rim: '#342e2e', select: '#403434', button: '#2d2727', input: '#0f0e0e',
    ink: '#f3efef', muted: '#c0b6b6', accent: '#c62a2a', accentHover: '#a32121', accentText: '#ff8f85', danger: '#ffa24d', teal: '#ffd35c',
  },
  ocaso: {
    bg: '#12122a', bar: '#0a0a1b', panel: '#1c1c3c', outline: '#6f6fc0', rim: '#2b2b55', select: '#30305f', button: '#24244a', input: '#0c0c1f',
    ink: '#eceaff', muted: '#b4b2de', accent: '#c0400f', accentHover: '#9e340c', accentText: '#ffa577', danger: '#ff8a9a', teal: '#7de3cf',
  },
};

const PALETTES = Object.fromEntries(
  Object.entries(THEME_HEX).map(([id, hexes]) => [id, Object.fromEntries(Object.entries(hexes).map(([role, hex]) => [role, rgba(hex)])) as Palette]),
) as Record<ThemeId, Palette>;

/** The palette of the theme chosen in Settings, for everything drawn on the canvas. */
@Service()
export class GlTheme {
  private readonly settings = inject(AppSettings);

  readonly palette = computed(() => PALETTES[this.settings.settings().theme] ?? PALETTES.zafiro);
}
