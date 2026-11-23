import { inject } from '@angular/core';
import { Rgba, withAlpha } from '@core/gl/gl-renderer';
import { HOLD_FILL } from '@core/gl/ui/hold-action';
import { menuModal } from '@core/gl/ui/menu-kit';
import { APPEARANCES, AppSettings, VOLUME_STEP } from '@core/settings/app-settings';
import { ROLE_KEYS } from '@core/input/console-keys';
import { BATTLEFIELDS, BattlefieldChoice } from '@shared/data/battlefields';
import { ScreenContext, keyChip, write } from './screen-context';

const BOX = { x: 330, y: 70, w: 620, h: 600 };
const ROW = { x: 350, w: 580, h: 58, step: 64, top: 136 };
/** The value's ◀ ▶ and the volume's bars. */
const BARS = 10;

export type MenuRow = 'music' | 'sound' | 'appearance' | 'field' | 'timer' | 'sheets' | 'card' | 'forfeit';
export const MENU_PREFIX = 'menu-';

/** What the menu shows and does beyond the settings: the battle's timer, team sheets, the rival, forfeiting. */
export interface MenuState {
  /** The battle's timer can be asked for (our live battles): its state. */
  timer: { on: boolean; cooldown: number } | null;
  toggleTimer: () => void;
  /** The open team sheets: offered (A accepts), waiting for the opponent, or here (A shows them). */
  sheets: 'accept' | 'waiting' | 'sheet' | null;
  /** Fills while A is held on the row (accepting can't be taken back). */
  sheetsProgress: number;
  pressSheets: () => void;
  /** The opponent, whose card A opens; '' when there's none (replays). */
  rival: string;
  openCard: () => void;
  /** Our battle can be forfeited: how full its row is while A is held. */
  forfeit: { progress: number; forfeiting: boolean } | null;
  pressForfeit: () => void;
}

/**
 * The battle's menu (+ on the native .nro, L on Brewser), over the battle, which goes on meanwhile:
 * the music and sound effects volumes, light or dark and the battlefield (random or basic) (◀ ▶, as in
 * Settings; the field changes at once), the battle timer, the
 * open team sheets, the opponent's Trainer Card and Forfeit, held down (A) until its row fills red.
 * B (or its button again) closes it.
 */
export class BattleMenuView {
  private readonly settings = inject(AppSettings);

  /** The rows shown now, in order (the battle's own ones only when they apply). */
  rows(state: MenuState): MenuRow[] {
    const rows: MenuRow[] = ['music', 'sound', 'appearance', 'field'];
    if (state.timer) rows.push('timer');
    if (state.sheets) rows.push('sheets');
    if (state.rival) rows.push('card');
    if (state.forfeit) rows.push('forfeit');
    return rows;
  }

  draw(ctx: ScreenContext, state: MenuState): void {
    const p = ctx.palette;
    const rows = this.rows(state);
    const h = ROW.top - BOX.y + rows.length * ROW.step + 64;
    const top = Math.round((720 - h) / 2);
    const dy = top - BOX.y;
    menuModal(ctx, { x: BOX.x, y: top, w: BOX.w, h }, undefined, 0.55);
    keyChip(ctx, ROLE_KEYS.battleMenu.label, BOX.x + 26, top + 38, 34);
    write(ctx, 'MENU', BOX.x + 72, top + 38, { size: 28, bold: true }, p.ink);
    write(ctx, 'The battle goes on meanwhile', BOX.x + BOX.w - 26, top + 40, { size: 15 }, p.muted, 'right', 300);
    rows.forEach((row, i) => this.drawRow(ctx, row, state, ROW.top + dy + i * ROW.step));

    const focused = ctx.focus.focused?.slice(MENU_PREFIX.length) as MenuRow | undefined;
    const keys: [string, string][] =
      focused === 'music' || focused === 'sound' || focused === 'appearance' || focused === 'field'
        ? [['◀▶', 'Change'], ['B', 'Close']]
        : focused === 'forfeit' || (focused === 'sheets' && state.sheets === 'accept')
          ? [['A', 'Hold'], ['B', 'Close']]
          : [['A', 'Select'], ['B', 'Close']];
    let x = BOX.x + 26;
    const y = top + h - 32;
    for (const [key, text] of keys) {
      x += keyChip(ctx, key, x, y, 28) + 8;
      x += write(ctx, text, x, y, { size: 17 }, p.ink) + 22;
    }
  }

  private drawRow(ctx: ScreenContext, row: MenuRow, state: MenuState, y: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const box = { x: ROW.x, y, w: ROW.w, h: ROW.h };
    const settings = this.settings.settings();
    const step = (by: number): boolean => {
      if (row === 'music' || row === 'sound') {
        const key = row === 'music' ? 'musicVolume' : 'soundVolume';
        this.settings.set(key, Math.max(0, Math.min(100, settings[key] + by * VOLUME_STEP)));
        return true;
      }
      if (row === 'appearance') {
        const index = APPEARANCES.findIndex((a) => a.id === settings.appearance);
        this.settings.set('appearance', APPEARANCES[(index + by + APPEARANCES.length) % APPEARANCES.length].id);
        return true;
      }
      if (row === 'field') {
        // Only two here, either way: a field for each battle, or the basic one (Settings has the rest).
        this.settings.set('battlefield', settings.battlefield === 'random' ? 'meadow' : 'random');
        return true;
      }
      return false;
    };
    const accept = (): void => {
      if (row === 'timer') state.toggleTimer();
      else if (row === 'sheets') state.pressSheets();
      else if (row === 'card') state.openCard();
      else if (row === 'forfeit') state.pressForfeit();
      else if (row === 'appearance' || row === 'field') step(1);
    };
    const focused = ctx.focus.control({
      id: `${MENU_PREFIX}${row}`,
      ...box,
      accept,
      move: (direction) => (direction === 'left' || direction === 'right' ? step(direction === 'left' ? -1 : 1) || true : false),
    });
    const danger = row === 'forfeit';
    if (focused) renderer.rect(box.x, box.y, box.w, box.h, { fill: p.select, stroke: danger ? p.danger : p.accentText, radius: 12, border: 3 });
    // A held row fills from the left: red to forfeit, green to accept the team sheets.
    const progress = row === 'forfeit' ? (state.forfeit?.progress ?? 0) : row === 'sheets' ? state.sheetsProgress : 0;
    if (progress > 0) {
      const color: Rgba = row === 'forfeit' ? HOLD_FILL : [0.18, 0.49, 0.2, 1];
      renderer.rect(box.x + 2, box.y + 2, (box.w - 4) * progress, box.h - 4, { fill: withAlpha(color, 0.55), radius: 10 });
    }

    const { title, detail } = this.texts(row, state, settings.appearance, settings.battlefield);
    const cy = box.y + box.h / 2;
    write(ctx, title, box.x + 18, detail ? cy - 10 : cy, { size: 19, bold: true }, danger ? p.danger : p.ink, 'left', 300);
    if (detail) write(ctx, detail, box.x + 18, cy + 13, { size: 13 }, p.muted, 'left', 330);

    const right = box.x + box.w - 18;
    if (row === 'music' || row === 'sound') {
      const volume = row === 'music' ? settings.musicVolume : settings.soundVolume;
      write(ctx, volume ? `${volume}%` : 'Off', right, cy, { size: 17, bold: true }, p.ink, 'right');
      for (let i = 0; i < BARS; i++) {
        const bh = 10 + i * 2;
        renderer.rect(right - 62 - (BARS - i) * 15, cy + 12 - bh, 11, bh, { fill: i < volume / 10 ? p.accent : p.rim, radius: 3 });
      }
    } else if (row === 'appearance') {
      const name = APPEARANCES.find((a) => a.id === settings.appearance)?.name ?? '';
      write(ctx, `◀  ${name}  ▶`, right, cy, { size: 19, bold: true }, p.accentText, 'right');
    } else if (row === 'field') {
      write(ctx, `◀  ${fieldName(settings.battlefield)}  ▶`, right, cy, { size: 19, bold: true }, p.accentText, 'right');
    } else if (row === 'timer' && state.timer) {
      const on = state.timer.on;
      renderer.rect(right - 54, cy - 15, 54, 30, { fill: on ? p.accent : p.rim, radius: 15 });
      renderer.rect(right - (on ? 26 : 50), cy - 11, 22, 22, { fill: [1, 1, 1, 1], radius: 11 });
    } else if (row === 'sheets') {
      const text = state.sheets === 'accept' ? 'Accept' : state.sheets === 'waiting' ? 'Accepted' : 'Show ▶';
      const w = ctx.text.measure(text, { size: 15, bold: true }) + 24;
      const alert = state.sheets === 'accept';
      renderer.rect(right - w, cy - 14, w, 28, { fill: alert ? p.teal : p.rim, radius: 14 });
      write(ctx, text, right - w / 2, cy, { size: 15, bold: true }, alert ? p.contrast : p.ink, 'center');
    } else if (row === 'card') {
      write(ctx, 'Open ▶', right, cy, { size: 17, bold: true }, p.accentText, 'right');
    }
  }

  private texts(row: MenuRow, state: MenuState, appearance: string, field: BattlefieldChoice): { title: string; detail: string } {
    switch (row) {
      case 'music':
        return { title: 'Music', detail: '' };
      case 'sound':
        return { title: 'Sound effects', detail: 'Moves, cries and buttons' };
      case 'appearance':
        return { title: 'Appearance', detail: appearance === 'light' ? 'Light menus' : 'Dark menus' };
      case 'field':
        return { title: 'Battlefield', detail: field === 'random' ? 'A different place for each battle' : 'The same place every battle' };
      case 'timer': {
        const timer = state.timer;
        const detail = timer?.cooldown ? `The server allows it again in ${timer.cooldown}s` : timer?.on ? 'On: the turns have a time limit' : 'Make your opponent hurry';
        return { title: 'Battle timer', detail };
      }
      case 'sheets':
        return {
          title: 'Open team sheets',
          detail: state.sheets === 'accept' ? `${state.rival || 'The opponent'} offers to share them: hold A` : state.sheets === 'waiting' ? `Waiting for ${state.rival || 'the opponent'}` : 'Their sets, on their team in Info',
        };
      case 'card':
        return { title: `${state.rival}'s card`, detail: 'Their ratings and latest results' };
      case 'forfeit':
        return { title: 'Forfeit', detail: state.forfeit?.forfeiting ? 'Forfeiting…' : 'Hold A to forfeit the battle' };
    }
  }
}

/** The battlefield as the menu shows it: Random, Basic (the meadow), or a field fixed in Settings. */
function fieldName(choice: BattlefieldChoice): string {
  if (choice === 'random') return 'Random';
  if (choice === 'meadow') return 'Basic';
  return BATTLEFIELDS.find((field) => field.id === choice)?.name ?? 'Basic';
}
