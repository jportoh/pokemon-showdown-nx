import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { rgba } from '@core/gl/gl-renderer';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { INK, ScreenContext, write } from './screen-context';
import { CARD_H, CARD_W, drawTeamCard, ownCard } from './team-card';

const TOP = 44;
const GRID_X = 16;
const GRID_Y = 104;
const GAP_X = 16;
const GAP_Y = 8;
const AMBER = rgba('#fcd34d');

/**
 * The party screen, to switch: over the field (dimmed), our team as cards two by two, each with
 * everything about it (HP, item, ability, moves); the ones that can come in bright, the rest dimmed
 * with where they are. A sends the focused one in; on one that can't come in, says why. Opened with
 * Switch, and by itself for a forced switch (a Pokémon fainted, or U-turn).
 */
export class PartyView {
  private readonly store = inject(BattleStore);
  private readonly choices = inject(BattleChoices);
  private readonly dex = inject(ChampionsDex);

  private readonly cards = computed(() => {
    const options = this.choices.switchOptions();
    return this.store
      .team()
      .slice(0, 6)
      .map((pokemon, i) => {
        const option = options[i];
        const coming = !!option && !option.allowed && /coming in/.test(option.blocked);
        return {
          id: `party-${i}`,
          index: i + 1,
          allowed: !!option?.allowed,
          blocked: option?.blocked ?? '',
          card: ownCard(pokemon, this.dex, coming ? 'Coming in' : ''),
          x: GRID_X + (i % 2) * (CARD_W + GAP_X),
          y: GRID_Y + Math.floor(i / 2) * (CARD_H + GAP_Y),
        };
      });
  });

  /** The first that can come in, where the focus starts. */
  readonly firstId = computed(() => this.cards().find((card) => card.allowed)?.id ?? this.cards()[0]?.id ?? null);

  /** `back`: whether B leaves it (not on a forced switch with nothing to go back to). */
  draw(ctx: ScreenContext, back: boolean): void {
    const { renderer } = ctx;
    renderer.rect(0, TOP, 1280, 720 - TOP, { fill: [0.03, 0.05, 0.1, 0.86] });
    const name = this.choices.pokemonName();
    const title = this.choices.pokemonFainted() ? `${name} fainted. Who comes in?` : `Who comes in for ${name}?`;
    write(ctx, title, GRID_X, TOP + 30, { size: 28, bold: true }, INK.white, 'left', 780);
    const notice = this.choices.notice();
    write(ctx, notice || `A Switch in${back ? ' · B Back' : ''}`, 1264, TOP + 30, { size: 18, bold: !!notice }, notice ? AMBER : INK.gray300, 'right', 460);

    for (const entry of this.cards()) {
      const box = { x: entry.x, y: entry.y, w: CARD_W, h: CARD_H };
      const focused = ctx.focus.control({ id: entry.id, ...box, accept: () => this.pick(entry) });
      drawTeamCard(ctx, entry.x, entry.y, entry.card, { border: entry.allowed ? INK.sky300 : INK.gray600, dim: !entry.allowed, focused });
    }
  }

  /** A: sends it in, or says why it can't come in. */
  private pick(entry: { index: number; allowed: boolean; blocked: string }): void {
    if (entry.allowed) this.choices.chooseSwitch(entry.index);
    else this.choices.notice.set(entry.blocked);
  }
}
