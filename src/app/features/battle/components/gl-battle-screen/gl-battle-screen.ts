import { drawWaiting } from '@core/gl/ui/waiting';
import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { BATTLE_SHORTCUTS, ROLE_KEYS } from '@core/input/console-keys';
import { CanvasFocus, isDirection } from '@core/gl/canvas-ui';
import { withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { HoldAction } from '@core/gl/ui/hold-action';
import { menuPanel } from '@core/gl/ui/menu-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { CameraFocus, REST_FOCUS } from '@features/battle/gl/battle-camera';
import { BattleFieldScene, FIELD_PARTS } from '@features/battle/gl/battle-field-scene';
import { FIELD_H, FIELD_TOP, FIELD_W } from '@features/battle/gl/field-layout';
import { BattleMenuView, MENU_PREFIX, MenuState } from '@features/battle/gl/screen/battle-menu-view';
import { ForfeitState, HeaderView } from '@features/battle/gl/screen/header-view';
import { CARD_CLOSE_ID, TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { CARD_PREFIX, INFO_TABS, InfoTab, InfoView } from '@features/battle/gl/screen/info-view';
import { TeamsOverviewView, chatText } from '@features/battle/gl/screen/overlay-views';
import { LEAVE_CONFIRM_IDS, LeaveKind, drawLeaveConfirm } from '@features/battle/gl/screen/leave-confirm-view';
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
 * R (Mega/Tera) is BattleScreen's, but Done in team preview; the menu (+), the field view
 * (Y), the party screen (X), the timer (−) and the last turn's log (L held) are this
 * screen's (the chat is written from Battle info's log), and the mouse clicks what's under it. L3 + R3 show the frame-time diagnostics (the stage's), with its own lines.
 */
@Component({
  selector: 'app-gl-battle-screen',
  template: '',
})
export class GlBattleScreen {
  /** Forfeit's state: BattleScreen forfeits once the menu's Forfeit row fills up (A held). */
  readonly forfeitState = input<ForfeitState>('idle');
  readonly canRematch = input(false);
  readonly rematchLabel = input('');
  readonly rematchNote = input('');
  /** Our battle's room is open but has nothing to show yet. */
  readonly joining = input(false);

  readonly again = output<void>();
  readonly leaveReplay = output<void>();
  readonly leaveLive = output<void>();
  readonly rematch = output<void>();
  readonly instantReplay = output<void>();
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
  private readonly theme = inject(GlTheme);

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
  /** The menu's rows held with A (Forfeit, accepting the team sheets), and which one is filling. */
  private readonly menuHold = new HoldAction(this.navigation, 'accept');
  private menuHoldRow: 'forfeit' | 'sheets' | null = null;
  private readonly menu = new BattleMenuView();
  /** The opponent's Trainer Card, from the menu. */
  private readonly card = new TrainerCardView(this.focus);

  /** The menu is open (+), and the focus under it when it opened. */
  private menuOpen = false;
  private focusBeforeMenu: string | null = null;
  /** The opponent's card is open over the battle (from the menu). */
  private cardOpen = false;
  /** B while watching asks first: leaving the replay or the live battle (null: not asking), and the focus under it. */
  private leaveAsk: LeaveKind | null = null;
  private focusBeforeLeave: string | null = null;
  /** The Pokémon on the field at a glance (Y), and the focus under it. */
  private fieldOpen = false;
  /** Team preview's whole sheet of a Pokémon (Y), over the picks. */
  private previewSheet = false;
  private focusBeforeField: string | null = null;

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
    // While leaving is being asked, the other buttons wait (the dialog takes them, doing nothing).
    const unlessAsking = (press: () => boolean) => () => this.leaveAsk !== null || press();
    const unregister = [
      this.navigation.registerButton('buttonZR', unlessAsking(() => this.pressInfo())),
      this.navigation.registerButton('buttonZL', unlessAsking(() => this.pressSheet())),
      // Team preview's picks, sent (Done): R, which BattleScreen (Mega, Tera) gets back outside team preview.
      this.navigation.registerButton(ROLE_KEYS.previewDone.button, () => !this.partyShown() && this.teamSelect.shown() && !this.menuOpen && !this.cardOpen && this.teamSelect.pressDone()),
      this.navigation.registerButton(ROLE_KEYS.battleMenu.button, unlessAsking(() => this.pressMenu())),
      this.navigation.registerButton(ROLE_KEYS.fieldView.button, unlessAsking(() => this.pressField())),
      // X opens the party screen, − turns the timer on or off, L held shows the last turn's log (drawn while it's held).
      this.navigation.registerButton(BATTLE_SHORTCUTS.party.button, () => this.pressParty()),
      this.navigation.registerButton(BATTLE_SHORTCUTS.timer.button, () => this.pressTimer()),
      this.navigation.registerButton(BATTLE_SHORTCUTS.log.button, () => this.store.turn() > 0),
    ];

    this.stage.whenReady((resources) => {
      this.field.attach(resources.renderer, resources.text, resources.images, resources.disc);
      this.ctx = { renderer: resources.renderer, text: resources.text, images: resources.images, focus: this.focus, disc: resources.disc, palette: this.theme.palette(), now: 0 };
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
    // Settings' look, light or dark (the menu can change it mid-battle).
    ctx.palette = this.theme.palette();
    const battle = this.store.battleId();
    if (battle !== this.shownBattle) {
      this.shownBattle = battle;
      this.infoTab = null;
      this.info.closeSheet();
      this.partyOpen = null;
      this.menuOpen = false;
      this.cardOpen = false;
      this.fieldOpen = false;
      this.previewSheet = false;
      this.leaveAsk = null;
    }
    // A chat message's time popped up runs from when it's said, whatever covers the field meanwhile.
    const pop = this.store.chatPop();
    if (pop && this.chatPop?.id !== pop.id) this.chatPop = { id: pop.id, since: now };
    renderer.beginPlain(INK.header);
    this.focus.begin();

    // The menu's held rows: Forfeit, and accepting the team sheets (ZL held does that too).
    const held = this.menuHoldRow;
    const holdAllowed = this.menuOpen && this.focus.focused === `${MENU_PREFIX}${held}` && (held === 'forfeit' ? this.canForfeit() : this.sheetButton() === 'accept');
    if (this.menuHold.step(now, holdAllowed) && held) {
      this.menuHoldRow = null;
      if (held === 'forfeit') {
        this.forfeit.emit();
        this.closeMenu();
      } else {
        this.store.acceptTeamSheets();
      }
    }
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
      menuOpen: this.menuOpen,
      toggleMenu: () => (this.menuOpen ? this.closeMenu() : this.openMenu()),
      fieldOpen: this.fieldOpen,
      // The field view once the battle is on (not during team preview).
      toggleField: this.store.started() && !picking ? () => this.pressField() : null,
      // L held: the last turn's log, once there's a turn to look back on.
      logHeld: this.store.turn() > 0 && !covered && !party ? this.navigation.isHeld(BATTLE_SHORTCUTS.log.button) : null,
      forfeitState: this.forfeitState(),
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
        instantReplay: () => this.instantReplay.emit(),
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
    // The preview's sheet goes with team preview (the battle starting, Battle info opened over it).
    if (this.previewSheet && (!picking || !this.info.sheetOpen())) this.previewSheet = false;
    if (this.infoTab) this.info.draw(ctx, this.infoTab, this.sheetHint());
    else if (this.previewSheet) {
      this.focus.begin();
      this.info.drawActive(ctx);
    } else if (this.fieldOpen) {
      this.focus.begin();
      this.info.drawActive(ctx);
    } else if (!covered && !party && this.navigation.isHeld(BATTLE_SHORTCUTS.log.button)) {
      this.drawLogPeek(ctx);
    }
    if (this.cardOpen) {
      this.focus.begin();
      this.card.draw(ctx, () => this.closeCard());
    } else if (this.menuOpen) {
      this.focus.begin();
      this.menu.draw(ctx, this.menuState());
    } else if (this.leaveAsk) {
      this.focus.begin();
      drawLeaveConfirm(ctx, this.leaveAsk, { stay: () => this.closeLeaveAsk(), leave: () => this.confirmLeave() });
    }
    this.header.drawCountdown(ctx);
    // Also while team preview's teams have come but not yet our request to pick ours (its log plays
    // first): the empty field showed for a moment before the team select.
    const awaitingPick = !this.store.watching() && this.store.teamPreview() && !this.teamSelect.shown() && !this.store.result();
    if (this.joining() || awaitingPick) {
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: ctx.palette.bg });
      drawWaiting(ctx, 'Joining battle', STAGE_W / 2, 360, { size: 32 });
    }
    // Live battles (ours or watched): the connection being got back, over everything.
    const notice = this.store.replay() ? null : connectionNotice(this.connection.state(), this.login.state(), Date.now());
    if (notice) this.drawConnectionNotice({ ...ctx, text: frame.overlayText }, notice);
    mark = this.timeSection('overlays', mark);

    this.focus.end();
    if (!this.menuOpen && !this.cardOpen && !this.fieldOpen && !this.leaveAsk) this.settleFocus(picking, party);
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
    const p = ctx.palette;
    const style = { size: 22, bold: true };
    const w = Math.min(STAGE_W - 80, ctx.text.measure(notice, style) + 64);
    const box = { x: (STAGE_W - w) / 2, y: FIELD.y + 16, w, h: 52 };
    ctx.renderer.rect(box.x, box.y + 8, box.w, box.h, { fill: [0, 0, 0, 0.25], radius: 26, softness: 16 });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.teal, radius: 26, border: 3 });
    write(ctx, notice, STAGE_W / 2, box.y + box.h / 2, style, p.ink, 'center', box.w - 32);
  }

  /**
   * L held: the last turn's log over the field, in a panel at its top, to read again what
   * happened (the bar only shows the latest message). While a turn plays, that turn so far.
   */
  private drawLogPeek(ctx: ScreenContext): void {
    const p = ctx.palette;
    const log = this.store.log().filter((entry) => entry.kind !== 'chat');
    const turns = log.flatMap((entry, i) => (entry.kind === 'turn' ? [i] : []));
    const last = turns[turns.length - 1] ?? 0;
    // The latest turn's header with nothing after it yet (we're choosing): the turn before it.
    const entries = last === log.length - 1 ? log.slice(turns[turns.length - 2] ?? 0, last) : log.slice(last);
    const box = { x: 160, y: FIELD.y + 14, w: 960, h: 0 };
    const lines: { text: string; bold: boolean; color: typeof p.ink }[] = [];
    for (const entry of entries) {
      const style = entry.kind === 'turn' ? { size: 20, bold: true } : { size: entry.kind === 'minor' ? 16 : 18 };
      const color = entry.kind === 'minor' ? p.muted : entry.kind === 'result' ? p.teal : p.ink;
      for (const text of ctx.text.wrap(entry.text, style, box.w - 48)) lines.push({ text, bold: entry.kind === 'turn', color });
    }
    const shown = lines.slice(-14);
    box.h = 56 + shown.length * 26;
    menuPanel(ctx, box, undefined, 0.96);
    const keyW = write(ctx, `${BATTLE_SHORTCUTS.log.label} held`, box.x + 24, box.y + 24, { size: 13, bold: true }, p.muted);
    write(ctx, 'LAST TURN', box.x + 36 + keyW, box.y + 24, { size: 13, bold: true }, p.muted);
    if (shown.length === 0) write(ctx, 'Nothing has happened yet.', box.x + 24, box.y + 64, { size: 18 }, p.muted);
    shown.forEach((line, i) => write(ctx, line.text, box.x + 24, box.y + 56 + i * 26, { size: line.bold ? 20 : 18, bold: line.bold }, withAlpha(line.color, 1), 'left', box.w - 48));
  }

  /** What the menu shows of the battle (the settings it reads itself). */
  private menuState(): MenuState {
    const watching = this.store.watching();
    const until = this.store.timerCooldownUntil();
    const canTimer = this.store.canToggleTimer() && !this.store.result() && !this.store.lost();
    const sheets = this.sheetButton();
    return {
      timer: canTimer ? { on: !!this.store.battleTimer(), cooldown: until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0 } : null,
      toggleTimer: () => this.toggleTimer.emit(),
      sheets: watching ? null : sheets,
      sheetsProgress: this.menuHoldRow === 'sheets' ? this.menuHold.progress : 0,
      pressSheets: () => {
        if (sheets === 'accept') {
          this.menuHoldRow = 'sheets';
          this.menuHold.press();
        } else if (sheets === 'sheet') {
          this.closeMenu();
          this.openInfo('p2');
        }
      },
      rival: watching ? '' : this.store.sides().p2.name,
      openCard: () => {
        this.cardOpen = true;
        this.card.open(this.store.sides().p2.name, CARD_CLOSE_ID);
      },
      forfeit: this.canForfeit() || this.forfeitState() === 'forfeiting' ? { progress: this.menuHoldRow === 'forfeit' ? this.menuHold.progress : 0, forfeiting: this.forfeitState() === 'forfeiting' } : null,
      pressForfeit: () => {
        if (!this.canForfeit()) return;
        this.menuHoldRow = 'forfeit';
        this.menuHold.press();
      },
    };
  }

  private canForfeit(): boolean {
    return !this.store.result() && !this.store.lost() && !this.store.watching() && this.forfeitState() === 'idle';
  }

  /** +: the menu, or closed again (team preview too: Done is R). */
  private pressMenu(): boolean {
    if (this.cardOpen) this.closeCard();
    else if (this.menuOpen) this.closeMenu();
    else this.openMenu();
    return true;
  }

  private openMenu(): void {
    if (this.menuOpen) return;
    this.focusBeforeMenu = this.focus.focused;
    this.menuOpen = true;
    this.menuHold.reset();
    this.menuHoldRow = null;
    this.focus.focus(`${MENU_PREFIX}music`);
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menuHold.reset();
    this.menuHoldRow = null;
    this.focus.focus(this.focusBeforeMenu);
  }

  /** The rival's card closes back to the menu, on its row. */
  private closeCard(): void {
    this.cardOpen = false;
    this.focus.focus(`${MENU_PREFIX}card`);
  }

  /** Y: the Pokémon on the field, or closed again. */
  private pressField(): boolean {
    if (this.teamSelect.shown() && !this.partyShown()) return this.togglePreviewSheet();
    if (!this.store.started() || this.menuOpen || this.cardOpen) return this.store.started();
    if (this.fieldOpen) {
      this.closeField();
      return true;
    }
    this.infoTab = null;
    this.info.closeSheet();
    this.focusBeforeField = this.focus.focused;
    this.fieldOpen = true;
    this.focus.focus(this.info.firstActiveId());
    return true;
  }

  /** Y in team preview: the whole sheet of the Pokémon in focus (ours with exact stats), or closed again. */
  private togglePreviewSheet(): boolean {
    if (this.menuOpen || this.cardOpen || this.infoTab) return false;
    if (this.previewSheet) {
      this.closePreviewSheet();
      return true;
    }
    const target = this.teamSelect.memberInFocus(this.focus.focused);
    if (!target) return false;
    this.focusBeforeField = this.focus.focused;
    this.info.openSheet(target.side, target.index);
    this.previewSheet = this.info.sheetOpen();
    return this.previewSheet;
  }

  private closePreviewSheet(): void {
    this.previewSheet = false;
    this.info.closeSheet();
    this.focus.focus(this.focusBeforeField);
  }

  private closeField(): void {
    this.fieldOpen = false;
    this.info.closeSheet();
    this.focus.focus(this.focusBeforeField);
  }

  /**
   * X: while choosing a move, the party screen to switch (as A on Switch), or closed again.
   * A forced switch has it open already.
   */
  private pressParty(): boolean {
    if (this.store.watching() || this.menuOpen || this.cardOpen || this.fieldOpen || this.infoTab) return false;
    if (!this.playPanel.choosing() || this.choices.pendingMove()) return false;
    if (this.partyShown()) {
      this.partyOpen = null;
      this.choices.notice.set('');
    } else {
      this.partyOpen = this.choices.slot();
    }
    return true;
  }

  /** −: the battle timer on or off. */
  private pressTimer(): boolean {
    if (!this.store.canToggleTimer() || this.store.result() || this.store.lost()) return false;
    this.toggleTimer.emit();
    return true;
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
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y + 6, box.w, box.h, { fill: [0, 0, 0, 0.2], radius: 20, softness: 12 });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: withAlpha(p.panel, 0.95), stroke: entry.author ? p.accentText : p.rim, radius: 20, border: 2 });
    const cy = box.y + box.h / 2;
    let x = box.x + 16;
    if (entry.author) x += write(ctx, `${entry.author}:`, x, cy, style, p.accentText, 'left', box.w - 32);
    write(ctx, `${entry.author ? ' ' : ''}${entry.text}`, x, cy, style, entry.author ? p.ink : p.muted, 'left', box.x + box.w - 16 - x);
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
    // Over everything: the rival's card, the menu, the Pokémon on the field (each B closes).
    if (this.cardOpen || this.menuOpen || this.leaveAsk) {
      if (action === 'back') {
        if (this.cardOpen) this.closeCard();
        else if (this.menuOpen) this.closeMenu();
        else this.closeLeaveAsk();
      } else if (isDirection(action)) this.focus.move(action);
      else if (action === 'accept') this.focus.accept();
      return true;
    }
    if (this.previewSheet) {
      if (action === 'back') this.closePreviewSheet();
      else if (action === 'left' || action === 'right') this.info.stepSheet(action === 'left' ? -1 : 1);
      return true;
    }
    if (this.fieldOpen) {
      if (this.info.sheetOpen()) {
        if (action === 'back') this.focus.focus(this.info.closeSheet());
        else if (action === 'left' || action === 'right') this.info.stepSheet(action === 'left' ? -1 : 1);
      } else if (action === 'back') this.closeField();
      else if (isDirection(action)) this.focus.move(action);
      else if (action === 'accept') this.focus.accept();
      return true;
    }
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

  /** B: closes or steps back from whatever is in front; watching, it asks before leaving. */
  private pressBack(): void {
    if (this.store.watching()) {
      this.focusBeforeLeave = this.focus.focused;
      this.leaveAsk = this.store.instantReplay() ? 'instant' : this.store.replay() ? 'replay' : 'live';
      this.focus.focus(LEAVE_CONFIRM_IDS.stay);
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

  private closeLeaveAsk(): void {
    this.leaveAsk = null;
    this.focus.focus(this.focusBeforeLeave);
  }

  /** Leave in the dialog: the replay or the live battle is left (an instant replay, for the battle's end). */
  private confirmLeave(): void {
    const kind = this.leaveAsk;
    this.leaveAsk = null;
    this.focusBeforeLeave = null;
    if (kind === 'live') this.leaveLive.emit();
    else this.leaveReplay.emit();
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
  /** The diagnostics' own lines (L3 + R3): where the frame's time goes, on average since the last time. */
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
