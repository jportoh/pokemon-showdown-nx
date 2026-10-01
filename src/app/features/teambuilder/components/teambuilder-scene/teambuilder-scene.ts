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
import { PANEL_X, TOP } from '@features/teambuilder/gl/tb-draw';
import { NEW_TEAM_ID, TeamListView } from '@features/teambuilder/gl/team-list-view';
import { TeamView, slotId } from '@features/teambuilder/gl/team-view';
import { VALIDATION_BACK_ID, ValidationView } from '@features/teambuilder/gl/validation-view';
import { TeamStore } from '@features/teambuilder/state/team-store';

type View = 'empty' | 'team' | 'validate' | 'edit';
const LEAVE_MS = 180;

/**
 * The Teambuilder, drawn on the stage: the teams on the left (New builds an empty one), and the panel
 * beside them showing the team picked (its six slots, its format, Rename, Validate on ZL, Delete on
 * ZR), one of its Pokémon being edited (the Details cards with their lists, or the Stats; L/R switch
 * them, ZL picks No item/No move, ZR removes it), or what the server said of it. B goes back a step:
 * from the editor or the validation to the team, from the team to the list, from the list to the menu.
 */
@Component({
  selector: 'app-teambuilder-scene',
  host: { class: 'block' },
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
  private readonly list = new TeamListView(this.focus);
  private readonly teamView = new TeamView(this.focus);
  private readonly validation = new ValidationView();

  // Opens on the most recently created team (teams are stored in creation order), if there is one.
  private readonly selectedId = signal<string | null>(this.store.teams().at(-1)?.id ?? null);
  private readonly team = computed(() => this.store.team(this.selectedId()));
  private readonly editor = new SetEditorView(this.focus, this.team, () => this.showSlot(this.editor.index()));
  private view: View = this.selectedId() ? 'team' : 'empty';

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
    this.focus.focus(this.view === 'team' ? slotId(0) : NEW_TEAM_ID);
    // On a team ZL validates and ZR deletes it; in the editor L/R switch Details/Stats (or set a stat's
    // points while its panel is open), ZL picks No item/No move and ZR removes the Pokémon.
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
      this.navigation.registerButton('buttonL', () => this.view === 'edit' && this.editor.pressLR(-1)),
      this.navigation.registerButton('buttonR', () => this.view === 'edit' && this.editor.pressLR(1)),
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
      else if (this.list.hasFocus()) this.list.jump(action, this.store.teams().length);
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private back(): void {
    switch (this.view) {
      case 'edit':
        return this.editor.back();
      case 'validate':
        return this.showSlot(0);
      case 'team':
        if (!this.list.hasFocus()) return this.list.focusTeam(this.store.teams(), this.selectedId());
        return this.leave();
      default:
        return this.leave();
    }
  }

  /** Opens a team with the focus on its first slot. */
  private selectTeam(id: string): void {
    if (id !== this.selectedId()) this.teamView.reset();
    this.selectedId.set(id);
    this.showSlot(0);
  }

  /** A new empty team with a default name, so building one starts without typing anything. */
  private createTeam(): void {
    const id = this.store.create(this.store.nextUntitledName(), this.settings.settings().teamFormat, []);
    this.selectTeam(id);
    this.list.focusTeam(this.store.teams(), id);
    this.focus.focus(slotId(0));
  }

  /** The team, on a slot (the one being edited, or the next one if it was removed). */
  private showSlot(index: number): void {
    this.view = this.team() ? 'team' : 'empty';
    this.focus.focus(this.view === 'team' ? slotId(Math.min(index, this.team()?.sets.length ?? 0)) : NEW_TEAM_ID);
  }

  private editSlot(index: number): void {
    this.teamView.reset();
    this.view = 'edit';
    this.editor.open(index);
  }

  /** ZL: checks the team against its format on the server; the panel shows the answer when it comes. */
  private validate(): boolean {
    const team = this.team();
    if (!team) return false;
    this.teamView.reset();
    this.validation.validate(team);
    this.view = 'validate';
    this.focus.focus(VALIDATION_BACK_ID);
    return true;
  }

  /** ZR: deleting can't be undone, so the first press only asks for confirmation. */
  private pressDelete(): boolean {
    const team = this.team();
    if (!team) return false;
    if (this.teamView.pressDelete(team) === 'deleted') {
      this.store.remove(team.id);
      this.selectedId.set(null);
      this.view = 'empty';
      this.focus.focus(NEW_TEAM_ID);
    }
    return true;
  }

  private leave(): void {
    this.leaving ??= { at: performance.now() };
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    // The team went away (deleted): nothing left to show but the list.
    if (this.view !== 'empty' && !this.team()) this.view = 'empty';
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.bar.draw(ctx, { title: 'Teambuilder', icon: 'teambuilder', back: () => this.onAction('back') });
    renderer.rect(PANEL_X, TOP, STAGE_W - PANEL_X, STAGE_H - TOP, { fill: p.bg });
    this.list.draw(ctx, {
      teams: this.store.teams(),
      selectedId: this.selectedId(),
      dataSummary: this.dataSummary,
      interactive: this.view === 'empty' || this.view === 'team',
      create: () => this.createTeam(),
      select: (id) => this.selectTeam(id),
    });

    const team = this.team();
    if (this.view === 'team' && team) {
      this.teamView.draw(ctx, team, {
        rename: () => this.teamView.rename(team, (name) => this.store.rename(team.id, name)),
        format: (format) => this.store.setFormat(team.id, format),
        validate: () => this.validate(),
        delete: () => this.pressDelete(),
        edit: (index) => this.editSlot(index),
      });
    } else if (this.view === 'edit' && team) {
      this.editor.draw(ctx);
    } else if (this.view === 'validate' && team) {
      this.validation.draw(ctx, team, () => this.showSlot(0));
    } else {
      label(ctx, 'Select a team, or build a new one with New.', PANEL_X + 32, TOP + 44, { size: 18 }, p.muted);
      if (this.store.saveFailed()) label(ctx, "Your last change couldn't be saved on this device.", PANEL_X + 32, TOP + 80, { size: 16, bold: true }, p.danger);
    }

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
}
