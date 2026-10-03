import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, UiContext, button, label, modal, pill, textField } from '@core/gl/ui/retro-kit';
import { Challenge, ShowdownChallenges } from '@features/connection/showdown-challenges';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { PlayableFormat } from '@shared/data/formats';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

const POPUP_BOX: Box = { x: 248, y: 234, w: 784, h: 328 };
/** A challenge played with our own teams: room for the team's Pokémon, to see which team it is. */
const TEAM_POPUP_BOX: Box = { x: 136, y: 120, w: 1008, h: 500 };
/** The team's Pokémon in the bigger box: 96px sprites on tiles. */
const SPRITE_TILE = 120;
const SPRITE_GAP = 12;
const FORM_BOX: Box = { x: 248, y: 234, w: 784, h: 296 };
export const POPUP_CARD_ID = 'popup-card';

/** What the Battle page shows a challenge with. */
export interface PopupModel {
  challenge: Challenge;
  /** How many other challenges wait behind this one. */
  waiting: number;
  /** The player's teams for the challenge's format (none in random formats). */
  teams: readonly Team[];
  /** The team picked on the Battle page, taken first when it fits. */
  preferredTeam: string | null;
  viewCard: () => void;
}

/**
 * A challenge from another player, in a box over the Battle page (ChallengePopup on the canvas):
 * Accept (with one of our teams for its format, L/R to pick another) or Reject, after a look at the
 * challenger's Trainer Card if wanted. B leaves it for later (the page's call). The focus starts on
 * Accept (or Reject when it can't be accepted), again for each challenge in line. Once accepted,
 * "Joining battle…" stays in place of the buttons until the battle opens.
 */
export class ChallengePopupView {
  private readonly challenges = inject(ShowdownChallenges);
  private readonly dex = inject(ChampionsDex);
  private shownFrom: string | null = null;
  private teamIndex = 0;

  constructor(private readonly focus: CanvasFocus) {}

  /** The box went away (or another one covers it): the next showing starts over. */
  reset(): void {
    this.shownFrom = null;
  }

  joining(challenge: Challenge): boolean {
    return this.challenges.accepted()?.fromId === challenge.fromId;
  }

  /** L/R: the previous or next team to accept with (wrapping around), when there's more than one. */
  cycle(model: PopupModel, by: 1 | -1): boolean {
    const count = model.teams.length;
    if (!model.challenge.needsTeam || count < 2 || this.joining(model.challenge)) return false;
    this.teamIndex = (this.teamIndex + by + count) % count;
    return true;
  }

  draw(ctx: UiContext, model: PopupModel): void {
    if (model.challenge.needsTeam && model.teams.length > 0) {
      this.drawWithTeam(ctx, model);
      return;
    }
    const p = ctx.palette;
    const { challenge, teams } = model;
    const canAccept = (team: Team | null) => !challenge.needsTeam || team !== null;
    this.start(model);
    const team = teams[this.teamIndex] ?? null;
    const x = POPUP_BOX.x + 32;
    const y = POPUP_BOX.y;
    modal(ctx, POPUP_BOX);
    label(ctx, `${challenge.from} wants to battle!`, x, y + 48, { size: 36, bold: true }, p.accentText, { maxWidth: 712 });
    const others = model.waiting > 0 ? ` · ${model.waiting} more waiting` : '';
    label(ctx, challenge.formatName + others, x, y + 104, { size: 20 }, p.ink, { maxWidth: 712 });
    const teamLine = !challenge.needsTeam
      ? 'Showdown hands out the teams.'
      : !team
        ? 'You have no team for this format.'
        : teams.length > 1
          ? `With your team ${team.name} · L/R to change`
          : `With your team ${team.name}`;
    label(ctx, teamLine, x, y + 136, { size: 18 }, p.muted, { maxWidth: 712 });
    if (this.joining(challenge)) {
      label(ctx, 'Joining battle…', x, y + 212, { size: 24, bold: true }, p.ink);
      return;
    }
    if (canAccept(team)) {
      button(ctx, 'popup-accept', { x, y: y + 184, w: 344, h: 56 }, 'Accept', {
        primary: true,
        size: 24,
        accept: () => this.challenges.accept(challenge, challenge.needsTeam && team ? packTeam(team.sets) : null),
      });
    }
    button(ctx, 'popup-reject', { x: x + 368, y: y + 184, w: 344, h: 56 }, 'Reject', { size: 24, accept: () => this.challenges.reject(challenge) });
    const width = pill(ctx, 'B', x, y + 274, 24);
    label(ctx, 'Answer later', x + width + 8, y + 274, { size: 16 }, p.muted);
    button(ctx, POPUP_CARD_ID, { x: x + 492, y: y + 250, w: 220, h: 44 }, 'Trainer Card', { size: 18, accept: model.viewCard });
  }

  /** The focus on the first showing of a challenge: Accept, or Reject when it can't be accepted. */
  private start(model: PopupModel): void {
    const { challenge, teams } = model;
    if (this.shownFrom === challenge.fromId) return;
    this.shownFrom = challenge.fromId;
    this.teamIndex = Math.max(0, teams.findIndex((team) => team.id === model.preferredTeam));
    this.focus.focus(!challenge.needsTeam || teams[this.teamIndex] ? 'popup-accept' : 'popup-reject');
  }

  /**
   * The bigger box for a challenge played with our own teams: the team to accept with as its six
   * Pokémon (not just its name), ◀ ▶ around them for L/R, "2 of 5" under them.
   */
  private drawWithTeam(ctx: UiContext, model: PopupModel): void {
    this.start(model);
    const p = ctx.palette;
    const { renderer } = ctx;
    const { challenge, teams } = model;
    const team = teams[this.teamIndex] ?? teams[0];
    const box = TEAM_POPUP_BOX;
    const x = box.x + 40;
    const y = box.y;
    const width = box.w - 80;
    modal(ctx, box);
    label(ctx, `${challenge.from} wants to battle!`, x, y + 52, { size: 38, bold: true }, p.accentText, { maxWidth: width });
    const others = model.waiting > 0 ? ` · ${model.waiting} more waiting` : '';
    label(ctx, challenge.formatName + others, x, y + 100, { size: 22 }, p.ink, { maxWidth: width });

    // The team: its name, then its Pokémon on tiles between the arrows.
    const many = teams.length > 1;
    label(ctx, `With your team ${team.name}`, x, y + 146, { size: 24, bold: true }, p.ink, { maxWidth: width - 200 });
    if (many) label(ctx, `${this.teamIndex + 1} of ${teams.length}`, x + width, y + 146, { size: 20 }, p.muted, { align: 'right' });
    const rowW = MAX_TEAM_SIZE * SPRITE_TILE + (MAX_TEAM_SIZE - 1) * SPRITE_GAP;
    const left = box.x + (box.w - rowW) / 2;
    const top = y + 176;
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const tile = { x: left + i * (SPRITE_TILE + SPRITE_GAP), y: top, w: SPRITE_TILE, h: SPRITE_TILE };
      renderer.rect(tile.x, tile.y, tile.w, tile.h, { fill: p.panel, stroke: p.rim, radius: 10, border: 2 });
      const set = team.sets[i];
      if (!set) continue;
      const sprite = this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species);
      const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
      if (texture) renderer.rect(tile.x + (SPRITE_TILE - 96) / 2, tile.y + 4, 96, 96, { fill: [1, 1, 1, 1], texture });
      label(ctx, set.species, tile.x + SPRITE_TILE / 2, tile.y + SPRITE_TILE - 12, { size: 14, bold: true }, p.ink, { align: 'center', maxWidth: SPRITE_TILE - 8 });
    }
    if (many) {
      // L/R change the team; the arrows are clickable too.
      const arrows = [
        { id: 'popup-team-prev', key: 'L', glyph: '◀', at: left - 60, by: -1 as const },
        { id: 'popup-team-next', key: 'R', glyph: '▶', at: left + rowW + 12, by: 1 as const },
      ];
      for (const arrow of arrows) {
        const control = { x: arrow.at, y: top + 24, w: 48, h: 72 };
        ctx.focus.control({ id: arrow.id, ...control, skip: true, accept: () => this.cycle(model, arrow.by) });
        label(ctx, arrow.glyph, control.x + 24, control.y + 26, { size: 30, bold: true }, p.accentText, { align: 'center' });
        label(ctx, arrow.key, control.x + 24, control.y + 60, { size: 16, bold: true }, p.muted, { align: 'center' });
      }
    }

    const buttonsY = top + SPRITE_TILE + 36;
    if (this.joining(challenge)) {
      label(ctx, 'Joining battle…', x, buttonsY + 30, { size: 26, bold: true }, p.ink);
      return;
    }
    const buttonW = (width - 24) / 2;
    button(ctx, 'popup-accept', { x, y: buttonsY, w: buttonW, h: 60 }, 'Accept', {
      primary: true,
      size: 26,
      accept: () => this.challenges.accept(challenge, packTeam(team.sets)),
    });
    button(ctx, 'popup-reject', { x: x + buttonW + 24, y: buttonsY, w: buttonW, h: 60 }, 'Reject', { size: 26, accept: () => this.challenges.reject(challenge) });
    const pillWidth = pill(ctx, 'B', x, buttonsY + 104, 24);
    label(ctx, 'Answer later', x + pillWidth + 8, buttonsY + 104, { size: 18 }, p.muted);
    button(ctx, POPUP_CARD_ID, { x: x + width - 240, y: buttonsY + 80, w: 240, h: 48 }, 'Trainer Card', { size: 20, accept: model.viewCard });
  }
}

/**
 * Challenging a player by name in the format and with the team picked on the Battle page, in a box over
 * the page (ChallengeForm on the canvas). The name is typed with the canvas keyboard, whose OK moves
 * on to Send challenge; sending closes the box (the page's panel then shows the challenge waiting).
 */
export class ChallengeFormView {
  private readonly challenges = inject(ShowdownChallenges);
  private readonly keyboard = inject(CanvasKeyboard);
  private name = '';
  private error: string | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** A new form: empty, the focus on Send (never on the field, see textField). */
  open(): void {
    this.name = '';
    this.error = null;
    this.focus.focus('form-send');
  }

  draw(ctx: UiContext, format: PlayableFormat, team: Team | null, close: () => void): void {
    const p = ctx.palette;
    const x = FORM_BOX.x + 29;
    const y = FORM_BOX.y;
    modal(ctx, FORM_BOX);
    label(ctx, 'Challenge a player', x, y + 48, { size: 36, bold: true }, p.ink, { maxWidth: 720 });
    const intro = format.randomTeams
      ? `Challenge a player on Showdown to ${format.label}.`
      : team
        ? `Challenge a player to ${format.label} with ${team.name}.`
        : `Pick a team for ${format.label} first.`;
    label(ctx, this.error ?? intro, x, y + 116, { size: 18, bold: this.error !== null }, this.error ? p.danger : p.muted, { maxWidth: 720 });
    textField(ctx, 'form-name', { x, y: y + 148, w: 720, h: 44 }, this.name, {
      placeholder: "Player's name",
      edit: () =>
        this.keyboard.open({
          label: 'Player to challenge',
          value: this.name,
          // Showdown's limit for names.
          maxLength: 18,
          done: (value) => {
            if (value === null) return;
            this.name = value;
            this.focus.focus('form-send');
          },
        }),
    });
    button(ctx, 'form-send', { x, y: y + 208, w: 352, h: 44 }, 'Send challenge', { primary: true, size: 22, accept: () => this.submit(format, team, close) });
    button(ctx, 'form-cancel', { x: x + 368, y: y + 208, w: 352, h: 44 }, 'Cancel', { size: 22, accept: close });
  }

  private submit(format: PlayableFormat, team: Team | null, close: () => void): void {
    const name = this.name.trim();
    this.name = name;
    if (!toId(name)) {
      this.error = 'Enter the name of the player to challenge.';
      return;
    }
    if (!format.randomTeams && !team) {
      this.error = `Pick a team for ${format.label} first.`;
      return;
    }
    this.challenges.challenge(name, format.id, team ? packTeam(team.sets) : null);
    close();
  }
}
