import { Component, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { TeamDetail } from '@features/teambuilder/components/team-detail/team-detail';
import { TeamExport } from '@features/teambuilder/components/team-export/team-export';
import { ImportedTeam, TeamImport } from '@features/teambuilder/components/team-import/team-import';
import { SetEditor } from '@features/teambuilder/components/set-editor/set-editor';
import { TeamList } from '@features/teambuilder/components/team-list/team-list';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { DEFAULT_TEAM_FORMAT } from '@shared/data/formats';

type PanelView = 'empty' | 'team' | 'import' | 'export' | 'edit';

/** Where focus goes once a panel switch has rendered, so it isn't lost when views swap. */
type FocusTarget = 'newTeam' | 'teamHeading' | 'importForm' | 'exportText' | 'editor';

@Component({
  imports: [TeamList, TeamDetail, TeamImport, TeamExport, SetEditor],
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

  protected readonly view = signal<PanelView>('empty');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedTeam = computed(() => this.store.team(this.selectedId()));
  protected readonly editIndex = signal(0);

  private pendingFocus: FocusTarget | null = null;

  constructor() {
    afterRenderEffect(() => {
      this.view();
      const target = this.pendingFocus;
      this.pendingFocus = null;
      if (target === 'newTeam') this.list().focusNewTeam();
      else if (target === 'teamHeading') this.detail().focusHeading();
      else if (target === 'importForm') this.importer().open();
      else if (target === 'exportText') this.exporter().focusText();
      else if (target === 'editor') this.editor().opened();
    });
  }

  protected selectTeam(id: string): void {
    this.selectedId.set(id);
    this.show('team');
  }

  /** A new empty team with a default name, so building one starts without typing anything. */
  protected createTeam(): void {
    const id = this.store.create(this.store.nextUntitledName(), DEFAULT_TEAM_FORMAT, []);
    this.selectedId.set(id);
    this.show('team', 'teamHeading');
  }

  protected editSlot(index: number): void {
    this.editIndex.set(index);
    this.show('edit', 'editor');
  }

  protected closeEditor(): void {
    this.show('team', 'teamHeading');
  }

  protected startImport(): void {
    this.show('import', 'importForm');
  }

  protected finishImport(team: ImportedTeam): void {
    const id = this.store.create(team.name, team.format, team.sets);
    this.selectedId.set(id);
    this.show('team', 'teamHeading');
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
    this.show('team', 'teamHeading');
  }

  private show(view: PanelView, focus: FocusTarget | null = null): void {
    this.pendingFocus = focus;
    this.view.set(view);
  }
}
