import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { PageBar } from '@core/gl/ui/page-bar';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { AppSettings } from '@core/settings/app-settings';
import { SetEditorView } from '@features/teambuilder/gl/set-editor-view';
import { SpriteStage } from '@features/teambuilder/gl/sprite-stage';
import { EDIT_RIGHT, LEGEND_H, LegendEntry, controlsLegend } from '@features/teambuilder/gl/tb-draw';
import { NEW_TEAM_ID, TeamGridView, newestFirst } from '@features/teambuilder/gl/team-grid-view';
import { TEAM_FORMAT_ID, TEAM_RENAME_ID, TeamView, slotId } from '@features/teambuilder/gl/team-view';
import { VALIDATION_BACK_ID, ValidationView } from '@features/teambuilder/gl/validation-view';
import { TeamStore } from '@features/teambuilder/state/team-store';

type View = 'teams' | 'team' | 'validate' | 'edit';
const LEAVE_MS = 180;

/**
 * The Teambuilder, drawn on the stage, in two pages: the teams as cards in a grid (New team first),
 * and a team, as the games' party screen (the focused Pokémon's card on the left, its six slots as
 * rows beside it; Rename and the format in its header, L/R go through the teams, Validate on ZL shows
 * the server's answer in a modal, Delete on ZR held down). One of its Pokémon being edited takes the
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

  private readonly focus = new CanvasFocus();
  /** The sprite's stage, the team's card's and the editor's: opening a Pokémon keeps it standing. */
  private readonly spriteStage = new SpriteStage();
  private readonly grid = new TeamGridView(this.focus);
  private readonly teamView = new TeamView(this.focus, this.spriteStage);
  private readonly validation = new ValidationView();

  private readonly selectedId = signal<string | null>(null);
  private readonly team = computed(() => this.store.team(this.selectedId()));
  private readonly editor = new SetEditorView(this.focus, this.team, () => this.showSlot(this.editor.index()), this.spriteStage);
  private view: View = 'teams';

  /** Which game data the teambuilder uses, and how recent it is. */
  private readonly dataSummary = `Reg M-C data: ${this.dex.allSpecies.length} Pokémon · ${this.dex.generated}`;
  private leaving: { at: number } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    // The grid opens on the most recently created team (teams are stored in creation order), or New.
    this.grid.focusTeam(this.store.teams(), this.store.teams().at(-1)?.id ?? null);
    // On a team L/R go through the teams, ZL validates and ZR deletes it; in the editor L/R switch
    // Details/Stats (or a list's filters), ZL picks No item/No move (on Stats it undoes the points)
    // and ZR removes the Pokémon.
    const release = [
      this.navigation.registerButton('buttonZL', () => {
        if (this.leaving) return true;
        if (this.view === 'team') return this.validate();
        return this.view === 'edit' && this.editor.pressClear();
      }),
      this.navigation.registerButton('buttonZR', () => {
        if (this.leaving) return true;
        if (this.view === 'team') return this.pressDelete();
        return this.view === 'edit' && this.editor.pressRemove();
      }),
      this.navigation.registerButton('buttonL', () => this.pressLR(-1)),
      this.navigation.registerButton('buttonR', () => this.pressLR(1)),
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
      else if (this.view === 'teams') this.grid.jump(action, this.store.teams().length);
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
        return this.leave();
    }
  }

  /** L/R: the team before or after this one (as the grid has them); in the editor, its tabs or filters. */
  private pressLR(by: 1 | -1): boolean {
    if (this.leaving) return true;
    if (this.view === 'edit') return this.editor.pressLR(by);
    if (this.view !== 'team') return false;
    const teams = newestFirst(this.store.teams());
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

  private editSlot(index: number): void {
    this.teamView.reset();
    this.view = 'edit';
    this.editor.open(index);
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
    const card = newestFirst(this.store.teams()).findIndex((team) => team.id === id) + 1;
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
      this.grid.draw(ctx, { teams: this.store.teams(), create: () => this.createTeam(), open: (id) => this.openTeam(id) });
    } else if (this.view === 'edit' && team) {
      this.editor.draw(ctx);
    } else if (team) {
      this.teamView.draw(ctx, team, this.place(team.id), {
        rename: () => this.teamView.rename(team, (name) => this.store.rename(team.id, name)),
        format: (format) => this.store.setFormat(team.id, format),
        validate: () => this.validate(),
        delete: () => this.pressDelete(),
        edit: (index) => this.editSlot(index),
      });
    }
    this.bar.draw(ctx, { title: 'Teambuilder', icon: 'teambuilder', back: () => this.onAction('back') });
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

  /** "2 / 8": where the team is among them, in the grid's order. */
  private place(id: string): string {
    const teams = newestFirst(this.store.teams());
    return `${teams.findIndex((team) => team.id === id) + 1} / ${teams.length}`;
  }

  /** The legend of the grid and the team (the editor draws its own); the grid's has the data on the right. */
  private drawLegend(ctx: UiContext): void {
    const p = ctx.palette;
    const focused = this.focus.focused ?? '';
    if (this.view === 'teams') {
      controlsLegend(ctx, [
        { keys: ['A'], text: focused === NEW_TEAM_ID ? 'New team' : 'Open' },
        { keys: ['B'], text: 'Menu' },
      ]);
      const cy = STAGE_H - LEGEND_H / 2 + 1;
      if (this.store.saveFailed()) label(ctx, "Your last change couldn't be saved on this device.", EDIT_RIGHT, cy, { size: 18, bold: true }, p.danger, { align: 'right' });
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
