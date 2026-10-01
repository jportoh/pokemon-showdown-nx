import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, UiContext, button, focusRing, label } from '@core/gl/ui/retro-kit';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TEAM_FORMATS, formatLabel } from '@shared/data/formats';
import { PANEL_X, RIGHT, TOP, WHITE, arrow, shortcutButton, typePills, typeRgba } from './tb-draw';

export const MAX_TEAM_NAME_LENGTH = 30;

/** The 6 slots in 2 columns x 3 rows: 424x172 cards, 24px from the edges, 24px/12px apart. */
const SLOT_W = 424;
const SLOT_H = 172;
const SLOTS: readonly { x: number; y: number }[] = Array.from({ length: MAX_TEAM_SIZE }, (_, i) => ({
  x: PANEL_X + (i % 2 === 0 ? 24 : 472),
  y: TOP + 88 + Math.floor(i / 2) * 184,
}));

export function slotId(index: number): string {
  return `slot-${index}`;
}

/**
 * A team in the panel (TeamDetail on the canvas): its name, its format (A moves to the next one),
 * Rename (the canvas keyboard), Validate (ZL) and Delete (ZR, pressed twice), over its six slots as
 * cards: each Pokémon's sprite in the form it battles in, with its item's icon, its name, types, item
 * and ability, and its moves in their types' colours. An empty slot adds a Pokémon at the end.
 */
export class TeamView {
  private readonly dex = inject(ChampionsDex);
  private readonly keyboard = inject(CanvasKeyboard);

  /** The team whose Delete waits for its confirmation. */
  private confirmingDelete: string | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** Another team, or the same one shown again: nothing pending. */
  reset(): void {
    this.confirmingDelete = null;
  }

  /** ZR: asks first, then deletes (true once deleted). */
  pressDelete(team: Team): 'asked' | 'deleted' {
    if (this.confirmingDelete === team.id) {
      this.confirmingDelete = null;
      return 'deleted';
    }
    this.confirmingDelete = team.id;
    return 'asked';
  }

  rename(team: Team, renamed: (name: string) => void): void {
    this.confirmingDelete = null;
    this.keyboard.open({
      label: 'Team name',
      value: team.name,
      maxLength: MAX_TEAM_NAME_LENGTH,
      done: (value) => {
        this.focus.focus('team-rename');
        if (value === null) return;
        // A team always has a name: an empty one keeps the name it had.
        const name = value.trim();
        if (name) renamed(name);
      },
    });
  }

  draw(
    ctx: UiContext,
    team: Team,
    actions: { rename: () => void; format: (id: string) => void; validate: () => void; delete: () => void; edit: (index: number) => void },
  ): void {
    const p = ctx.palette;
    const x = PANEL_X;
    label(ctx, team.name, x + 24, TOP + 22, { size: 20, bold: true }, p.ink, { maxWidth: 490 });
    label(ctx, 'Format', x + 24, TOP + 62, { size: 14 }, p.muted);

    // A button that moves to the next format (a list of two isn't worth a picker).
    const formatBox = { x: x + 84, y: TOP + 44, w: 340, h: 36 };
    const next = () => {
      const current = TEAM_FORMATS.findIndex((format) => format.id === team.format);
      actions.format(TEAM_FORMATS[(current + 1) % TEAM_FORMATS.length].id);
    };
    // Right goes on to Rename, in the row above: the nearest that way would be the second slot.
    const formatFocused = ctx.focus.control({
      id: 'team-format',
      ...formatBox,
      accept: next,
      move: (direction) => direction === 'right' && (this.focus.focus('team-rename'), true),
    });
    ctx.renderer.rect(formatBox.x, formatBox.y, formatBox.w, formatBox.h, { fill: formatFocused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
    label(ctx, formatLabel(team.format), formatBox.x + 12, formatBox.y + 18, { size: 16 }, p.ink, { maxWidth: 290 });
    arrow(ctx, RIGHT, formatBox.x + 312, formatBox.y + 11, 2, p.muted);
    if (formatFocused) focusRing(ctx, formatBox);

    button(ctx, 'team-rename', { x: x + 528, y: TOP + 14, w: 100, h: 36 }, 'Rename', { size: 16, accept: actions.rename });
    shortcutButton(ctx, 'team-validate', { x: x + 640, y: TOP + 14, w: 124, h: 36 }, 'ZL', 'Validate', { accept: actions.validate });
    const confirming = this.confirmingDelete === team.id;
    shortcutButton(ctx, 'team-delete', { x: x + 776, y: TOP + 14, w: 120, h: 36 }, 'ZR', confirming ? 'Confirm' : 'Delete', { primary: confirming, accept: actions.delete });

    SLOTS.forEach((slot, i) => {
      const box = { x: slot.x, y: slot.y, w: SLOT_W, h: SLOT_H };
      const target = Math.min(i, team.sets.length);
      const focused = ctx.focus.control({ id: slotId(i), ...box, accept: () => actions.edit(target) });
      const set = team.sets[i];
      if (set) this.drawSlot(ctx, box, set, focused);
      else {
        ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.bg, stroke: p.outline, radius: 8, border: 2 });
        label(ctx, '+ Add Pokémon', box.x + box.w / 2, box.y + box.h / 2, { size: 16 }, p.muted, { align: 'center' });
      }
      if (focused) focusRing(ctx, box, 8);
    });
  }

  /** A slot's card, as TeamSlot (positions inside its 2px border). */
  private drawSlot(ctx: UiContext, box: Box, set: PokemonSet, focused: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: p.outline, radius: 8, border: 2 });
    renderer.rect(box.x + 10, box.y + 10, 152, 152, { fill: p.bg, stroke: p.rim, radius: 6, border: 1 });
    // The form it battles in: what it Mega Evolves into when it holds its Mega Stone.
    const form = this.dex.mega(set.species, set.item) ?? this.dex.species(set.species);
    const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
    if (sprite) renderer.rect(box.x + 14, box.y + 14, 144, 144, { fill: WHITE, texture: sprite });
    const itemId = this.dex.item(set.item)?.id;
    if (itemId) ctx.images.drawItem(itemId, box.x + 126, box.y + 126, 32);

    const left = box.x + 178;
    const species = form?.name ?? set.species;
    label(ctx, set.name ? `${set.name} (${species})` : species, left, box.y + 24, { size: 18, bold: true }, p.ink, { maxWidth: 236 });
    typePills(ctx, form?.types ?? [], left, box.y + 44);
    label(ctx, `${set.item || 'No item'} · ${set.ability || 'No ability'}`, left, box.y + 82, { size: 14 }, p.muted, { maxWidth: 236 });
    for (let i = 0; i < MAX_MOVES; i++) {
      const mx = left + (i % 2) * 120;
      const my = box.y + 102 + Math.floor(i / 2) * 32;
      const name = set.moves[i] ?? '';
      const color = name ? typeRgba(this.dex.move(name)?.type ?? '') : null;
      if (name) renderer.rect(mx, my, 116, 28, { fill: color ?? p.rim, radius: 6 });
      else renderer.rect(mx, my, 116, 28, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 6, border: 1 });
      if (name) label(ctx, name, mx + 6, my + 14, { size: 13 }, WHITE, { maxWidth: 104 });
    }
  }
}
