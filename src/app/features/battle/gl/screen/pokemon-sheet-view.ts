import { Rgba, rgba } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { barColor } from '@features/battle/gl/hp-bar';
import { PokemonSheet, SheetStat, stageText } from '@features/battle/state/pokemon-sheet';
import { SpriteSet } from '@shared/utils/sprite-id';
import { statColor } from './pokemon-info-view';
import { INK, ScreenContext, write } from './screen-context';

const TOP = 44;
const BAR_Y = 52;
const BAR_H = 44;
const Y0 = 104;

const LEFT = { x: 16, y: Y0, w: 360, h: 600 };
const STATS_BOX = { x: 392, y: Y0, w: 480, h: 352 };
const CONDITIONS = { x: 888, y: Y0, w: 376, h: 352 };
const MOVES = { x: 392, y: 468, w: 872, h: 236 };

const SPRITE = 280;
const HP_BAR = 324;
const STAT_ROW = 34;
/** Where the base stats end (right-aligned, so 3 digits don't run into their bars). */
const BASE_RIGHT = 92;
const PIP = 11;
const PIP_GAP = 3;
const CONDITION_ROW = 54;
const MAX_CONDITIONS = 5;
const MOVE_W = 412;
const MOVE_H = 80;

const LABEL = { size: 14, bold: true };
const UP = rgba('#fdba74');
const DOWN = rgba('#93c5fd');
const PIP_UP = rgba('#f97316');
const PIP_DOWN = rgba('#60a5fa');
const PIP_OFF: Rgba = [1, 1, 1, 0.14];
const SHADE = rgba('#0a0f1c');

function stageColor(stage: number): Rgba {
  return stage > 0 ? UP : stage < 0 ? DOWN : INK.gray500;
}

/**
 * One Pokémon's sheet, over the whole stage under the top bar (Battle info, A on a team card): the
 * sprite with its name, types, HP, item, ability and where it is; its stats with their stages (ours
 * exact, theirs as base stats), its Speed (theirs: the range it can have; ours: against the foes on the
 * field); its volatile conditions (confusion, Taunt, the perish count…) and its moves (ours with PP).
 */
export class PokemonSheetView {
  draw(ctx: ScreenContext, sheet: PokemonSheet, team: string, spriteSet: SpriteSet): void {
    const { renderer } = ctx;
    renderer.rect(0, TOP, 1280, 720 - TOP, { fill: [0.04, 0.06, 0.11, 1] });
    const side = sheet.side === 'p2' ? INK.red300 : INK.sky300;
    const cy = BAR_Y + BAR_H / 2;
    let x = 16 + write(ctx, team, 16, cy, { size: 20, bold: true }, side, 'left', 420);
    x += write(ctx, '  ›  ', x, cy, { size: 20 }, INK.gray500);
    write(ctx, sheet.name, x, cy, { size: 20, bold: true }, INK.white, 'left', 400);
    write(ctx, '◀ ▶ Pokémon · B Back', 1264, cy, { size: 16 }, INK.gray300, 'right', 300);

    this.drawSummary(ctx, sheet, side, spriteSet);
    this.drawStats(ctx, sheet);
    this.drawConditions(ctx, sheet);
    this.drawMoves(ctx, sheet);
  }

  private drawSummary(ctx: ScreenContext, sheet: PokemonSheet, border: Rgba, spriteSet: SpriteSet): void {
    const { renderer } = ctx;
    const { x, y, w, h } = LEFT;
    renderer.rect(x, y, w, h, { fill: sheet.fainted ? INK.fainted : INK.card, stroke: border, radius: 12, border: 2 });
    const sx = x + (w - SPRITE) / 2;
    const sy = y + 18;
    renderer.rect(sx, sy, SPRITE, SPRITE, { fill: INK.stage, radius: 10 });
    const sprite = ctx.images.sprite(sheet.sprite, false, ImagePriority.Screen, spriteSet);
    if (sprite) renderer.rect(sx + 4, sy + 4, SPRITE - 8, SPRITE - 8, { fill: [1, 1, 1, sheet.fainted ? 0.35 : 1], texture: sprite });

    const left = x + 18;
    const inner = w - 36;
    const nameY = sy + SPRITE + 26;
    const nameW = write(ctx, sheet.name, left, nameY, { size: 28, bold: true }, INK.white, 'left', inner);
    if (sheet.subtitle) write(ctx, sheet.subtitle, left + nameW + 10, nameY + 2, { size: 17 }, INK.gray300, 'left', inner - nameW - 10);

    let tx = left;
    const typeY = nameY + 24;
    for (const type of sheet.types) {
      const tw = type.tera ? 116 : 84;
      renderer.rect(tx, typeY, tw, 26, { fill: rgba(type.color), stroke: type.tera ? INK.white : [0, 0, 0, 0], radius: 5, border: type.tera ? 1 : 0 });
      write(ctx, type.text.toUpperCase(), tx + tw / 2, typeY + 13, { size: 14, bold: true }, INK.white, 'center', tw - 6);
      tx += tw + 6;
    }
    if (sheet.teraType) {
      const tw = 116;
      renderer.rect(tx, typeY, tw, 26, { fill: INK.dark, stroke: INK.gray500, radius: 5, border: 2 });
      write(ctx, `Tera ${sheet.teraType}`, tx + tw / 2, typeY + 13, { size: 14 }, INK.gray300, 'center', tw - 8);
      tx += tw + 6;
    }
    if (sheet.status) {
      renderer.rect(tx, typeY + 1, 50, 24, { fill: rgba(sheet.status.color), radius: 5 });
      write(ctx, sheet.status.text, tx + 25, typeY + 13, { size: 14, bold: true }, INK.white, 'center');
    }

    const hpY = typeY + 50;
    write(ctx, 'HP', left, hpY, { size: 17, bold: true }, INK.white);
    write(ctx, sheet.hp?.text ?? '?', left + inner, hpY, { size: 17, bold: true }, INK.white, 'right');
    renderer.rect(left, hpY + 12, HP_BAR, 12, { fill: INK.gray700, radius: 4 });
    const fraction = Math.max(0, Math.min(1, sheet.hp?.fraction ?? 0));
    if (fraction > 0) renderer.rect(left, hpY + 12, Math.max(4, Math.round(HP_BAR * fraction)), 12, { fill: rgba(barColor(fraction)), radius: 4 });

    // Item (with its icon) and ability side by side.
    const infoY = hpY + 46;
    const column = inner / 2;
    write(ctx, 'ITEM', left, infoY, LABEL, INK.gray400);
    write(ctx, 'ABILITY', left + column, infoY, LABEL, INK.gray400);
    const valueY = infoY + 28;
    if (sheet.itemId) {
      ctx.images.drawItem(sheet.itemId, left - 2, valueY - 14, 28);
    } else {
      renderer.rect(left, valueY - 14, 28, 28, { fill: INK.dark, radius: 6 });
      write(ctx, sheet.itemKnown ? '' : '?', left + 14, valueY, { size: 16, bold: true }, INK.gray500, 'center');
    }
    write(ctx, sheet.item, left + 34, valueY, { size: 17, bold: sheet.itemKnown }, sheet.itemKnown ? INK.white : INK.gray400, 'left', column - 40);
    write(ctx, sheet.ability, left + column, valueY, { size: 17, bold: sheet.abilityKnown }, sheet.abilityKnown ? INK.white : INK.gray400, 'left', column);

    const boxY = valueY + 30;
    const boxH = 22 + sheet.context.length * 24;
    renderer.rect(left, boxY, inner, boxH, { fill: INK.header, radius: 8 });
    sheet.context.forEach((line, i) => write(ctx, line, left + 12, boxY + 23 + i * 24, { size: 16, bold: i === 0 }, i === 0 ? INK.white : INK.gray300, 'left', inner - 24));
  }

  private drawStats(ctx: ScreenContext, sheet: PokemonSheet): void {
    const { renderer } = ctx;
    const { x, y, w, h } = STATS_BOX;
    renderer.rect(x, y, w, h, { fill: INK.card, radius: 12 });
    const left = x + 16;
    const right = x + w - 16;
    const headY = y + 26;
    // Ours: base, value, stage, now. Theirs: base, stage, multiplier.
    const col = sheet.own ? { bar: 492, barW: 48, value: 590, pips: 604, stage: 786 } : { bar: 492, barW: 78, value: 0, pips: 590, stage: 772 };
    write(ctx, 'STAT', left, headY, LABEL, INK.gray400);
    write(ctx, 'BASE', x + BASE_RIGHT, headY, LABEL, INK.gray400, 'right');
    if (sheet.own) write(ctx, 'VALUE', col.value, headY, LABEL, INK.gray400, 'right');
    write(ctx, 'STAGE', col.pips, headY, LABEL, INK.gray400);
    write(ctx, sheet.own ? 'NOW' : '×', right, headY, LABEL, INK.gray400, 'right');

    sheet.stats.forEach((stat, i) => {
      const cy = headY + 34 + i * STAT_ROW;
      write(ctx, stat.label, left, cy, { size: 19, bold: true }, INK.white);
      write(ctx, `${stat.base}`, x + BASE_RIGHT, cy, { size: 17 }, INK.gray300, 'right');
      const barW = Math.max(2, Math.round((Math.min(stat.base, 200) / 200) * col.barW));
      renderer.rect(col.bar, cy - 5, barW, 10, { fill: rgba(statColor(stat.base)), radius: 3 });
      if (sheet.own && stat.value !== undefined) write(ctx, `${stat.value}`, col.value, cy, { size: 19 }, INK.white, 'right');
      if (stat.label !== 'HP') this.drawStage(ctx, stat, col.pips, col.stage, cy);
      const shown = sheet.own ? stat.now : stat.multiplier;
      if (shown) write(ctx, shown, right, cy, { size: 19, bold: true }, sheet.own && stat.stage === 0 ? INK.white : stageColor(stat.stage), 'right');
    });

    const otherY = headY + 34 + 6 * STAT_ROW - 4;
    write(ctx, sheet.otherStages, left, otherY, { size: 15 }, INK.gray400, 'left', w - 32);

    const speed = sheet.speed;
    if (!speed) return;
    const box = { x: left, y: otherY + 16, w: w - 32, h: 64 };
    renderer.rect(box.x, box.y, box.w, box.h, { fill: INK.header, radius: 8 });
    if (speed.kind === 'range') {
      write(ctx, 'SPEED RANGE', box.x + 12, box.y + 20, LABEL, INK.gray400);
      write(ctx, 'Before items and abilities', box.x + 12, box.y + 44, { size: 14 }, INK.gray400, 'left', 220);
      const color = speed.change === 0 ? INK.white : speed.change < 0 ? DOWN : UP;
      write(ctx, speed.now, box.x + box.w - 12, box.y + (speed.change ? 22 : 32), { size: 26, bold: true }, color, 'right');
      if (speed.change) write(ctx, `Base ${speed.base} · ${speed.reasons}`, box.x + box.w - 12, box.y + 48, { size: 14 }, INK.gray300, 'right');
      return;
    }
    write(ctx, speed.note.startsWith('Trick Room') ? 'SPEED VS THE FIELD · TRICK ROOM' : 'SPEED VS THE FIELD', box.x + 12, box.y + 18, LABEL, INK.gray400, 'left', 300);
    const yours = `${speed.own}`;
    const yoursW = write(ctx, yours, box.x + box.w - 12, box.y + 18, { size: 16, bold: true }, INK.white, 'right');
    write(ctx, 'Yours: ', box.x + box.w - 12 - yoursW, box.y + 18, { size: 15 }, INK.gray300, 'right');
    if (speed.rivals.length === 0) {
      write(ctx, 'No rivals on the field', box.x + 12, box.y + 44, { size: 15 }, INK.gray400);
      return;
    }
    let cx = box.x + 8;
    const room = (box.w - 16 - 8 * (speed.rivals.length - 1)) / speed.rivals.length;
    for (const rival of speed.rivals) {
      renderer.rect(cx, box.y + 32, room, 24, { fill: SHADE, radius: 6 });
      const verdict = rival.verdict === 'faster' ? 'faster' : rival.verdict === 'slower' ? 'slower' : 'maybe';
      const color = rival.verdict === 'faster' ? INK.red300 : rival.verdict === 'slower' ? INK.green400 : INK.yellow200;
      const verdictW = write(ctx, verdict, cx + room - 8, box.y + 44, { size: 14, bold: true }, color, 'right');
      write(ctx, `${rival.name} ${rival.range} ·`, cx + 8, box.y + 44, { size: 14 }, INK.gray200, 'left', room - verdictW - 20);
      cx += room + 8;
    }
  }

  /** Twelve pips, six down and six up, lit up to the stage; its number after them. */
  private drawStage(ctx: ScreenContext, stat: SheetStat, x: number, textX: number, cy: number): void {
    for (let i = 0; i < 12; i++) {
      const n = i < 6 ? i - 6 : i - 5;
      const on = (stat.stage < 0 && n < 0 && n >= stat.stage) || (stat.stage > 0 && n > 0 && n <= stat.stage);
      const px = x + i * (PIP + PIP_GAP) + (i >= 6 ? 6 : 0);
      ctx.renderer.rect(px, cy - PIP / 2, PIP, PIP, { fill: on ? (stat.stage > 0 ? PIP_UP : PIP_DOWN) : PIP_OFF, radius: 2 });
    }
    write(ctx, stageText(stat.stage), textX, cy, { size: 16, bold: true }, stageColor(stat.stage));
  }

  private drawConditions(ctx: ScreenContext, sheet: PokemonSheet): void {
    const { renderer } = ctx;
    const { x, y, w, h } = CONDITIONS;
    renderer.rect(x, y, w, h, { fill: INK.card, radius: 12 });
    write(ctx, 'CONDITIONS', x + 16, y + 26, LABEL, INK.gray400);
    const all = sheet.conditions;
    if (all.length === 0) {
      write(ctx, sheet.fainted ? '—' : 'None', x + 16, y + 66, { size: 19 }, INK.gray400);
      return;
    }
    const shown = all.length > MAX_CONDITIONS ? all.slice(0, MAX_CONDITIONS - 1) : all;
    shown.forEach((condition, i) => {
      const ry = y + 46 + i * (CONDITION_ROW + 8);
      const rw = w - 28;
      renderer.rect(x + 14, ry, rw, CONDITION_ROW, { fill: INK.header, radius: 8 });
      const color = rgba(condition.color);
      renderer.rect(x + 14, ry, 8, CONDITION_ROW, { fill: color, radius: 4 });
      const textW = condition.count ? rw - 80 : rw - 40;
      write(ctx, condition.name, x + 34, ry + 18, { size: 19, bold: true }, INK.white, 'left', textW);
      write(ctx, condition.detail, x + 34, ry + 40, { size: 14 }, INK.gray300, 'left', textW);
      if (condition.count) write(ctx, condition.count, x + 14 + rw - 16, ry + CONDITION_ROW / 2, { size: 32, bold: true }, INK.yellow200, 'right');
      else if (condition.turns) {
        const pipW = Math.min(14, Math.floor((70 - 4 * (condition.turns.total - 1)) / condition.turns.total));
        for (let n = 0; n < condition.turns.total; n++) {
          const px = x + 14 + rw - 12 - (condition.turns.total - n) * (pipW + 4);
          renderer.rect(px, ry + 12, pipW, 8, { fill: n < condition.turns.left ? color : [1, 1, 1, 0.15], radius: 2 });
        }
      }
    });
    if (shown.length < all.length) {
      const more = all.slice(shown.length).map((c) => c.name).join(', ');
      write(ctx, `+ ${more}`, x + 16, y + 46 + shown.length * (CONDITION_ROW + 8) + 16, { size: 15 }, INK.gray300, 'left', w - 32);
    }
  }

  private drawMoves(ctx: ScreenContext, sheet: PokemonSheet): void {
    const { renderer } = ctx;
    const { x, y, w, h } = MOVES;
    renderer.rect(x, y, w, h, { fill: INK.card, radius: 12 });
    write(ctx, sheet.movesTitle.toUpperCase(), x + 16, y + 22, LABEL, INK.gray400, 'left', w - 32);
    sheet.moves.forEach((move, i) => {
      const mx = x + 16 + (i % 2) * (MOVE_W + 16);
      const my = y + 40 + Math.floor(i / 2) * (MOVE_H + 12);
      const fill = !move.known ? INK.dark : move.dim ? INK.gray700 : rgba(move.color);
      renderer.rect(mx, my, MOVE_W, MOVE_H, { fill, radius: 10 });
      const ink = move.known && !move.dim ? INK.white : INK.gray400;
      const ppW = move.pp ? write(ctx, move.pp, mx + MOVE_W - 14, my + 24, { size: 19, bold: true }, ink, 'right') : 0;
      write(ctx, move.name, mx + 14, my + 24, { size: 20, bold: move.known }, ink, 'left', MOVE_W - 40 - ppW);
      const meta = move.dim ? `${move.meta} · can't be used now` : move.meta;
      if (meta) write(ctx, meta, mx + 14, my + 56, { size: 15 }, move.known ? (move.dim ? INK.gray400 : INK.gray100) : INK.gray500, 'left', MOVE_W - 28);
    });
  }
}
