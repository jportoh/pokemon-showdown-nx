import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { GlStage, StageFrame } from '@core/gl/gl-stage';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { ListView, UiContext, button, focusRing, label, modal, pill, stepper, tabs, textField } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { AppSettings, THEMES } from '@core/settings/app-settings';
import { itemName, itemsWithIcons } from '@core/dex/names';

const TAB_NAMES = ['Widgets', 'List', 'Glyphs', 'Items'] as const;
/** The Items tab: icons cut from Showdown's sheet, a grid of 18 by 7. */
const ITEM_COLUMNS = 18;
const ITEM_ROWS = 7;
const LIST_COUNT = 200;
const SPEEDS = ['Slow', 'Normal', 'Fast', 'Instant'];
const STRESS_LINES = 28;

/**
 * The canvas UI kit on show (R3 on the home screen), to try widgets on the console on their own.
 * Widgets (buttons, steppers, text fields with the canvas keyboard, a modal
 * dialog), a long paged list, and a stress test of fast-changing text drawn from the glyph atlas or
 * as textures. ZL/ZR switch tabs, B goes back to the menu. The theme stepper changes the app's theme.
 */
@Component({
  selector: 'app-gl-kit-screen',
  template: '',
})
export class GlKitScreen {
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly settings = inject(AppSettings);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly router = inject(Router);

  private readonly focus = new CanvasFocus();
  private readonly list = new ListView('row', 52, 8);
  private tab = 0;
  private speed = 1;
  private name = '';
  private password = '';
  private dialogOpen = false;
  private picked = 'Nothing picked yet';
  private fastText = true;
  private counter = 0;
  private readonly items = itemsWithIcons();
  private itemPage = 0;
  private pointedItem = '';

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    const release = [
      this.navigation.registerButton('buttonZL', () => this.switchTab(-1)),
      this.navigation.registerButton('buttonZR', () => this.switchTab(1)),
      this.navigation.registerButton('buttonL', () => (this.tab === 3 ? ((this.itemPage = Math.max(0, this.itemPage - 1)), true) : this.tab === 1 && this.list.page(-1, LIST_COUNT, this.focus))),
      this.navigation.registerButton('buttonR', () => (this.tab === 3 ? ((this.itemPage += 1), true) : this.tab === 1 && this.list.page(1, LIST_COUNT, this.focus))),
    ];
    this.focus.focus('tab-0');
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
      this.keyboard.close(null);
    });
  }

  private switchTab(by: 1 | -1): boolean {
    this.tab = (this.tab + by + TAB_NAMES.length) % TAB_NAMES.length;
    this.focus.focus(`tab-${this.tab}`);
    return true;
  }

  private onAction(action: CanvasAction): boolean {
    if (action === 'back') {
      if (this.dialogOpen) this.dialogOpen = false;
      else void this.router.navigateByUrl('/');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer } = frame;
    renderer.beginPlain(p.bg);
    this.focus.begin();

    renderer.rect(0, 0, 1280, 76, { fill: p.bar });
    label(ctx, 'UI kit', 24, 38, { size: 32, bold: true }, p.ink);
    label(ctx, 'ZL/ZR tabs · B back to the menu', 1256, 38, { size: 18 }, p.muted, { align: 'right' });
    tabs(ctx, 'tab', { x: 48, y: 96, w: 600, h: 48 }, TAB_NAMES, this.tab, (index) => (this.tab = index));

    if (this.tab === 0) this.drawWidgets(ctx);
    else if (this.tab === 1) this.drawList(ctx);
    else if (this.tab === 2) this.drawGlyphs(ctx);
    else this.drawItems(ctx);

    const frames = this.diagnostics.frameSummary();
    const uploads = this.diagnostics.summary('text');
    const recent = this.diagnostics.frames.slice(-60);
    const average = recent.reduce((sum, f) => sum + f.interval, 0) / Math.max(1, recent.length);
    label(ctx, `${average > 0 ? Math.round(1000 / average) : 0} fps · worst ${Math.round(frames.worst)} ms · text uploads ${uploads.count}/s`, 1256, 700, { size: 16 }, p.muted, {
      align: 'right',
      fast: true,
    });

    if (this.dialogOpen) {
      const box = { x: 340, y: 220, w: 600, h: 280 };
      modal(ctx, box);
      label(ctx, 'A modal dialog', box.x + 32, box.y + 48, { size: 28, bold: true }, p.ink);
      label(ctx, 'The focus stays inside it; B closes it.', box.x + 32, box.y + 100, { size: 18 }, p.muted);
      button(ctx, 'dialog-ok', { x: box.x + 32, y: box.y + 196, w: 260, h: 52 }, 'OK', { primary: true, accept: () => (this.dialogOpen = false) });
      button(ctx, 'dialog-cancel', { x: box.x + 308, y: box.y + 196, w: 260, h: 52 }, 'Cancel', { accept: () => (this.dialogOpen = false) });
      if (!this.focus.focused?.startsWith('dialog-')) this.focus.focus('dialog-ok');
    }

    this.focus.end();
    renderer.end();
  }

  private drawWidgets(ctx: UiContext): void {
    const p = ctx.palette;
    const x = 48;
    button(ctx, 'primary', { x, y: 176, w: 280, h: 52 }, 'Primary', { primary: true, accept: () => (this.picked = 'Pressed Primary') });
    button(ctx, 'secondary', { x: x + 296, y: 176, w: 280, h: 52 }, 'Secondary', { accept: () => (this.picked = 'Pressed Secondary') });
    button(ctx, 'disabled', { x: x + 592, y: 176, w: 280, h: 52 }, 'Disabled', { disabled: true, accept: () => undefined });
    button(ctx, 'shortcut', { x: x + 888, y: 176, w: 280, h: 52 }, 'Log in', { shortcut: 'ZR', accept: () => (this.picked = 'Pressed Log in') });

    const themeIndex = THEMES.findIndex((t) => t.id === this.settings.settings().theme);
    stepper(ctx, 'theme', { x, y: 252, w: 576, h: 56 }, 'Theme', THEMES[themeIndex]?.name ?? '', (by) => {
      this.settings.set('theme', THEMES[(themeIndex + by + THEMES.length) % THEMES.length].id);
    });
    stepper(ctx, 'speed', { x: x + 592, y: 252, w: 576, h: 56 }, 'Text speed', SPEEDS[this.speed], (by) => {
      this.speed = (this.speed + by + SPEEDS.length) % SPEEDS.length;
    });

    label(ctx, 'Name', x, 340, { size: 16, bold: true }, p.muted);
    textField(ctx, 'name', { x, y: 356, w: 576, h: 52 }, this.name, {
      placeholder: 'Press A to type',
      edit: () => this.keyboard.open({ label: 'Name', value: this.name, maxLength: 18, done: (value) => value !== null && (this.name = value) }),
    });
    label(ctx, 'Password', x + 592, 340, { size: 16, bold: true }, p.muted);
    textField(ctx, 'password', { x: x + 592, y: 356, w: 576, h: 52 }, this.password, {
      placeholder: 'Press A to type',
      masked: true,
      edit: () => this.keyboard.open({ label: 'Password', value: this.password, maxLength: 30, masked: true, done: (value) => value !== null && (this.password = value) }),
    });

    button(ctx, 'dialog', { x, y: 436, w: 280, h: 52 }, 'Open a dialog', { accept: () => (this.dialogOpen = true) });
    label(ctx, this.picked, x + 296, 462, { size: 18 }, p.ink);
    pill(ctx, 'B', x, 540);
    label(ctx, 'Back to the menu', x + 48, 540, { size: 18 }, p.muted);
  }

  private drawList(ctx: UiContext): void {
    const p = ctx.palette;
    label(ctx, this.list.range(LIST_COUNT), 1232, 120, { size: 18 }, p.muted, { align: 'right', fast: true });
    label(ctx, 'L/R page · A picks', 680, 120, { size: 18 }, p.muted);
    this.list.draw(
      ctx,
      48,
      176,
      1184,
      LIST_COUNT,
      ({ box, index, focused }) => {
        ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: p.outline, radius: 8, border: 2 });
        label(ctx, `Row ${index + 1}`, box.x + 20, box.y + box.h / 2, { size: 20, bold: true }, p.ink, { fast: true });
        label(ctx, `A long list paged a row at a time, never a scroll box · item #${(index * 7919) % 1000}`, box.x + 160, box.y + box.h / 2, { size: 16 }, p.muted, { fast: true, maxWidth: 1000 });
        if (focused) focusRing(ctx, box, 8);
      },
      (index) => (this.picked = `Picked row ${index + 1}`),
    );
  }

  /** Item icons drawn from Showdown's sheet (one texture, cut by coordinates); L/R page through them. */
  private drawItems(ctx: UiContext): void {
    const p = ctx.palette;
    const ids = this.items;
    const perPage = ITEM_COLUMNS * ITEM_ROWS;
    const pages = Math.ceil(ids.length / perPage);
    this.itemPage = Math.max(0, Math.min(this.itemPage, pages - 1));
    label(ctx, `${ids.length} items from one sheet · page ${this.itemPage + 1}/${pages} · L/R pages`, 680, 120, { size: 18 }, p.muted, { fast: true });
    const first = this.itemPage * perPage;
    for (let i = 0; i < perPage && first + i < ids.length; i++) {
      const id = ids[first + i];
      const box = { x: 48 + (i % ITEM_COLUMNS) * 66, y: 172 + Math.floor(i / ITEM_COLUMNS) * 66, w: 60, h: 60 };
      const focused = ctx.focus.control({ id: `item-${i}`, ...box, accept: () => (this.picked = itemName(id)) });
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: p.outline, radius: 6, border: 1 });
      ctx.images.drawItem(id, box.x + 6, box.y + 6, 48);
      if (focused) {
        focusRing(ctx, box);
        this.pointedItem = itemName(id);
      }
    }
    label(ctx, this.pointedItem, 48, 658, { size: 20, bold: true }, p.ink, { fast: true });
  }

  /** Text that changes every frame: from the glyph atlas (no uploads) or as textures (one upload per new string). */
  private drawGlyphs(ctx: UiContext): void {
    const p = ctx.palette;
    this.counter++;
    button(ctx, 'mode', { x: 48, y: 160, w: 360, h: 48 }, this.fastText ? 'Glyph atlas (A: textures)' : 'Textures (A: glyph atlas)', {
      accept: () => (this.fastText = !this.fastText),
    });
    for (let i = 0; i < STRESS_LINES; i++) {
      const value = `Line ${i + 1}: ${(this.counter * (i + 3)) % 100000} · turn ${Math.floor(this.counter / 60)} · HP ${(this.counter + i * 13) % 100}%`;
      const column = i % 2;
      const row = Math.floor(i / 2);
      label(ctx, value, 48 + column * 600, 240 + row * 32, { size: 18 }, p.ink, { fast: this.fastText });
    }
  }
}
