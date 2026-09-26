import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { previewTeam } from '@features/battle/state/team-preview';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { toId } from '@shared/utils/to-id';

const TILE_SIZE = 64;
const TILE_GAP = 3;
const FIRST_LEFT = 8;
const BAR_WIDTH = 50;

interface Tile {
  key: string;
  sprite: string;
  left: number;
  /** HP bar width in px and colour, once it's been sent out. */
  bar: { width: number; color: string } | null;
  fainted: boolean;
  active: boolean;
}

/**
 * A side's team at a glance: its Pokémon as shown at team preview, the ones on the field framed, the
 * ones sent out with their HP bar and the fainted ones faded. The opponent's sits over the battle log;
 * a replay also shows p1's in its controls. Fixed 415x76, tiles at fixed positions (Brewser layout
 * rules). The tiles show once the battle's opening title has gone: by then the sprites, fetched from team
 * preview on, have had time to download (they popped in late on the console).
 */
@Component({
  selector: 'app-battle-team-preview',
  imports: [PokemonSprite],
  host: { class: 'block h-[76px] w-[415px]' },
  template: `
    <div class="relative h-[76px] w-[415px]" role="group" [attr.aria-label]="ariaLabel()">
      @for (tile of tiles(); track tile.key) {
        <div
          aria-hidden="true"
          class="absolute top-[6px] block h-[64px] w-[64px] rounded-md border"
          [class]="tile.fainted ? 'border-gray-700 bg-[#1a2436]' : tile.active ? 'border-sky-300 bg-[#2c4a78]' : 'border-gray-600 bg-card'"
          [style.left.px]="tile.left"
        >
          <app-pokemon-sprite
            class="absolute top-0 left-[3px]"
            [sprite]="tile.sprite"
            [size]="56"
            [style.opacity]="tile.fainted ? 0.3 : 1"
          />
          @if (tile.bar; as bar) {
            <span class="absolute top-[54px] left-[6px] block h-[4px] w-[50px] rounded-[1px] bg-gray-700">
              <span class="block h-[4px] rounded-[1px]" [style.width.px]="bar.width" [style.background-color]="bar.color"></span>
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class BattleTeamPreview {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  readonly side = input.required<SideId>();

  private readonly team = computed(() => previewTeam(this.store.sides()[this.side()]));

  protected readonly tiles = computed<Tile[]>(() =>
    (this.store.started() ? this.team() : []).map(({ species, seen, active }, i) => {
      const fraction = seen && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
      return {
        key: `${i}-${species}`,
        sprite: seen?.sprite || (this.dex.species(species)?.sprite ?? toId(species)),
        left: FIRST_LEFT + i * (TILE_SIZE + TILE_GAP),
        bar: seen && !seen.fainted ? { width: Math.max(1, Math.round(fraction * BAR_WIDTH)), color: barColor(fraction) } : null,
        fainted: !!seen?.fainted,
        active,
      };
    }),
  );

  /** "SC-Control's team: Garchomp 64%, in battle; Incineroar, fainted; Amoonguss, not sent out". */
  protected readonly ariaLabel = computed(() => {
    const owner = this.store.sides()[this.side()].name || (this.side() === 'p2' ? 'Opponent' : 'Player');
    const members = this.team().map(({ species, seen, active }) => {
      if (!seen) return `${species}, not sent out`;
      if (seen.fainted) return `${seen.name}, fainted`;
      const percent = seen.maxHp > 0 ? Math.max(1, Math.round((seen.hp / seen.maxHp) * 100)) : 0;
      return `${seen.name} ${percent}%${active ? ', in battle' : ''}`;
    });
    return `${owner}'s team: ${members.join('; ') || 'unknown'}`;
  });
}
