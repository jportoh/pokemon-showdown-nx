import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { previewTeam } from '@features/battle/state/team-preview';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { spriteId } from '@shared/utils/sprite-id';

/** Two rows of three tiles, centred in the card under the owner's name. */
const PER_ROW = 3;
const TILE_SIZE = 72;
const TILE_GAP = 10;
const FIRST_LEFT = 17;
const FIRST_TOP = 26;
const ROW_GAP = 8;
const BAR_WIDTH = 56;
const MAX_NAME_CHARS = 30;
const MAX_TEAM = PER_ROW * 2;

interface Tile {
  key: string;
  sprite: string;
  left: number;
  top: number;
  /** HP bar width in px and colour, once it's been sent out. */
  bar: { width: number; color: string } | null;
  fainted: boolean;
  active: boolean;
}

/**
 * A side's team at a glance, under its owner's name: its Pokémon as shown at team preview, the ones on
 * the field framed, the ones sent out with their HP bar and the fainted ones faded. Without a team
 * preview (Random Battle), the Pokémon seen so far, then an empty tile for each one still unseen.
 * Both sides' sit in
 * the battle's right column, the opponent's on top. A card fixed at 271x188, tiles at fixed positions
 * (Brewser layout rules). The tiles show once the battle's opening title has gone: by then the sprites, fetched from team
 * preview on, have had time to download (they popped in late on the console).
 */
@Component({
  selector: 'app-battle-team-preview',
  imports: [PokemonSprite],
  host: { class: 'block h-[188px] w-[271px]' },
  template: `
    <div class="relative block h-[188px] w-[271px] rounded-md bg-card" role="group" [attr.aria-label]="ariaLabel()">
      <span
        aria-hidden="true"
        class="absolute top-[4px] left-[10px] block h-4 w-[251px] overflow-hidden text-xs leading-4 font-bold whitespace-nowrap uppercase"
        [class]="side() === 'p1' ? 'text-sky-300' : 'text-red-300'"
        >{{ ownerLabel() }}</span
      >
      @for (tile of tiles(); track tile.key) {
        <div
          aria-hidden="true"
          class="absolute block h-[72px] w-[72px] rounded-md border"
          [class]="tile.fainted ? 'border-gray-700 bg-[#1a2436]' : tile.active ? 'border-sky-300 bg-[#2c4a78]' : 'border-gray-600 bg-header'"
          [style.left.px]="tile.left"
          [style.top.px]="tile.top"
        >
          <app-pokemon-sprite
            class="absolute top-0 left-[3px]"
            [sprite]="tile.sprite"
            [size]="64"
            [style.opacity]="tile.fainted ? 0.3 : 1"
          />
          @if (tile.bar; as bar) {
            <span class="absolute top-[62px] left-[7px] block h-[4px] w-[56px] rounded-[1px] bg-gray-700">
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

  /** Pokémon brought but not seen yet (only without a team preview: it shows them all). */
  private readonly unseen = computed(() => {
    const side = this.store.sides()[this.side()];
    return side.preview.length > 0 ? 0 : Math.max(0, Math.min(MAX_TEAM, side.teamSize) - this.team().length);
  });

  protected readonly tiles = computed<Tile[]>(() => {
    if (!this.store.started()) return [];
    const members = this.team().map(({ species, seen, active }, i) => {
      const fraction = seen && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
      return {
        key: `${i}-${species}`,
        sprite: seen?.sprite || (this.dex.species(species)?.sprite ?? spriteId(species)),
        ...this.tilePosition(i),
        bar: seen && !seen.fainted ? { width: Math.max(1, Math.round(fraction * BAR_WIDTH)), color: barColor(fraction) } : null,
        fainted: !!seen?.fainted,
        active,
      };
    });
    const empty = Array.from({ length: this.unseen() }, (_, n) => {
      const i = members.length + n;
      return { ...this.tilePosition(i), key: `unseen-${i}`, sprite: '', bar: null, fainted: false, active: false };
    });
    return [...members, ...empty];
  });

  private readonly owner = computed(() => this.store.sides()[this.side()].name || (this.side() === 'p2' ? 'Opponent' : 'Player'));

  /** The owner's name, cut by hand to fit (text-overflow is untested on Brewser). */
  protected readonly ownerLabel = computed(() => {
    const name = this.owner();
    return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
  });

  /** "SC-Control's team: Garchomp 64%, in battle; Incineroar, fainted; Amoonguss, not sent out". */
  protected readonly ariaLabel = computed(() => {
    const owner = this.owner();
    const members = this.team().map(({ species, seen, active }) => {
      if (!seen) return `${species}, not sent out`;
      if (seen.fainted) return `${seen.name}, fainted`;
      const percent = seen.maxHp > 0 ? Math.max(1, Math.round((seen.hp / seen.maxHp) * 100)) : 0;
      return `${seen.name} ${percent}%${active ? ', in battle' : ''}`;
    });
    const unseen = this.unseen() > 0 ? [`${this.unseen()} not seen yet`] : [];
    return `${owner}'s team: ${[...members, ...unseen].join('; ') || 'unknown'}`;
  });

  private tilePosition(i: number): { left: number; top: number } {
    return {
      left: FIRST_LEFT + (i % PER_ROW) * (TILE_SIZE + TILE_GAP),
      top: FIRST_TOP + Math.floor(i / PER_ROW) * (TILE_SIZE + ROW_GAP),
    };
  }
}
