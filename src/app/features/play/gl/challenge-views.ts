import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { drawChip, drawField, drawRoundButton, drawSlantedButton, menuModal, menuPanel } from '@core/gl/ui/menu-kit';
import { Box, UiContext, label, paragraph, pill } from '@core/gl/ui/retro-kit';
import { Challenge, ShowdownChallenges } from '@features/connection/showdown-challenges';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { PLAYABLE_FORMATS, PlayableFormat } from '@shared/data/formats';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

/** The challenge's panel, against the right edge; it slides in from off the stage. */
const PANEL: Box = { x: 744, y: 96, w: 512, h: 600 };
const SLIDE_MS = 420;
const BAND_H = 64;
/** The team to accept with: 64px sprites in a row. */
const SPRITE = 64;
const SPRITE_STEP = 74;
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
 * A challenge from another player, as a panel that slides in from the right over the dimmed Battle
 * page (ChallengePopup on the canvas): who and in what format, the team to accept with (its six
 * Pokémon; L/R pick another), Accept, Reject and their Trainer Card. B leaves it for later (the page's
 * call). The focus starts on Accept (or Reject when it can't be accepted), again for each challenge
 * in line. Once accepted, "Joining battle…" stays in place of the buttons until the battle opens.
 */
export class ChallengePopupView {
  private readonly challenges = inject(ShowdownChallenges);
  private readonly dex = inject(ChampionsDex);
  private shownFrom: string | null = null;
  private shownAt = 0;
  private teamIndex = 0;
  private teamAt = 0;
  /** "Joining battle…" was shown last frame: if it goes without a battle, the focus goes back to Accept. */
  private wasJoining = false;
  /** Accept's eased focus. */
  private acceptFocus = 0;

  constructor(private readonly focus: CanvasFocus) {}

  /** The panel went away (or another box covers it): the next showing starts over. */
  reset(): void {
    this.shownFrom = null;
    this.wasJoining = false;
  }

  joining(challenge: Challenge): boolean {
    return this.challenges.accepted()?.fromId === challenge.fromId;
  }

  /** L/R: the previous or next team to accept with (wrapping around), when there's more than one. */
  cycle(model: PopupModel, by: 1 | -1): boolean {
    const count = model.teams.length;
    if (!model.challenge.needsTeam || count < 2 || this.joining(model.challenge)) return false;
    this.teamIndex = (this.teamIndex + by + count) % count;
    this.teamAt = performance.now();
    return true;
  }

  draw(ctx: UiContext, model: PopupModel): void {
    this.start(model, ctx.now);
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const { challenge, teams } = model;
    const team = challenge.needsTeam ? (teams[this.teamIndex] ?? null) : null;
    const canAccept = !challenge.needsTeam || team !== null;

    // The page dims and its controls can't be reached; the panel slides in, overshooting a little.
    renderer.rect(0, 0, 1280, 720, { fill: withAlpha(p.bg, 0.65) });
    ctx.focus.trap();
    const t = Math.min(1, (now - this.shownAt) / SLIDE_MS);
    const x = PANEL.x + (1280 - PANEL.x) * (1 - backOut(t));
    const y = PANEL.y;
    const w = PANEL.w;
    // The menu's panel, lit with the accent: a challenge is the page's news.
    menuPanel(ctx, { ...PANEL, x }, p.accent);
    drawChip(ctx, { text: 'CHALLENGE', tone: 'alert' }, x + 24, y + 3 + BAND_H / 2, 1, 30);
    const formatLabel = PLAYABLE_FORMATS.find((format) => format.id === challenge.format)?.label ?? challenge.formatName;
    label(ctx, formatLabel, x + w - 24, y + 3 + BAND_H / 2, { size: 15, bold: true }, p.muted, { align: 'right', maxWidth: 300 });

    const left = x + 28;
    const inner = w - 56;
    label(ctx, challenge.from, left, y + 112, { size: 36, bold: true }, p.ink, {
      maxWidth: inner,
    });
    // Accepting failed (a team the server refused): why, in place of the invitation; L/R pick another team.
    const failure = this.challenges.acceptFailed() === challenge.fromId ? this.challenges.error() : null;
    if (failure) {
      paragraph(ctx, failure, left, y + 134, inner, 22, { size: 17, bold: true }, p.danger, 3);
    } else {
      label(ctx, 'wants to battle!', left, y + 152, { size: 22 }, p.ink);
      if (model.waiting > 0) label(ctx, `${model.waiting} more waiting`, left, y + 182, { size: 16 }, p.muted);
    }

    // What it's played with.
    const teamBox = { x: left, y: y + 204, w: inner, h: 160 };
    renderer.rect(teamBox.x, teamBox.y, teamBox.w, teamBox.h, { fill: mixRgba(p.panel, p.rim, 0.6), radius: 16 });
    if (!challenge.needsTeam) {
      label(ctx, 'Random teams', teamBox.x + 20, teamBox.y + 40, { size: 22, bold: true }, p.ink);
      label(ctx, 'Showdown hands out the teams.', teamBox.x + 20, teamBox.y + 76, { size: 18 }, p.muted);
    } else if (!team) {
      label(ctx, 'No team for this format', teamBox.x + 20, teamBox.y + 40, { size: 22, bold: true }, p.danger);
      label(ctx, 'Build one in the Teambuilder to accept.', teamBox.x + 20, teamBox.y + 76, { size: 18 }, p.muted, { maxWidth: teamBox.w - 40 });
    } else {
      const many = teams.length > 1;
      label(ctx, `With ${team.name}`, teamBox.x + 20, teamBox.y + 30, { size: 20, bold: true }, p.ink, { maxWidth: teamBox.w - (many ? 170 : 40) });
      if (many) this.drawCycle(ctx, model, teamBox);
      this.drawTeam(ctx, team, teamBox, now);
    }

    const buttonsY = teamBox.y + teamBox.h + 24;
    const joining = this.joining(challenge);
    if (this.wasJoining && !joining) this.focus.focus(canAccept ? 'popup-accept' : 'popup-reject');
    this.wasJoining = joining;
    if (joining) {
      label(ctx, 'Joining battle…', left, buttonsY + 32, { size: 26, bold: true }, p.ink);
      return;
    }
    if (canAccept) {
      const box = { x: left + 6, y: buttonsY, w: inner - 12, h: 68 };
      const focused = ctx.focus.control({ id: 'popup-accept', ...box, accept: () => this.challenges.accept(challenge, team ? packTeam(team.sets) : null) });
      this.acceptFocus += ((focused ? 1 : 0) - this.acceptFocus) * 0.25;
      drawSlantedButton(ctx, { ...box, f: this.acceptFocus, alpha: 1, title: 'ACCEPT', titleSize: 30, plate: p.accent, primary: true });
    }
    const half = (inner - 16) / 2;
    drawRoundButton(ctx, 'popup-reject', { x: left, y: buttonsY + 84, w: half, h: 52 }, 'Reject', () => this.challenges.reject(challenge));
    drawRoundButton(ctx, POPUP_CARD_ID, { x: left + half + 16, y: buttonsY + 84, w: half, h: 52 }, 'Trainer Card', model.viewCard);
    const width = pill(ctx, 'B', left, y + PANEL.h - 30, 24);
    label(ctx, 'Answer later', left + width + 8, y + PANEL.h - 30, { size: 16 }, p.muted);
  }

  /** "2/5" and the L/R pills, clickable. */
  private drawCycle(ctx: UiContext, model: PopupModel, box: Box): void {
    const p = ctx.palette;
    const cy = box.y + 30;
    const right = box.x + box.w - 16;
    const keys = [
      { id: 'popup-team-prev', key: 'L', x: right - 84, by: -1 as const },
      { id: 'popup-team-next', key: 'R', x: right - 40, by: 1 as const },
    ];
    label(ctx, `${this.teamIndex + 1}/${model.teams.length}`, right - 96, cy, { size: 15, bold: true }, p.muted, { align: 'right' });
    for (const key of keys) {
      ctx.focus.control({
        id: key.id,
        x: key.x,
        y: cy - 14,
        w: 36,
        h: 28,
        skip: true,
        accept: () => this.cycle(model, key.by),
      });
      pill(ctx, key.key, key.x, cy, 26);
    }
  }

  /** The team's six, dropping in one after another when it changes. */
  private drawTeam(ctx: UiContext, team: Team, box: Box, now: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const rowW = (MAX_TEAM_SIZE - 1) * SPRITE_STEP + SPRITE;
    const left = box.x + (box.w - rowW) / 2;
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const sx = left + i * SPRITE_STEP;
      const sy = box.y + 60;
      renderer.rect(sx + 6, sy + SPRITE - 8, SPRITE - 12, 12, { fill: p.rim, radius: 6 });
      const set = team.sets[i];
      if (!set) continue;
      const texture = ctx.images.sprite(this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species), false, ImagePriority.Screen);
      const drop = Math.min(1, Math.max(0, (now - this.teamAt - i * 40) / 220));
      if (texture) renderer.rect(sx, sy - (1 - drop) * 20, SPRITE, SPRITE, { fill: [1, 1, 1, drop], texture });
      label(ctx, set.species, sx + SPRITE / 2, sy + SPRITE + 16, { size: 11, bold: true }, p.muted, { align: 'center', maxWidth: SPRITE_STEP - 4 });
    }
  }

  /** The focus on the first showing of a challenge: Accept, or Reject when it can't be accepted. */
  private start(model: PopupModel, now: number): void {
    const { challenge, teams } = model;
    if (this.shownFrom === challenge.fromId) return;
    this.shownFrom = challenge.fromId;
    this.shownAt = now;
    this.teamAt = now;
    this.teamIndex = Math.max(
      0,
      teams.findIndex((team) => team.id === model.preferredTeam),
    );
    this.focus.focus(!challenge.needsTeam || teams[this.teamIndex] ? 'popup-accept' : 'popup-reject');
  }
}

/** Easing out past the end and back (the panel's slide). */
function backOut(t: number): number {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
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
  /** Send's eased focus. */
  private sendFocus = 0;

  constructor(private readonly focus: CanvasFocus) {}

  /** A new form: empty, the focus on Send (never on the field, see textField). */
  open(): void {
    this.name = '';
    this.error = null;
    this.focus.focus('form-send');
  }

  draw(ctx: UiContext, format: PlayableFormat, team: Team | null, close: () => void): void {
    const p = ctx.palette;
    const x = FORM_BOX.x + 32;
    const y = FORM_BOX.y;
    menuModal(ctx, FORM_BOX);
    label(ctx, 'CHALLENGE A PLAYER', x, y + 46, { size: 32, bold: true }, p.ink, { maxWidth: 720 });
    const intro = format.randomTeams
      ? `Challenge a player on Showdown to ${format.label}.`
      : team
        ? `Challenge a player to ${format.label} with ${team.name}.`
        : `Pick a team for ${format.label} first.`;
    label(ctx, this.error ?? intro, x, y + 90, { size: 18, bold: this.error !== null }, this.error ? p.danger : p.muted, { maxWidth: 720 });
    drawField(ctx, 'form-name', { x, y: y + 140, w: 720, h: 56 }, {
      label: 'PLAYER',
      value: this.name,
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
    const send = { x: x + 6, y: y + 214, w: 440, h: 60 };
    const focused = ctx.focus.control({ id: 'form-send', ...send, accept: () => this.submit(format, team, close) });
    this.sendFocus += ((focused ? 1 : 0) - this.sendFocus) * 0.25;
    drawSlantedButton(ctx, { ...send, f: this.sendFocus, alpha: 1, title: 'SEND CHALLENGE', titleSize: 24, plate: p.accent, primary: true });
    drawRoundButton(ctx, 'form-cancel', { x: x + 472, y: y + 218, w: 248, h: 52 }, 'Cancel', close);
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
