import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { PageBar } from '@core/gl/ui/page-bar';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { AppSettings } from '@core/settings/app-settings';
import { SetEditorView } from '@features/teambuilder/gl/set-editor-view';
import { SpriteStage } from '@features/teambuilder/gl/sprite-stage';
import { EDIT_RIGHT, LEGEND_H, LegendEntry, controlsLegend, keyPill } from '@features/teambuilder/gl/tb-draw';
import { NEW_TEAM_ID, TeamGridView, inGridOrder } from '@features/teambuilder/gl/team-grid-view';
import { MAX_TEAM_NAME_LENGTH, TEAM_FORMAT_ID, TEAM_RENAME_ID, TeamView, slotId } from '@features/teambuilder/gl/team-view';
import { VALIDATION_BACK_ID, ValidationView } from '@features/teambuilder/gl/validation-view';
import { PokePasteImport, pasteId } from '@features/teambuilder/state/pokepaste-import';
import { TeamStore } from '@features/teambuilder/state/team-store';

type View = 'teams' | 'team' | 'validate' | 'edit';
const LEAVE_MS = 180;
/** How long the grid's legend shows how an import went. */
const IMPORT_NOTICE_MS = 8000;

/**
 * The Teambuilder, drawn on the stage, in two pages: the teams as cards in a grid (New team first),
 * and a team, as the games' party screen (the focused Pokémon's card on the left, its six slots as
 * rows beside it; Rename and the format in its header, L/R go through the teams, Validate on ZL shows
 * the server's answer in a modal, Delete on ZR held down; on the grid ZR imports a PokePaste). One of its Pokémon being edited takes the
 * whole page (its card stays where the team had it, with its Details or its Stats beside it; L/R switch
 * them, or the filters of a list, ZL picks No item/No move, ZR removes it). B goes back a step:
 * from the editor or the validation to the team, from the team to the grid, from the grid to the menu.
 */
@Component({
  selector: 'app-teambuilder-scene',
  template: '',
})
export class TeambuilderScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly settings = inject(AppSettings);
  private readonly store = inject(TeamStore);
  private readonly dex = inject(ChampionsDex);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly pokePaste = inject(PokePasteImport);

  private readonly focus = new CanvasFocus();
  /** The sprite's stage, the team's card's and the editor's: opening a Pokémon keeps it standing. */
  private readonly spriteStage = new SpriteStage();
  private readonly grid = new TeamGridView(this.focus);
  private readonly teamView = new TeamView(this.focus, this.spriteStage);
  private readonly validation = new ValidationView();

  private readonly selectedId = signal<string | null>(null);
  private readonly team = computed(() => this.store.team(this.selectedId()));
  private readonly editor = new SetEditorView(this.focus, this.team, () => this.closeEditor(), this.spriteStage);
  private view: View = 'teams';
  private readonly diagnostics = inject(GlDiagnostics);
  /** The diagnostics' own lines (L3): the damage calcs' time and the sprites' uploads. */
  private diagnosticLines(): string[] {
    const calcs = this.diagnostics.summary('calc');
    const sprites = this.diagnostics.summary('sprite');
    return [
      `Damage calc: ${calcs.count}/s · longest ${calcs.max.toFixed(1)} ms`,
      `Sprite uploads: ${sprites.count}/s · longest ${sprites.max.toFixed(1)} ms`,
    ];
  }

  /** Which game data the teambuilder uses, and how recent it is. */
  private readonly dataSummary = `Reg M-C data: ${this.dex.allSpecies.length} Pokémon · ${this.dex.generated}`;
  private leaving: { at: number } | null = null;
  /** How the last PokePaste import went (on the grid's legend for a while); `at` is null while it's under way. */
  private importNotice: { text: string; error: boolean; at: number | null } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
      diagnostics: () => this.diagnosticLines(),
    });
    // The grid opens on its first team (stored last), or New.
    this.grid.focusTeam(this.store.teams(), this.store.teams().at(-1)?.id ?? null);
    // On the grid ZL picks a team up (and puts it down), R makes it its format's favourite and ZR
    // imports a PokePaste. On a team L/R go through the teams, ZL validates and ZR deletes it; in the
    // editor L/R switch Details/Stats (or a list's filters), ZL picks No item/No move (on Stats it
    // undoes the points) and ZR removes the Pokémon; R3 searches an open list.
    const release = [
      this.navigation.registerButton('buttonZL', () => {
        if (this.leaving) return true;
        if (this.view === 'teams') return this.pressMove();
        if (this.view === 'team') return this.validate();
        return this.view === 'edit' && this.editor.pressClear();
      }),
      this.navigation.registerButton('buttonZR', () => {
        if (this.leaving) return true;
        if (this.view === 'teams') return this.grid.isMoving() || this.askPaste();
        if (this.view === 'team') return this.pressDelete();
        return this.view === 'edit' && this.editor.pressRemove();
      }),
      this.navigation.registerButton('buttonL', () => this.pressLR(-1)),
      this.navigation.registerButton('buttonR', () => (this.view === 'teams' ? this.pressFavourite() : this.pressLR(1))),
      // R3: an open list's search, without walking up to its box first.
      this.navigation.registerButton('buttonR3', () => this.leaving !== null || (this.view === 'edit' && this.editor.pressSearch())),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      this.back();
      return true;
    }
    if (action === 'first' || action === 'last') {
      if (this.view === 'edit') this.editor.jump(action);
      else if (this.view === 'teams' && !this.grid.isMoving()) this.grid.jump(action, this.store.teams().length);
      else if (this.view === 'team') this.focus.focus(slotId(action === 'first' ? 0 : Math.max(0, (this.team()?.sets.length ?? 1) - 1)));
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private back(): void {
    switch (this.view) {
      case 'edit':
        return this.editor.back();
      case 'validate':
        return this.showSlot(this.teamView.slot);
      case 'team':
        return this.showTeams();
      default:
        if (this.grid.isMoving()) return this.grid.cancel(this.store.teams());
        return this.leave();
    }
  }

  /** L/R: the team before or after this one (as the grid has them); in the editor, its tabs or filters. */
  private pressLR(by: 1 | -1): boolean {
    if (this.leaving) return true;
    if (this.view === 'edit') return this.editor.pressLR(by);
    if (this.view !== 'team') return false;
    const teams = inGridOrder(this.store.teams());
    const index = teams.findIndex((team) => team.id === this.selectedId());
    const next = teams[index + by];
    if (!next) return true;
    this.openTeam(next.id, by);
    return true;
  }

  /** The grid again, on the team that was shown. */
  private showTeams(): void {
    this.teamView.reset();
    this.view = 'teams';
    this.grid.enter();
    this.grid.focusTeam(this.store.teams(), this.selectedId());
  }

  /**
   * A team's page: from the grid on its first slot, from L/R on the slot the last team was on (or
   * its last Pokémon, when it has fewer). Its rows come in from `from`, and its sprite drops in.
   */
  private openTeam(id: string, from: 1 | -1 = 1): void {
    const pokemon = this.store.team(id)?.sets.length ?? 0;
    const slot = this.view === 'team' ? Math.min(this.teamView.slot, Math.max(0, pokemon - 1)) : 0;
    this.teamView.reset();
    this.teamView.enter(from);
    this.spriteStage.restart();
    this.selectedId.set(id);
    this.showSlot(slot);
  }

  /** A new empty team with a default name, so building one starts without typing anything. */
  private createTeam(): void {
    const id = this.store.create(this.store.nextUntitledName(), this.settings.settings().teamFormat, []);
    this.openTeam(id);
  }

  /** The team, on a slot (the one being edited, or the next one if it was removed). */
  private showSlot(index: number): void {
    if (!this.team()) return this.showTeams();
    this.view = 'team';
    this.focus.focus(slotId(Math.min(index, this.team()?.sets.length ?? 0)));
  }

  /** Back from the editor to the team, on the slot edited; the card slides back up. */
  private closeEditor(): void {
    this.teamView.backFromEditor();
    this.showSlot(this.editor.index());
  }

  private editSlot(index: number): void {
    this.teamView.reset();
    this.view = 'edit';
    this.editor.open(index);
  }

  /** ZL on the grid: picks the focused team up, or puts the one carried down where it is. */
  private pressMove(): boolean {
    if (!this.grid.isMoving()) return this.grid.pickUp(this.store.teams());
    const order = this.grid.drop();
    if (order) this.store.reorder(order);
    return true;
  }

  /** R on the grid: the focused team becomes its format's favourite, or stops being it. */
  private pressFavourite(): boolean {
    if (this.leaving || this.grid.isMoving()) return true;
    const id = this.grid.focusedTeam(this.store.teams());
    if (id) this.store.toggleFavourite(id);
    return id !== null;
  }

  /** ZR on the grid: the keyboard, for a PokePaste's link or ID. */
  private askPaste(): boolean {
    if (this.importNotice?.at === null) return true;
    this.keyboard.open({
      label: 'PokePaste link or ID',
      value: '',
      maxLength: 64,
      hint: (text) => {
        const id = pasteId(text);
        return id ? `PokePaste ${id}` : 'Type the link (pokepast.es/…) or just its ID';
      },
      done: (value) => {
        if (value === null || !value.trim()) return;
        const id = pasteId(value);
        if (id) void this.importPaste(id);
        else this.importNotice = { text: "That isn't a PokePaste link or ID.", error: true, at: performance.now() };
      },
    });
    return true;
  }

  /** The PokePaste as a new team, in the format chosen in Settings; the grid focuses it. */
  private async importPaste(id: string): Promise<void> {
    this.importNotice = { text: 'Importing from pokepast.es…', error: false, at: null };
    try {
      const paste = await this.pokePaste.load(id);
      const name = paste.title.slice(0, MAX_TEAM_NAME_LENGTH).trim() || this.store.nextUntitledName();
      const teamId = this.store.create(name, this.settings.settings().teamFormat, paste.sets);
      const notes = [
        paste.skipped.length ? `left out ${paste.skipped.join(', ')}` : '',
        paste.dropped ? `${paste.dropped} item/ability/move not in the format` : '',
      ].filter(Boolean);
      const text = `Imported ${name}: ${paste.sets.length} Pokémon${notes.length ? ` (${notes.join('; ')})` : ''}`;
      this.importNotice = { text, error: false, at: performance.now() };
      if (this.view === 'teams') this.grid.focusTeam(this.store.teams(), teamId);
    } catch (error) {
      this.importNotice = { text: error instanceof Error ? error.message : "The import didn't work.", error: true, at: performance.now() };
    }
  }

  /** ZL: checks the team against its format on the server; the modal shows the answer when it comes. */
  private validate(): boolean {
    const team = this.team();
    if (!team) return false;
    this.teamView.reset();
    this.validation.validate(team);
    this.view = 'validate';
    this.focus.focus(VALIDATION_BACK_ID);
    return true;
  }

  /** ZR: deleting can't be undone, so it's held down until Delete fills up (see draw). */
  private pressDelete(): boolean {
    if (!this.team()) return false;
    this.teamView.pressDelete();
    return true;
  }

  /** The team goes; the grid shows the card that takes its place. */
  private deleteTeam(id: string): void {
    const card = inGridOrder(this.store.teams()).findIndex((team) => team.id === id) + 1;
    this.store.remove(id);
    this.selectedId.set(null);
    this.view = 'teams';
    this.grid.enter();
    this.grid.focusCard(card, this.store.teams().length + 1);
  }

  private leave(): void {
    this.leaving ??= { at: performance.now() };
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    // The team went away (deleted): back to the grid.
    if (this.view !== 'teams' && !this.team()) this.showTeams();
    const shown = this.team();
    if (this.teamView.stepDelete(now, this.view === 'team' && !!shown && !this.leaving) && shown) this.deleteTeam(shown.id);
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    const team = this.team();

    // The pages first: the grid scrolls under the bar and the legend.
    if (this.view === 'teams') {
      this.grid.draw(ctx, {
        teams: this.store.teams(),
        create: () => this.createTeam(),
        open: (id) => this.openTeam(id),
        reorder: (order) => this.store.reorder(order),
      });
    } else if (this.view === 'edit' && team) {
      this.editor.draw(ctx);
    } else if (team) {
      this.teamView.draw(ctx, team, {
        rename: () => this.teamView.rename(team, (name) => this.store.rename(team.id, name)),
        format: (format) => this.store.setFormat(team.id, format),
        validate: () => this.validate(),
        delete: () => this.pressDelete(),
        edit: (index) => this.editSlot(index),
      });
    }
    this.drawBar(ctx);
    if (this.view !== 'edit') this.drawLegend(ctx);
    if (this.view === 'validate' && team) this.validation.draw(ctx, team, () => this.showSlot(this.teamView.slot));

    if (this.leaving) {
      const t = Math.min(1, (now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        this.leaving = null;
        void this.router.navigateByUrl('/');
      }
    }
    this.focus.end();
    renderer.end();
  }

  /**
   * The bar: where the page is after the title (the team, the Pokémon, the list open; no Back, the
   * legend has B), and on the right how many teams there are, which team this is (L/R go through
   * them), or the team's slots while editing one.
   */
  private drawBar(ctx: UiContext): void {
    const team = this.team();
    const page = { title: 'Teambuilder', icon: 'teambuilder' as const, back: () => this.onAction('back') };
    if (this.view === 'edit' && team) {
      this.bar.draw(ctx, { ...page, crumbs: this.editor.crumbs(), trailing: (c, right, cy) => this.editor.drawSlots(c, right, cy) });
    } else if (this.view !== 'teams' && team) {
      this.bar.draw(ctx, { ...page, crumbs: [team.name], trailing: (c, right, cy) => this.drawPlace(c, team.id, right, cy) });
    } else {
      const count = this.store.teams().length;
      const text = `${count} team${count === 1 ? '' : 's'}`;
      this.bar.draw(ctx, { ...page, crumbs: [], trailing: (c, right, cy) => right - label(c, text, right, cy, { size: 20 }, c.palette.muted, { align: 'right' }) });
    }
  }

  /** "L  Team 2 of 8  R": where the team is among them, in the grid's order; ends at `right`. */
  private drawPlace(ctx: UiContext, id: string, right: number, cy: number): number {
    const teams = inGridOrder(this.store.teams());
    const text = `Team ${teams.findIndex((team) => team.id === id) + 1} of ${teams.length}`;
    if (teams.length < 2) return right - label(ctx, text, right, cy, { size: 20 }, ctx.palette.muted, { align: 'right' });
    const rW = Math.max(34, ctx.text.measure('R', { size: 16, bold: true }) + 14);
    let x = right - rW;
    keyPill(ctx, 'R', x, cy);
    x -= 12 + label(ctx, text, x - 12, cy, { size: 20 }, ctx.palette.ink, { align: 'right' });
    x -= 12 + rW;
    keyPill(ctx, 'L', x, cy);
    return x;
  }

  /** The legend of the grid and the team (the editor draws its own); the grid's has the data on the right. */
  private drawLegend(ctx: UiContext): void {
    const p = ctx.palette;
    const focused = this.focus.focused ?? '';
    if (this.view === 'teams') {
      const cy = STAGE_H - LEGEND_H / 2 + 1;
      if (this.grid.isMoving()) {
        controlsLegend(ctx, [
          { keys: ['D-pad'], text: 'Move' },
          { keys: ['A'], text: 'Put down' },
          { keys: ['B'], text: 'Cancel' },
        ]);
        label(ctx, 'Moving the team: put it where you want it', EDIT_RIGHT, cy, { size: 18, bold: true }, p.accentText, { align: 'right' });
        return;
      }
      const team = this.store.team(this.grid.focusedTeam(this.store.teams()));
      const entries: LegendEntry[] = [
        { keys: ['A'], text: focused === NEW_TEAM_ID ? 'New team' : 'Open' },
        { keys: ['B'], text: 'Menu' },
      ];
      if (team) entries.push({ keys: ['ZL'], text: 'Move' }, { keys: ['R'], text: team.favourite ? 'Unfavourite' : 'Favourite' });
      entries.push({ keys: ['ZR'], text: 'Import PokePaste' });
      controlsLegend(ctx, entries);
      const notice = this.importNotice;
      if (notice?.at != null && ctx.now - notice.at > IMPORT_NOTICE_MS) this.importNotice = null;
      if (this.importNotice) label(ctx, this.importNotice.text, EDIT_RIGHT, cy, { size: 18, bold: true }, this.importNotice.error ? p.danger : p.accentText, { align: 'right', maxWidth: 720 });
      else if (this.store.saveFailed()) label(ctx, "Your last change couldn't be saved on this device.", EDIT_RIGHT, cy, { size: 18, bold: true }, p.danger, { align: 'right' });
      else label(ctx, this.dataSummary, EDIT_RIGHT, cy, { size: 18 }, p.muted, { align: 'right' });
      return;
    }
    if (this.view === 'validate') {
      controlsLegend(ctx, [{ keys: ['B'], text: 'Close' }]);
      return;
    }
    const sets = this.team()?.sets.length ?? 0;
    const action = focused === TEAM_RENAME_ID ? 'Rename' : focused === TEAM_FORMAT_ID ? 'Next format' : focused === slotId(sets) ? 'Add Pokémon' : 'Edit';
    const entries: LegendEntry[] = [
      { keys: ['A'], text: action },
      { keys: ['B'], text: 'Teams' },
    ];
    if (this.store.teams().length > 1) entries.push({ keys: ['L', 'R'], text: 'Other team' });
    entries.push({ keys: ['ZL'], text: 'Validate' }, { keys: ['ZR'], text: 'Hold to delete' });
    controlsLegend(ctx, entries);
  }
}
