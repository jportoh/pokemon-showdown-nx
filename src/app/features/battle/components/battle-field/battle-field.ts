import { Component, computed, inject } from '@angular/core';
import { BattlePokemon } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { BattleHpBox } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { PokemonSprite } from '@shared/components/pokemon-sprite';

interface FieldSlot {
  key: string;
  pokemon: BattlePokemon | null;
  /** Sprite position and size (px). */
  left: number;
  top: number;
  size: number;
  /** Status box position (px). */
  boxLeft: number;
  boxTop: number;
}

/**
 * The battlefield, laid out like the third-generation games' double battles: the opponent's two
 * Pokémon on platforms at the back right, with their status boxes top left; the player's two seen
 * from behind at the front left, with their status boxes on the right. The opponent's side faces the
 * player, so its first slot stands on the right. Fixed 853x404 (the left two thirds of the stage, with
 * the battle log on the right), all positions absolute.
 */
@Component({
  selector: 'app-battle-field',
  imports: [BattleHpBox, PokemonSprite],
  host: { class: 'block h-[404px] w-[853px]' },
  template: `
    <div class="relative h-[404px] w-[853px] overflow-hidden bg-[#d8ecc0]">
      <div class="absolute top-[236px] left-0 h-[168px] w-[853px] bg-[#b0d890]"></div>
      <!-- Platforms: the opponent's at the back, the player's cut off by the bottom edge. -->
      <div class="absolute top-[166px] left-[420px] h-[56px] w-[240px] rounded-[50%] border-[3px] border-[#6a9a50] bg-[#90c070]"></div>
      <div class="absolute top-[166px] left-[610px] h-[56px] w-[240px] rounded-[50%] border-[3px] border-[#6a9a50] bg-[#90c070]"></div>
      <div class="absolute top-[356px] left-[10px] h-[84px] w-[280px] rounded-[50%] border-[3px] border-[#6a9a50] bg-[#90c070]"></div>
      <div class="absolute top-[356px] left-[240px] h-[84px] w-[280px] rounded-[50%] border-[3px] border-[#6a9a50] bg-[#90c070]"></div>

      @for (slot of foeSlots(); track slot.key) {
        @if (slot.pokemon && !slot.pokemon.fainted) {
          <app-pokemon-sprite
            class="absolute [image-rendering:pixelated]"
            [style.left.px]="slot.left"
            [style.top.px]="slot.top"
            [sprite]="slot.pokemon.sprite"
            [size]="slot.size"
          />
          <app-battle-hp-box class="absolute" [style.left.px]="slot.boxLeft" [style.top.px]="slot.boxTop" [pokemon]="slot.pokemon" />
        }
      }
      @for (slot of ownSlots(); track slot.key) {
        @if (slot.pokemon && !slot.pokemon.fainted) {
          <app-pokemon-sprite
            class="absolute [image-rendering:pixelated]"
            [style.left.px]="slot.left"
            [style.top.px]="slot.top"
            [sprite]="slot.pokemon.sprite"
            [size]="slot.size"
            [back]="true"
          />
          <app-battle-hp-box class="absolute" [style.left.px]="slot.boxLeft" [style.top.px]="slot.boxTop" [pokemon]="slot.pokemon" [own]="true" [exact]="!store.replay()" />
        }
      }
    </div>
  `,
})
export class BattleField {
  protected readonly store = inject(BattleStore);

  // Sprites stand on their platform's centre, all doubled (192px) as in Gen 3, where front and back
  // sprites are the same size: Showdown's 96px sprites have the feet about 10px above the bottom, and
  // the player's are cut off by the bottom edge.
  protected readonly foeSlots = computed<FieldSlot[]>(() => {
    const [a, b] = this.store.sides().p2.active;
    return [
      { key: 'p2a', pokemon: a, left: 634, top: 22, size: 192, boxLeft: 16, boxTop: 16 },
      { key: 'p2b', pokemon: b, left: 444, top: 22, size: 192, boxLeft: 40, boxTop: 88 },
    ];
  });

  protected readonly ownSlots = computed<FieldSlot[]>(() => {
    const [a, b] = this.store.sides().p1.active;
    return [
      { key: 'p1a', pokemon: a, left: 54, top: 226, size: 192, boxLeft: 485, boxTop: 222 },
      { key: 'p1b', pokemon: b, left: 284, top: 226, size: 192, boxLeft: 501, boxTop: 312 },
    ];
  });
}
