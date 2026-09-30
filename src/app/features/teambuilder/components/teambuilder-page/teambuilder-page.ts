import { Component, DestroyRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { TeamDetail } from '@features/teambuilder/components/team-detail/team-detail';
import { SetEditor } from '@features/teambuilder/components/set-editor/set-editor';
import { TeamList } from '@features/teambuilder/components/team-list/team-list';
import { TeamValidationPanel } from '@features/teambuilder/components/team-validation-panel/team-validation-panel';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { DEFAULT_TEAM_FORMAT } from '@shared/data/formats';
import { BackAction } from '@shared/directives/back-action';

type PanelView = 'empty' | 'team' | 'validate' | 'edit';

/** Where focus goes once a panel switch has rendered, so it isn't lost when views swap. */
type FocusTarget = 'newTeam' | 'teamList' | 'slot' | 'validationBack' | 'editor';

@Component({
  imports: [TeamList, TeamDetail, TeamValidationPanel, SetEditor, BackAction],
  selector: 'app-teambuilder-page',
  host: { class: 'relative block h-[644px] w-[1280px] bg-retro-bg text-retro-ink' },
  templateUrl: './teambuilder-page.html',
})
export class TeambuilderPage {
  protected readonly store = inject(TeamStore);
  private readonly list = viewChild.required(TeamList);
  private readonly detail = viewChild.required(TeamDetail);
  private readonly validator = viewChild.required(TeamValidationPanel);
  private readonly editor = viewChild.required(SetEditor);

  // Opens on the most recently created team (teams are stored in creation order), if there is one.
  private readonly lastCreatedId = this.store.teams().at(-1)?.id ?? null;
  protected readonly view = signal<PanelView>(this.lastCreatedId ? 'team' : 'empty');
  protected readonly selectedId = signal<string | null>(this.lastCreatedId);
  protected readonly selectedTeam = computed(() => this.store.team(this.selectedId()));
  protected readonly editIndex = signal(0);

  private pendingFocus: FocusTarget | null = null;
  /** The slot card to focus for the 'slot' target. */
  private focusSlotIndex = 0;
  // Bumped with every panel switch, so focus moves even when the view stays the same (another team).
  private readonly focusRequest = signal(0);

  constructor() {
    afterRenderEffect(() => {
      this.focusRequest();
      const target = this.pendingFocus;
      this.pendingFocus = null;
      if (target === 'newTeam') this.list().focusNewTeam();
      else if (target === 'teamList') this.list().focusSelected();
      else if (target === 'slot') this.detail().focusSlot(this.focusSlotIndex);
      else if (target === 'validationBack') this.validator().focusBack();
      else if (target === 'editor') this.editor().opened();
    });

    // The panels stay mounted, so the buttons go to the one shown: on a team ZL validates and ZR
    // deletes it; in the editor L/R switch Details/Stats, ZL picks No item/No move in their lists and ZR
    // removes the Pokémon.
    const navigation = inject(KeyboardNavigation);
    const unregister = [
      navigation.registerButton('buttonZL', () => {
        if (this.view() === 'team') return this.detail().pressValidate();
        return this.view() === 'edit' && this.editor().pressClear();
      }),
      navigation.registerButton('buttonZR', () => {
        if (this.view() === 'team') return this.detail().pressDelete();
        return this.view() === 'edit' && this.editor().pressRemove();
      }),
      navigation.registerButton('buttonL', () => this.view() === 'edit' && this.editor().switchTab('details')),
      navigation.registerButton('buttonR', () => this.view() === 'edit' && this.editor().switchTab('stats')),
    ];
    inject(DestroyRef).onDestroy(() => unregister.forEach((fn) => fn()));
  }

  /** Opens a team with focus on its first slot; B goes back to the list. */
  protected selectTeam(id: string): void {
    this.selectedId.set(id);
    this.showSlot(0);
  }

  /** A new empty team with a default name, so building one starts without typing anything. */
  protected createTeam(): void {
    const id = this.store.create(this.store.nextUntitledName(), DEFAULT_TEAM_FORMAT, []);
    this.selectedId.set(id);
    this.showSlot(0);
  }

  protected editSlot(index: number): void {
    this.editIndex.set(index);
    this.show('edit', 'editor');
  }

  /** Back to the team, on the slot that was being edited (or the next one, if it was removed). */
  protected closeEditor(): void {
    this.showSlot(this.editIndex());
  }

  protected focusTeamList(): void {
    this.show(this.view(), 'teamList');
  }

  protected renameTeam(name: string): void {
    const id = this.selectedId();
    if (id) this.store.rename(id, name);
  }

  protected changeFormat(format: string): void {
    const id = this.selectedId();
    if (id) this.store.setFormat(id, format);
  }

  protected deleteTeam(): void {
    const id = this.selectedId();
    if (!id) return;
    this.store.remove(id);
    this.selectedId.set(null);
    this.show('empty', 'newTeam');
  }

  /** Checks the team against its format on the server; the panel shows the answer when it comes. */
  protected showValidation(): void {
    this.validator().validate();
    this.show('validate', 'validationBack');
  }

  /** Back to the team, on its first slot: Validate is ZL, not a d-pad stop. */
  protected closeValidation(): void {
    this.showSlot(0);
  }

  private showSlot(index: number): void {
    this.focusSlotIndex = index;
    this.show('team', 'slot');
  }

  private show(view: PanelView, focus: FocusTarget | null = null): void {
    this.pendingFocus = focus;
    this.view.set(view);
    this.focusRequest.update((count) => count + 1);
  }
}
