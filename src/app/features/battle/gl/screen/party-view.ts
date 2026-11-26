import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { withAlpha } from '@core/gl/gl-renderer';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { ScreenContext, drawKeys, write } from './screen-context';
import { CARD_H, CARD_W, drawTeamCard, ownCard } from './team-card';

const TOP = 44;
const GRID_X = 16;
const GRID_Y = 104;
const GAP_X = 16;
const GAP_Y = 8;

/**
 * The party screen, to switch: over the field (dimmed), our team as cards two by two, each with
 * everything about it (HP, item, ability, moves); the ones that can come in bright, the rest dimmed
 * with where they are. A sends the focused one in; on one that can't come in, says why; Y opens its
 * whole sheet, exact stats and all (the battle screen's call). Opened with Switch, and by itself for a
 * forced switch (a Pokémon fainted, or U-turn).
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
          card: ownCard(pokemon, this.dex, coming ? 'Coming in' : '', this.store.gen()),
          x: GRID_X + (i % 2) * (CARD_W + GAP_X),
          y: GRID_Y + Math.floor(i / 2) * (CARD_H + GAP_Y),
        };
      });
  });

  /** The first that can come in, where the focus starts. */
  readonly firstId = computed(() => this.cards().find((card) => card.allowed)?.id ?? this.cards()[0]?.id ?? null);

  /** The team member whose card has the focus (its index in our team), else the first. */
  memberInFocus(focused: string | null): number | null {
    const card = this.cards().find((entry) => entry.id === focused) ?? this.cards()[0];
    return card ? card.index - 1 : null;
  }

  /** `back`: whether B leaves it (not on a forced switch with nothing to go back to). */
  draw(ctx: ScreenContext, back: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(0, TOP, 1280, 720 - TOP, { fill: withAlpha(p.bg, 0.94) });
    renderer.rect(0, TOP, 640, 720 - TOP, { fill: withAlpha(p.hero, 0.7), fillEnd: withAlpha(p.hero, 0) });
    const name = this.choices.pokemonName();
    const title = this.choices.pokemonFainted() ? `${name} fainted. Who comes in?` : `Who comes in for ${name}?`;
    write(ctx, title, GRID_X, TOP + 30, { size: 26, bold: true }, p.ink, 'left', 780);
    const notice = this.choices.notice();
    if (notice) write(ctx, notice, 1264, TOP + 30, { size: 17, bold: true }, p.teal, 'right', 460);
    else drawKeys(ctx, back ? [['A', 'Switch in'], ['Y', 'Stats'], ['B', 'Back']] : [['A', 'Switch in'], ['Y', 'Stats']], 1264, TOP + 30);

    for (const entry of this.cards()) {
      const box = { x: entry.x, y: entry.y, w: CARD_W, h: CARD_H };
      const focused = ctx.focus.control({ id: entry.id, ...box, accept: () => this.pick(entry) });
      drawTeamCard(ctx, entry.x, entry.y, entry.card, { side: 'p1', dim: !entry.allowed, focused });
    }
  }

  /** A: sends it in, or says why it can't come in. */
  private pick(entry: { index: number; allowed: boolean; blocked: string }): void {
    if (entry.allowed) this.choices.chooseSwitch(entry.index);
    else this.choices.notice.set(entry.blocked);
  }
}
