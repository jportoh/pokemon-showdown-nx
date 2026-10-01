import { computed, inject } from '@angular/core';
import { pokemonInfoView } from '@features/battle/components/battle-pokemon-info/battle-pokemon-info';
import { BattleStore } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { rgba } from '@features/gl-home/gl/gl-renderer';
import { toId } from '@shared/utils/to-id';
import { INK, ScreenContext, button, write, writeLines } from './screen-context';

const PANEL_X = 12;
const PANEL_Y = 548;
/** The panel's content, inside its 12px margin. */
const X = PANEL_X + 12;
const Y = PANEL_Y + 12;
const WIDTH = 961;
const GAP = 12;
const BUTTON_W = Math.floor((WIDTH - GAP * 3) / 4);
const SPEEDS = [1, 2, 4];

/** The ids of the panel's buttons, for the screen's first focus and B. */
export const PANEL_IDS = {
  play: 'replay-play',
  leaveLive: 'live-leave',
} as const;

/**
 * The command panel while watching, under the field (985x172 from 12,548): a replay's controls
 * (ReplayControls: play/pause or watch again, next turn, speed, back to the list), or a live battle's
 * (SpectatorControls: who's playing over the way back to the list, and the card of the team member
 * pointed at in the right column, BattlePokemonInfo).
 */
export class WatchPanelView {
  private readonly store = inject(BattleStore);
  private readonly inspection = inject(PokemonInspection);

  private readonly finished = computed(() => !!this.store.result() && !this.store.playing());

  private readonly replayTitle = computed(() => {
    if (this.finished()) return this.store.winner() ? `${this.store.winner()} won` : 'Tie';
    if (this.store.paused()) return 'Paused';
    if (this.store.turn() > 0) return 'Playing';
    return this.store.sides().p1.preview.length > 0 ? 'Team preview' : 'Starting';
  });

  private readonly liveStatus = computed(() => {
    const error = this.store.spectateError();
    if (error) return error;
    const { p1, p2 } = this.store.sides();
    if (!p1.name || !p2.name) return 'Joining the battle…';
    if (this.store.result()) return `${p1.name} vs ${p2.name}: the battle is over.`;
    if (this.store.teamPreview()) return 'Team preview: the players are picking their Pokémon.';
    return `Watching live: ${p1.name} vs ${p2.name}`;
  });

  private readonly info = computed(() => {
    const shown = this.inspection.shown();
    return pokemonInfoView(shown, shown ? this.store.sides()[shown.side].name : '');
  });

  draw(ctx: ScreenContext, actions: { again: () => void; leaveReplay: () => void; leaveLive: () => void }): void {
    ctx.renderer.rect(PANEL_X, PANEL_Y, 985, 172, { fill: INK.panel });
    if (this.store.replay()) this.drawReplay(ctx, actions);
    else this.drawLive(ctx, actions.leaveLive);
  }

  private drawReplay(ctx: ScreenContext, actions: { again: () => void; leaveReplay: () => void }): void {
    write(ctx, this.replayTitle(), X, Y + 14, { size: 16 }, INK.gray200, 'left', WIDTH);
    const at = (i: number) => ({ x: X + i * (BUTTON_W + GAP), y: Y + 36, w: BUTTON_W, h: 44 });
    const finished = this.finished();
    button(ctx, PANEL_IDS.play, at(0), finished ? 'Watch again' : this.store.paused() ? 'Play' : 'Pause', 'primary', () => (finished ? actions.again() : this.store.togglePause()));
    button(ctx, 'replay-next', at(1), 'Next turn', finished ? 'disabled' : 'plain', () => this.store.nextTurn());
    button(ctx, 'replay-speed', at(2), `Speed ${this.store.speed()}x`, 'plain', () => {
      this.store.setSpeed(SPEEDS[(SPEEDS.indexOf(this.store.speed()) + 1) % SPEEDS.length]);
    });
    button(ctx, 'replay-leave', at(3), 'Other replays', 'plain', actions.leaveReplay);
  }

  private drawLive(ctx: ScreenContext, leave: () => void): void {
    writeLines(ctx, this.liveStatus(), X, Y, 300, 24, { size: 16 }, INK.gray200, 3);
    button(ctx, PANEL_IDS.leaveLive, { x: X, y: Y + 104, w: 300, h: 44 }, 'Other live battles', 'plain', leave);
    drawPokemonInfo(ctx, X + 316, Y, this.info());
  }
}

/** A team member's card, as BattlePokemonInfo (645x148): everything known of it. */
export function drawPokemonInfo(ctx: ScreenContext, x: number, y: number, v: ReturnType<typeof pokemonInfoView>): void {
  const { renderer } = ctx;
  renderer.rect(x, y, 645, 148, { fill: INK.dark, stroke: INK.gray500, radius: 6, border: 1 });
  if (!v.shown) {
    write(ctx, 'Point at a Pokémon on the right to see everything known about it here.', x + 322, y + 74, { size: 16 }, INK.gray300, 'center', 600);
    return;
  }
  write(ctx, v.owner.toUpperCase(), x + 12, y + 14, { size: 12, bold: true }, v.side === 'p1' ? INK.sky300 : INK.red300, 'left', 206);
  write(ctx, v.name, x + 12, y + 36, { size: 18, bold: true }, INK.white, 'left', 206);
  write(ctx, v.subtitle, x + 12, y + 60, { size: 14 }, INK.gray300, 'left', 206);
  for (const chip of v.types) {
    renderer.rect(x + chip.left, y + 74, chip.width, 20, { fill: rgba(chip.color), stroke: chip.tera ? INK.white : [0, 0, 0, 0], radius: 2, border: chip.tera ? 1 : 0 });
    write(ctx, chip.text, x + chip.left + chip.width / 2, y + 84, { size: 12, bold: true }, INK.white, 'center', chip.width - 4);
  }
  if (v.hp) {
    renderer.rect(x + 12, y + 104, 120, 8, { fill: INK.gray700, radius: 2 });
    if (v.hp.width > 0) renderer.rect(x + 12, y + 104, v.hp.width, 8, { fill: rgba(v.hp.color), radius: 2 });
    write(ctx, v.hp.text, x + 140, y + 108, { size: 14, bold: true }, INK.white);
  }
  if (v.status) {
    renderer.rect(x + 182, y + 98, 36, 20, { fill: rgba(v.status.color), radius: 2 });
    write(ctx, v.status.text, x + 200, y + 108, { size: 12, bold: true }, INK.white, 'center');
  }
  write(ctx, v.note, x + 12, y + 132, { size: 12 }, INK.gray300, 'left', 206);

  renderer.rect(x + 228, y + 8, 1, 130, { fill: INK.gray600 });
  for (const stat of v.stats) {
    const cy = y + stat.top + 8;
    write(ctx, stat.label.toUpperCase(), x + 238, cy, { size: 11, bold: true }, INK.gray400);
    write(ctx, String(stat.value), x + 298, cy, { size: 14, bold: true }, INK.white, 'right');
    renderer.rect(x + 304, y + stat.top + 4, 96, 8, { fill: INK.gray700, radius: 2 });
    renderer.rect(x + 304, y + stat.top + 4, stat.width, 8, { fill: rgba(stat.color), radius: 2 });
    if (stat.stageText) write(ctx, stat.stageText, x + 430, cy, { size: 12, bold: true }, stat.stage > 0 ? INK.green400 : INK.red300, 'right');
  }
  renderer.rect(x + 438, y + 8, 1, 130, { fill: INK.gray600 });

  const icon = v.itemId ? ctx.images.image(`items/${toId(v.itemId)}.png`) : null;
  if (icon) renderer.rect(x + 446, y + 6, 24, 24, { fill: INK.white, texture: icon });
  write(ctx, v.item, x + (v.itemKnown ? 474 : 448), y + 18, { size: 14, bold: v.itemKnown }, v.itemKnown ? INK.white : INK.gray400, 'left', v.itemKnown ? 160 : 186);
  if (v.abilityKnown) write(ctx, v.ability, x + 448, y + 44, { size: 14, bold: true }, INK.white, 'left', 186);
  else writeLines(ctx, v.ability, x + 448, y + 32, 186, 13, { size: 12 }, INK.gray400, 2);
  for (const move of v.moves) {
    renderer.rect(x + 448, y + move.top, 186, 19, { fill: rgba(move.color), radius: 2 });
    write(ctx, move.name, x + 456, y + move.top + 9.5, { size: 14, bold: move.known }, move.known ? INK.white : INK.gray400, 'left', 170);
  }
}
