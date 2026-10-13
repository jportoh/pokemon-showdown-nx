import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { CanvasFocus, isDirection } from '@core/gl/canvas-ui';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { HoldAction } from '@core/gl/ui/hold-action';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { CameraFocus, REST_FOCUS } from '@features/battle/gl/battle-camera';
import { BattleFieldScene, FIELD_PARTS } from '@features/battle/gl/battle-field-scene';
import { FIELD_H, FIELD_TOP, FIELD_W } from '@features/battle/gl/field-layout';
import { ForfeitState, HeaderView } from '@features/battle/gl/screen/header-view';
import { CARD_PREFIX, INFO_TABS, InfoTab, InfoView } from '@features/battle/gl/screen/info-view';
import { TeamsOverviewView, chatText } from '@features/battle/gl/screen/overlay-views';
import { PartyView } from '@features/battle/gl/screen/party-view';
import { PlayPanelView, targetSlot } from '@features/battle/gl/screen/play-panel-view';
import { INK, ScreenContext, write } from '@features/battle/gl/screen/screen-context';
import { SideStripView } from '@features/battle/gl/screen/side-strip-view';
import { DONE_ID, SheetButton, TeamSelectView } from '@features/battle/gl/screen/team-select-view';
import { PANEL_IDS, WatchPanelView } from '@features/battle/gl/screen/watch-panel-view';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { connectionNotice } from '@features/connection/connection-notice';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';

const FIELD = { x: 0, y: FIELD_TOP, w: FIELD_W, h: FIELD_H };
/** How long a chat message stays popped up over the field. */
const CHAT_POP_MS = 6000;
const CHAT_POP_W = 480;
const MAX_CHAT_LENGTH = 300;
/** The parts of a frame the diagnostics time: field, top bar and labels, command panel, screens over it, GL flush. */
const SECTIONS = ['field', 'chrome', 'panel', 'overlays', 'flush'] as const;
type Section = (typeof SECTIONS)[number];

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
 * under it. L3 shows the frame-time diagnostics (the stage's), with its own lines.
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
  private readonly stage = inject(GlStage);
  private readonly connection = inject(ShowdownConnection);
  private readonly login = inject(ShowdownLogin);
  private readonly keyboard = inject(CanvasKeyboard);

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
  /** Accepting open team sheets, filling in green while ZL is held. */
  private readonly sheetHold = new HoldAction(this.navigation, 'buttonZL');

  /** Battle info's tab while it's open; null while it's closed. */
  private infoTab: InfoTab | null = null;
  /** The tab it opens on with ZR: the last one shown. */
  private lastTab: InfoTab = 'p2';
  /** The focus under Battle info when it opened, back when it closes. */
  private focusBeforeInfo: string | null = null;
  /** The slot Switch was pressed for: the party screen is open while it chooses (a forced switch opens it by itself). */
  private partyOpen: number | null = null;
  private ctx: ScreenContext | null = null;
  /** The panel's view last drawn, and its buttons, so a new view focuses its first. */
  private lastViewKey = '';
  private panelPicks: string[] = [];
  private teamSelectWasShown = false;
  private partyWasShown = false;
  /** The battle drawn last: a new one (a rematch, a set's next game) closes what was open over the old. */
  private shownBattle: unknown = null;
  /** The chat message popped up over the field, and since when. */
  private chatPop: { id: number; since: number } | null = null;

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
      // L sends team preview's picks (Done); while choosing moves it's BattleScreen's (Mega, Tera).
      this.navigation.registerButton('buttonL', () => !this.partyShown() && this.teamSelect.shown() && this.teamSelect.pressDone()),
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
      diagnostics: () => this.diagnosticLines(),
    });

    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      this.keyboard.close(null);
      hide();
    });
  }

  private draw(frame: StageFrame): void {
    const { renderer, now, dt } = frame;
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.now = now;
    const battle = this.store.battleId();
    if (battle !== this.shownBattle) {
      this.shownBattle = battle;
      this.infoTab = null;
      this.info.closeSheet();
      this.partyOpen = null;
    }
    // A chat message's time popped up runs from when it's said, whatever covers the field meanwhile.
    const pop = this.store.chatPop();
    if (pop && this.chatPop?.id !== pop.id) this.chatPop = { id: pop.id, since: now };
    renderer.beginPlain(INK.header);
    this.focus.begin();

    const hold = this.forfeitHold();
    const canForfeit = !this.store.result() && !this.store.lost() && !this.store.watching() && this.forfeitState() === 'idle';
    if (hold?.step(now, canForfeit)) this.forfeit.emit();
    if (this.sheetHold.step(now, this.sheetButton() === 'accept')) this.store.acceptTeamSheets();
    // Over the field: the party screen, team preview (ours to pick, or a spectator's view of both), then Battle info.
    const party = this.partyShown();
    const picking = !party && this.teamSelect.shown();
    // Battle info and team preview (ours or a spectator's) cover the whole field: it only keeps its clock going.
    const covered = this.infoTab !== null || picking || (!party && this.overview.shown());
    this.field.focusOn(this.cameraFocus(party || picking));
    let mark = performance.now();
    renderer.setView(1, FIELD.x, FIELD.y);
    renderer.clip(FIELD);
    this.field.draw(renderer, now, dt, covered);
    renderer.clip(null);
    renderer.setView(1, 0, 0);
    mark = this.timeSection('field', mark);
    this.header.draw(ctx, {
      infoOpen: this.infoTab !== null,
      toggleInfo: () => this.pressInfo(),
      forfeitState: this.forfeitState(),
      forfeitProgress: hold?.progress ?? 0,
      forfeit: () => hold?.press(),
      toggleTimer: () => this.toggleTimer.emit(),
    });
    if (!covered) {
      this.strips.draw(ctx);
      // The labels over the strips: a move's label by our left Pokémon sits where the opponent's are.
      renderer.setView(1, FIELD.x, FIELD.y);
      renderer.clip(FIELD);
      this.field.drawOver(renderer, now);
      renderer.clip(null);
      renderer.setView(1, 0, 0);
      this.drawChatPop(ctx);
    }
    mark = this.timeSection('chrome', mark);

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
        openParty: () => (this.partyOpen = this.choices.slot()),
      });
      this.drawTargetMark(ctx);
    }
    mark = this.timeSection('panel', mark);

    if (party) {
      // A fresh frame of controls: the party screen covers the rest, whose controls must not take the d-pad.
      this.focus.begin();
      this.party.draw(ctx, !this.choices.forceSwitch() || this.choices.canGoBack());
    } else if (picking) {
      this.focus.begin();
      const sheet = this.sheetButton();
      this.teamSelect.draw(ctx, sheet ? { button: sheet, press: () => this.pressSheet(), held: this.sheetHold.progress } : null, () => this.focus.focus(DONE_ID));
    } else if (this.overview.shown()) {
      // A spectator's team preview covers the watch panel, whose buttons must not take the d-pad.
      this.focus.begin();
      this.overview.draw(ctx);
    }
    if (this.infoTab) this.info.draw(ctx, this.infoTab, this.sheetHint());
    this.header.drawCountdown(ctx);
    if (this.joining()) {
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: INK.header });
      write(ctx, 'Joining battle…', STAGE_W / 2, 360, { size: 36, bold: true }, INK.white, 'center');
    }
    // Live battles (ours or watched): the connection being got back, over everything.
    const notice = this.store.replay() ? null : connectionNotice(this.connection.state(), this.login.state(), Date.now());
    if (notice) this.drawConnectionNotice({ ...ctx, text: frame.overlayText }, notice);
    mark = this.timeSection('overlays', mark);

    this.focus.end();
    this.settleFocus(picking, party);
    mark = performance.now();
    renderer.end();
    this.timeSection('flush', mark);
    this.timedFrames++;
  }

  /** Adds the time since `since` to a part of the frame (the diagnostics' breakdown); returns now. */
  private timeSection(section: Section, since: number): number {
    const now = performance.now();
    this.sectionTotals[section] += now - since;
    return now;
  }

  /**
   * The connection dropped: a dark banner under the top bar, edged in yellow, saying why and when the
   * next try is. Its text changes every second, so it's drawn with the stage's overlay text cache.
   */
  private drawConnectionNotice(ctx: ScreenContext, notice: string): void {
    const style = { size: 22, bold: true };
    const w = Math.min(STAGE_W - 80, ctx.text.measure(notice, style) + 64);
    const box = { x: (STAGE_W - w) / 2, y: FIELD.y + 16, w, h: 52 };
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: INK.dark, stroke: INK.yellow300, radius: 10, border: 3 });
    write(ctx, notice, STAGE_W / 2, box.y + box.h / 2, style, INK.yellow100, 'center', box.w - 32);
  }

  /**
   * The latest chat message, for a few seconds after it's said: a bubble at the top right of the field,
   * one line ("Jorge: gg", the rest cut). The whole chat is in Battle info's log.
   */
  private drawChatPop(ctx: ScreenContext): void {
    const entry = this.store.chatPop();
    if (!entry || !this.chatPop || ctx.now - this.chatPop.since > CHAT_POP_MS) return;
    const style = { size: 20 };
    const w = Math.min(CHAT_POP_W, ctx.text.measure(chatText(entry), style) + 32);
    const box = { x: STAGE_W - 16 - w, y: FIELD.y + 54, w, h: 40 };
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0.06, 0.09, 0.16, 0.9], stroke: entry.author ? INK.sky300 : INK.gray500, radius: 10, border: 2 });
    const cy = box.y + box.h / 2;
    let x = box.x + 16;
    if (entry.author) x += write(ctx, `${entry.author}:`, x, cy, style, INK.sky300, 'left', box.w - 32);
    write(ctx, `${entry.author ? ' ' : ''}${entry.text}`, x, cy, style, entry.author ? INK.white : INK.gray300, 'left', box.x + box.w - 16 - x);
  }

  /** Battle info's log, A: the keyboard over the battle for a chat message; OK says it. */
  private writeChat(): void {
    this.keyboard.open({
      label: 'Message to the battle chat',
      value: '',
      maxLength: MAX_CHAT_LENGTH,
      done: (value) => {
        if (value === null) return;
        this.store.sendChat(value);
        // Back to the newest entries, where it shows once the server echoes it.
        this.info.log.reset();
      },
    });
  }

  /** The party screen is up: a forced switch, or Switch pressed while choosing (a new choice closes it). */
  private partyShown(): boolean {
    if (this.choices.slot() === null || this.store.result() || this.store.watching()) {
      this.partyOpen = null;
      return false;
    }
    return this.choices.forceSwitch() || (this.partyOpen !== null && this.partyOpen === this.choices.slot() && this.playPanel.choosing() && !this.choices.pendingMove());
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
    return button === 'accept' ? 'Hold ZL to accept open team sheets' : button === 'waiting' ? 'Waiting for their answer on team sheets' : '';
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
    if (this.overview.shown()) {
      if (!this.overview.owns(this.focus.focused)) this.focus.focus(this.overview.firstId);
      return;
    }
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
      this.partyOpen = null;
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
      if (this.info.sheetOpen()) {
        if (action === 'back') this.focus.focus(this.info.closeSheet());
        else if (action === 'left' || action === 'right') this.info.stepSheet(action === 'left' ? -1 : 1);
        return true;
      }
      const team = this.infoTab === 'p1' || this.infoTab === 'p2' ? this.infoTab : null;
      if (action === 'back') this.closeInfo();
      else if (team && isDirection(action)) this.moveOnTeam(team, action);
      else if (team && action === 'accept') this.focus.accept();
      else if (action === 'left' || action === 'right') this.stepTab(action === 'left' ? -1 : 1);
      else if (this.infoTab === 'log' && (action === 'up' || action === 'down' || action === 'first' || action === 'last')) this.info.log.page(action, this.ctx);
      else if (this.infoTab === 'log' && action === 'accept' && this.store.canChat()) this.writeChat();
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
    if (this.partyOpen !== null && !this.choices.forceSwitch()) {
      this.partyOpen = null;
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

  /**
   * ZL: held down, agrees to open team sheets while offered (it can't be taken back); otherwise the
   * previous tab, or Battle info on the opponent's team.
   */
  private pressSheet(): boolean {
    if (this.sheetButton() === 'accept') {
      this.sheetHold.press();
      return true;
    }
    if (this.infoTab) this.stepTab(-1);
    else this.openInfo('p2');
    return true;
  }

  private openInfo(tab: InfoTab): void {
    // Where the focus was under it, to go back to when it closes.
    if (this.infoTab === null) this.focusBeforeInfo = this.focus.focused;
    this.info.closeSheet();
    this.infoTab = tab;
    this.lastTab = tab;
    if (tab === 'log') this.info.log.reset();
    if (tab === 'p1' || tab === 'p2') this.focus.focus(`${CARD_PREFIX}${tab}-0`);
  }

  private closeInfo(): void {
    this.infoTab = null;
    this.info.closeSheet();
    this.focus.focus(this.focusBeforeInfo);
  }

  /**
   * The d-pad on a team's tab: between its cards (two columns); left or right past the edge goes to the
   * tab that way, landing on the card nearest the one left, in the same row.
   */
  private moveOnTeam(team: 'p1' | 'p2', direction: 'up' | 'down' | 'left' | 'right'): void {
    if (this.focus.move(direction, (control) => control.id.startsWith(`${CARD_PREFIX}${team}-`))) return;
    if (direction !== 'left' && direction !== 'right') return;
    const index = Number(this.focus.focused?.slice(`${CARD_PREFIX}${team}-`.length) ?? 0) || 0;
    this.stepTab(direction === 'left' ? -1 : 1);
    const next = this.infoTab;
    if (next === 'p1' || next === 'p2') this.focus.focus(`${CARD_PREFIX}${next}-${Math.floor(index / 2) * 2 + (direction === 'left' ? 1 : 0)}`);
  }

  private stepTab(step: number): void {
    const index = INFO_TABS.indexOf(this.infoTab ?? this.lastTab);
    this.openInfo(INFO_TABS[(index + step + INFO_TABS.length) % INFO_TABS.length]);
  }

  private readonly sectionTotals: Record<Section, number> = { field: 0, chrome: 0, panel: 0, overlays: 0, flush: 0 };
  private timedFrames = 0;
  /** The diagnostics' own lines (L3): where the frame's time goes, on average since the last time. */
  private diagnosticLines(): string[] {
    const timed = Math.max(1, this.timedFrames);
    const breakdown = SECTIONS.map((section) => `${section} ${(this.sectionTotals[section] / timed).toFixed(1)}`).join(' · ');
    SECTIONS.forEach((section) => (this.sectionTotals[section] = 0));
    const fieldBreakdown = FIELD_PARTS.map((part) => `${part} ${(this.field.timings[part] / timed).toFixed(1)}`).join(' · ');
    FIELD_PARTS.forEach((part) => (this.field.timings[part] = 0));
    this.timedFrames = 0;
    return [`ms/frame: ${breakdown}`, `field: ${fieldBreakdown}`, `${this.field.particleCount} sparks`];
  }
}
