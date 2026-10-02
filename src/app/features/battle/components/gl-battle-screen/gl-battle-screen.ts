import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { CanvasFocus, isDirection } from '@core/gl/canvas-ui';
import { GRAPH_COLORS, GlDiagnostics, LONG_FRAME_MS } from '@core/gl/gl-diagnostics';
import { GlRenderer, rgba } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { TextTextures } from '@core/gl/gl-textures';
import { SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { HoldAction } from '@core/gl/ui/hold-action';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { CameraFocus, REST_FOCUS } from '@features/battle/gl/battle-camera';
import { BattleFieldScene } from '@features/battle/gl/battle-field-scene';
import { FIELD_H, FIELD_TOP, FIELD_W } from '@features/battle/gl/field-layout';
import { ForfeitState, HeaderView } from '@features/battle/gl/screen/header-view';
import { INFO_TABS, InfoTab, InfoView } from '@features/battle/gl/screen/info-view';
import { TeamsOverviewView } from '@features/battle/gl/screen/overlay-views';
import { PartyView } from '@features/battle/gl/screen/party-view';
import { PlayPanelView, targetSlot } from '@features/battle/gl/screen/play-panel-view';
import { INK, ScreenContext, write } from '@features/battle/gl/screen/screen-context';
import { SideStripView } from '@features/battle/gl/screen/side-strip-view';
import { DONE_ID, SheetButton, TeamSelectView } from '@features/battle/gl/screen/team-select-view';
import { PANEL_IDS, WatchPanelView } from '@features/battle/gl/screen/watch-panel-view';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';

const FIELD = { x: 0, y: FIELD_TOP, w: FIELD_W, h: FIELD_H };

/**
 * The battle screen, drawn as a scene on the app's one canvas (GlStage), all 1280x720 of it: the top
 * bar, and under it the field (BattleFieldScene) over the whole stage, with each side's Poké Balls and
 * conditions by its status boxes. While we choose, the command panel rises over the field's foot
 * (moves, targets; Switch opens the party screen, as a forced switch does); while the turn plays, only
 * the message box; watching, a replay's or a live battle's controls. Over it all on request, Battle
 * info (ZR; ZL opens it on the opponent's team): both teams, the field's conditions and the log; and
 * team preview (picking ours, or a spectator's view of both) and "Joining battle…". The focus lives
 * in the canvas (CanvasFocus), the controller's d-pad, A and B come straight here (through the stage),
 * the page buttons (L Mega/Tera, R forfeit, R3 timer) stay BattleScreen's, and the mouse clicks what's
 * under it. R3 shows the frame-time diagnostics while it has no timer to toggle.
 */
@Component({
  selector: 'app-gl-battle-screen',
  template: '',
})
export class GlBattleScreen {
  /** Forfeit's state (R): BattleScreen forfeits once its hold fills up. */
  readonly forfeitState = input<ForfeitState>('idle');
  /** Forfeit's hold (R held down, BattleScreen's): stepped here every frame, `forfeit` emitted when full. */
  readonly forfeitHold = input<HoldAction | null>(null);
  readonly canRematch = input(false);
  readonly rematchLabel = input('');
  readonly rematchNote = input('');
  /** Our battle's room is open but has nothing to show yet. */
  readonly joining = input(false);

  readonly again = output<void>();
  readonly leaveReplay = output<void>();
  readonly leaveLive = output<void>();
  readonly rematch = output<void>();
  readonly leave = output<void>();
  /** B in our own battle, with nothing of the screen's own to close: takes back choices (BattleScreen.back). */
  readonly back = output<void>();
  readonly forfeit = output<void>();
  readonly toggleTimer = output<void>();

  private readonly store = inject(BattleStore);
  private readonly choices = inject(BattleChoices);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly stage = inject(GlStage);

  private readonly field = new BattleFieldScene();
  private readonly header = new HeaderView();
  private readonly strips = new SideStripView();
  private readonly watchPanel = new WatchPanelView();
  private readonly playPanel = new PlayPanelView();
  private readonly party = new PartyView();
  private readonly info = new InfoView();
  private readonly overview = new TeamsOverviewView();
  private readonly teamSelect = new TeamSelectView();
  private readonly focus = new CanvasFocus();

  /** Battle info's tab while it's open; null while it's closed. */
  private infoTab: InfoTab | null = null;
  /** The tab it opens on with ZR: the last one shown. */
  private lastTab: InfoTab = 'p2';
  /** Switch was pressed: the party screen is open (a forced switch opens it by itself). */
  private partyOpen = false;
  private diagnosticsShown = false;
  private ctx: ScreenContext | null = null;
  /** The panel's view last drawn, and its buttons, so a new view focuses its first. */
  private lastViewKey = '';
  private panelPicks: string[] = [];
  private teamSelectWasShown = false;
  private partyWasShown = false;
  /** The battle drawn last: a new one (a rematch, a set's next game) closes what was open over the old. */
  private shownBattle: unknown = null;

  /**
   * ZL's part with the opponent's open team sheet: agreeing to open team sheets while offered, or
   * waiting for the opponent to agree too; 'sheet' once it's here (it shows on their team's tab).
   */
  private readonly sheetButton = computed((): SheetButton | null => {
    if (this.store.teamSheets().p2) return 'sheet';
    if (this.store.watching()) return null;
    const offer = this.store.sheetOffer();
    return offer === 'offered' ? 'accept' : offer === 'accepted' ? 'waiting' : null;
  });

  constructor() {
    const unregister = [
      this.navigation.registerButton('buttonZR', () => this.pressInfo()),
      this.navigation.registerButton('buttonZL', () => this.pressSheet()),
      // R3 turns the battle timer on or off where there is one (BattleScreen's); otherwise, the diagnostics.
      this.navigation.registerButton('buttonR3', () => {
        if (this.store.canToggleTimer() && !this.store.result()) return false;
        this.diagnosticsShown = !this.diagnosticsShown;
        return true;
      }),
    ];

    this.stage.whenReady((resources) => {
      this.field.attach(resources.renderer, resources.text, resources.images, resources.disc);
      this.ctx = { renderer: resources.renderer, text: resources.text, images: resources.images, focus: this.focus, disc: resources.disc, now: 0 };
    });
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      // Browsers: the mouse points and clicks (the console has only the controller).
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });

    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      hide();
    });
  }

  private draw({ renderer, overlayText: hudText, now, dt }: StageFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.now = now;
    const battle = this.store.battleId();
    if (battle !== this.shownBattle) {
      this.shownBattle = battle;
      this.infoTab = null;
      this.partyOpen = false;
    }
    renderer.beginPlain(INK.header);
    this.focus.begin();

    const hold = this.forfeitHold();
    const canForfeit = !this.store.result() && !this.store.watching() && this.forfeitState() === 'idle';
    if (hold?.step(now, canForfeit)) this.forfeit.emit();
    // Over the field: the party screen, team preview (ours to pick, or a spectator's view of both), then Battle info.
    const party = this.partyShown();
    const picking = !party && this.teamSelect.shown();
    this.field.focusOn(this.cameraFocus(party || picking));
    renderer.setView(1, FIELD.x, FIELD.y);
    renderer.clip(FIELD);
    this.field.draw(renderer, now, dt);
    renderer.clip(null);
    renderer.setView(1, 0, 0);
    this.header.draw(ctx, {
      infoOpen: this.infoTab !== null,
      toggleInfo: () => this.pressInfo(),
      forfeitState: this.forfeitState(),
      forfeitProgress: hold?.progress ?? 0,
      forfeit: () => hold?.press(),
      toggleTimer: () => this.toggleTimer.emit(),
    });
    this.strips.draw(ctx);

    if (this.store.watching()) {
      this.panelPicks = [];
      this.watchPanel.draw(ctx, {
        again: () => this.again.emit(),
        leaveReplay: () => this.leaveReplay.emit(),
        leaveLive: () => this.leaveLive.emit(),
      });
    } else {
      this.panelPicks = this.playPanel.draw(ctx, {
        canRematch: this.canRematch(),
        rematchLabel: this.rematchLabel(),
        rematchNote: this.rematchNote(),
        rematch: () => this.rematch.emit(),
        leave: () => this.leave.emit(),
        openParty: () => (this.partyOpen = true),
      });
      this.drawTargetMark(ctx);
    }

    if (party) {
      // A fresh frame of controls: the party screen covers the rest, whose controls must not take the d-pad.
      this.focus.begin();
      this.party.draw(ctx, !this.choices.forceSwitch() || this.choices.canGoBack());
    } else if (picking) {
      this.focus.begin();
      const sheet = this.sheetButton();
      this.teamSelect.draw(ctx, sheet ? { button: sheet, press: () => this.pressSheet() } : null, () => this.focus.focus(DONE_ID));
    } else if (this.overview.shown()) {
      this.overview.draw(ctx);
    }
    if (this.infoTab) this.info.draw(ctx, this.infoTab, this.sheetHint());
    if (this.joining()) {
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: INK.header });
      write(ctx, 'Joining battle…', STAGE_W / 2, 360, { size: 36, bold: true }, INK.white, 'center');
    }
    if (this.diagnosticsShown) this.drawDiagnostics(renderer, hudText, now);

    this.focus.end();
    this.settleFocus(picking, party);
    renderer.end();
  }

  /** The party screen is up: a forced switch, or Switch pressed while choosing (a new choice closes it). */
  private partyShown(): boolean {
    if (this.choices.slot() === null || this.store.result() || this.store.watching()) {
      this.partyOpen = false;
      return false;
    }
    return this.choices.forceSwitch() || (this.partyOpen && this.playPanel.choosing() && !this.choices.pendingMove());
  }

  /**
   * What the field's camera looks at: one of ours choosing its move, or the target pointed at (the
   * opponent's side) while picking one; otherwise, at rest.
   */
  private cameraFocus(covered: boolean): CameraFocus {
    if (covered || this.store.watching() || !this.playPanel.choosing()) return REST_FOCUS;
    if (this.choices.pendingMove()) {
      const focused = this.focus.focused;
      return { kind: 'target', slot: focused?.startsWith('target-') ? targetSlot(Number(focused.slice('target-'.length))) : null };
    }
    return { kind: 'choose', slot: this.choices.slot() === 1 ? 'p1b' : 'p1a' };
  }

  /** The target pointed at in the picker: a bobbing arrow over it on the field. */
  private drawTargetMark(ctx: ScreenContext): void {
    const focused = this.focus.focused;
    if (!focused?.startsWith('target-') || !this.choices.pendingMove()) return;
    const area = this.field.spriteArea(targetSlot(Number(focused.slice('target-'.length))));
    if (!area) return;
    const x = area.left + area.size / 2;
    const y = FIELD.y + Math.max(24, area.top + area.size * 0.12) + Math.sin(ctx.now / 160) * 6;
    write(ctx, '▼', x + 2, y + 3, { size: 44, bold: true }, [0, 0, 0, 0.45], 'center');
    write(ctx, '▼', x, y, { size: 44, bold: true }, INK.yellow300, 'center');
  }

  /** What ZL does on the opponent's tab while open team sheets are being agreed. */
  private sheetHint(): string {
    const button = this.sheetButton();
    return button === 'accept' ? 'ZL Accept open team sheets' : button === 'waiting' ? 'Waiting for their answer on team sheets' : '';
  }

  /** Where the focus goes as views change: a new set of buttons focuses its first. */
  private settleFocus(picking: boolean, party: boolean): void {
    if (party) {
      const first = this.party.firstId();
      if (!this.partyWasShown && first) this.focus.focus(first);
      this.partyWasShown = true;
      return;
    }
    const partyClosed = this.partyWasShown;
    this.partyWasShown = false;
    if (picking) {
      if (!this.teamSelectWasShown) this.focus.focus(this.teamSelect.firstId);
      this.teamSelectWasShown = true;
      return;
    }
    this.teamSelectWasShown = false;
    if (this.store.watching()) {
      if (this.focus.focused === null || !this.focus.has(this.focus.focused)) {
        const first = this.store.replay() ? PANEL_IDS.play : PANEL_IDS.leaveLive;
        if (this.focus.has(first)) this.focus.focus(first);
      }
      return;
    }
    const key = this.playPanel.viewKey();
    if (key !== this.lastViewKey) {
      this.lastViewKey = key;
      this.partyOpen = false;
      if (this.panelPicks[0]) this.focus.focus(this.panelPicks[0]);
    } else if (partyClosed && this.focus.has('switch')) {
      // Back from the party screen: on Switch again.
      this.focus.focus('switch');
    }
    if ((this.focus.focused === null || !this.focus.has(this.focus.focused)) && this.panelPicks[0]) this.focus.focus(this.panelPicks[0]);
  }

  /** The controller's d-pad, A and B (everything else comes as page buttons). */
  private onAction(action: CanvasAction): boolean {
    if (this.infoTab) {
      if (action === 'back') this.infoTab = null;
      else if (action === 'left' || action === 'right') this.stepTab(action === 'left' ? -1 : 1);
      else if (this.infoTab === 'log' && (action === 'up' || action === 'down' || action === 'first' || action === 'last')) this.info.log.page(action, this.ctx);
      return true;
    }
    if (isDirection(action)) {
      this.focus.move(action);
      return true;
    }
    if (action === 'accept') return this.focus.accept();
    if (action === 'back') {
      this.pressBack();
      return true;
    }
    return false;
  }

  /** B: closes or steps back from whatever is in front. */
  private pressBack(): void {
    if (this.store.watching()) {
      if (this.store.replay()) this.leaveReplay.emit();
      else this.leaveLive.emit();
      return;
    }
    if (this.teamSelect.shown()) {
      this.teamSelect.undo();
      return;
    }
    // The party screen opened with Switch closes; a forced one steps back only when there's a choice to take back.
    if (this.partyOpen && !this.choices.forceSwitch()) {
      this.partyOpen = false;
      this.choices.notice.set('');
      return;
    }
    this.back.emit();
  }

  /** ZR: opens Battle info (on the tab last shown), or moves to the next tab. */
  private pressInfo(): boolean {
    if (this.infoTab) this.stepTab(1);
    else this.openInfo(this.lastTab);
    return true;
  }

  /** ZL: agrees to open team sheets while offered; otherwise the previous tab, or Battle info on the opponent's team. */
  private pressSheet(): boolean {
    if (this.sheetButton() === 'accept') {
      this.store.acceptTeamSheets();
      return true;
    }
    if (this.infoTab) this.stepTab(-1);
    else this.openInfo('p2');
    return true;
  }

  private openInfo(tab: InfoTab): void {
    this.infoTab = tab;
    this.lastTab = tab;
    if (tab === 'log') this.info.log.reset();
  }

  private stepTab(step: number): void {
    const index = INFO_TABS.indexOf(this.infoTab ?? this.lastTab);
    this.openInfo(INFO_TABS[(index + step + INFO_TABS.length) % INFO_TABS.length]);
  }

  private hudLines: string[] = [];
  private hudUpdated = 0;

  /** R3: frame rate, stutters and what came before them (Angular renders, uploads, images arriving). */
  private drawDiagnostics(renderer: GlRenderer, text: TextTextures, now: number): void {
    if (now - this.hudUpdated > 500) {
      this.hudUpdated = now;
      const frames = this.diagnostics.frameSummary();
      const render = this.diagnostics.summary('render');
      const uploads = this.diagnostics.summary('text');
      const arrivals = this.diagnostics.summary('arrival');
      const recent = this.diagnostics.frames.slice(-60);
      const average = recent.reduce((sum, f) => sum + f.interval, 0) / Math.max(1, recent.length);
      const fps = average > 0 ? Math.round(1000 / average) : 0;
      this.hudLines = [
        `Full canvas · ${fps} fps · ${frames.long} stutters (> ${LONG_FRAME_MS} ms) · worst ${Math.round(frames.worst)} ms`,
        `Angular renders: ${render.count}/s · longest ${render.max.toFixed(1)} ms`,
        `Text uploads: ${uploads.count}/s · longest ${uploads.max.toFixed(1)} ms`,
        `Images: ${this.bitmaps.queued} to load · ${arrivals.count}/s · our frame ${frames.ownAvg.toFixed(1)} ms (max ${frames.ownMax.toFixed(1)})`,
        `${this.field.particleCount} sparks · R3 hides this`,
      ];
    }
    const width = 380;
    const x = STAGE_W - width - 8;
    const y = 54;
    const graphTop = y + 6 + this.hudLines.length * 17;
    renderer.rect(x, y, width, graphTop - y + 80, { fill: [0, 0, 0, 0.7], radius: 8 });
    this.hudLines.forEach((line, i) => {
      const texture = text.get(line, { size: 12, bold: i === 0 });
      if (texture) renderer.image(texture, x + 8, y + 6 + i * 17, Math.min(1, (width - 16) / texture.width), i === 0 ? rgba('#a7f3d0') : INK.white);
    });
    const base = graphTop + 64;
    renderer.rect(x + 8, base - 16.7, 300, 1, { fill: [1, 1, 1, 0.3] });
    renderer.rect(x + 8, base - 33.3, 300, 1, { fill: [1, 0.4, 0.4, 0.4] });
    this.diagnostics.frames.forEach((f, i) => {
      const h = Math.min(60, f.interval);
      const color = f.interval <= 20 ? GRAPH_COLORS.good : f.interval <= LONG_FRAME_MS ? GRAPH_COLORS.slow : GRAPH_COLORS.long;
      renderer.rect(x + 8 + i * 2, base - h, 2, h, { fill: color });
      if (f.render) renderer.rect(x + 8 + i * 2, base + 2, 2, 3, { fill: GRAPH_COLORS.render });
      if (f.upload) renderer.rect(x + 8 + i * 2, base + 5, 2, 3, { fill: GRAPH_COLORS.upload });
      if (f.arrival) renderer.rect(x + 8 + i * 2, base + 8, 2, 3, { fill: GRAPH_COLORS.arrival });
    });
  }
}
