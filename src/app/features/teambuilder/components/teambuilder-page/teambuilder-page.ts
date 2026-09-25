import { Component, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { TeamDetail } from '@features/teambuilder/components/team-detail/team-detail';
import { TeamExport } from '@features/teambuilder/components/team-export/team-export';
import { ImportedTeam, TeamImport } from '@features/teambuilder/components/team-import/team-import';
import { SetEditor } from '@features/teambuilder/components/set-editor/set-editor';
import { TeamList } from '@features/teambuilder/components/team-list/team-list';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { DEFAULT_TEAM_FORMAT } from '@shared/data/formats';
import { BackAction } from '@shared/directives/back-action';

type PanelView = 'empty' | 'team' | 'import' | 'export' | 'edit';

/** Where focus goes once a panel switch has rendered, so it isn't lost when views swap. */
type FocusTarget = 'newTeam' | 'teamList' | 'slot' | 'exportButton' | 'importForm' | 'exportText' | 'editor';

@Component({
  imports: [TeamList, TeamDetail, TeamImport, TeamExport, SetEditor, BackAction],
  selector: 'app-teambuilder-page',
  host: { class: 'relative block h-[644px] w-[1280px]' },
  templateUrl: './teambuilder-page.html',
})
export class TeambuilderPage {
  protected readonly store = inject(TeamStore);
  private readonly list = viewChild.required(TeamList);
  private readonly detail = viewChild.required(TeamDetail);
  private readonly importer = viewChild.required(TeamImport);
  private readonly exporter = viewChild.required(TeamExport);
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
      else if (target === 'exportButton') this.detail().focusExport();
      else if (target === 'importForm') this.importer().open();
      else if (target === 'exportText') this.exporter().focusText();
      else if (target === 'editor') this.editor().opened();
    });
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

  protected startImport(): void {
    this.show('import', 'importForm');
  }

  protected finishImport(team: ImportedTeam): void {
    const id = this.store.create(team.name, team.format, team.sets);
    this.selectedId.set(id);
    this.showSlot(0);
  }

  protected cancelImport(): void {
    this.show(this.selectedTeam() ? 'team' : 'empty', 'newTeam');
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

  protected showExport(): void {
    this.show('export', 'exportText');
  }

  protected closeExport(): void {
    this.show('team', 'exportButton');
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
