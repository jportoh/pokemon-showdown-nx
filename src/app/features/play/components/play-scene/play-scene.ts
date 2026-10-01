import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { speciesInfo } from '@core/dex/species';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { maskOf } from '@core/gl/ui/masks';
import { OptionPickerView } from '@core/gl/ui/option-picker';
import { PageBar } from '@core/gl/ui/page-bar';
import { Box, UiContext, button, focusRing, label, modal, paragraph, pill, retroBox } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { BOX as CARD_BOX } from '@features/home/gl/login-view';
import { ChallengeFormView, ChallengePopupView, POPUP_CARD_ID, PopupModel } from '@features/play/gl/challenge-views';
import { PreviewCard, drawTeamPreview } from '@features/play/gl/team-preview-view';
import { PlaySelection } from '@features/play/state/play-selection';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { MAX_TEAM_SIZE } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { PickerOption } from '@core/gl/ui/option-picker';
import { PLAYABLE_FORMATS } from '@shared/data/formats';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

/** What's on top: a challenger's card, their challenge, a list or the form opened, else the page. */
type Layer = 'card' | 'popup' | 'picker' | 'form' | 'page';
/** The page's controls focus goes back to once the page shows again. */
type PageControl = 'format' | 'team' | 'challenge' | 'battle';

const FORMAT_OPTIONS: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
  id: format.id,
  title: format.label,
  detail: format.detail,
  category: format.category,
}));

/** The page's three boxes (the DOM page's, 76px lower: under the bar). */
const SELECT_BOX: Box = { x: 32, y: 100, w: 440, h: 296 };
const ACTION_BOX: Box = { x: 32, y: 412, w: 440, h: 284 };
const PREVIEW_BOX: Box = { x: 496, y: 100, w: 752, h: 596 };
const LEAVE_MS = 180;
/** The selectors' ▼ (7x4) and the team's ◀ ▶ (4x7). */
const DOWN = ['xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
const LEFT = ['...x', '..xx', '.xxx', 'xxxx', '.xxx', '..xx', '...x'];
const RIGHT = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/**
 * The Battle page, drawn on the stage: pick a format and a team and search Showdown's ladder for an
 * opponent (BATTLE!, which cancels the search while it runs; a match opens the battle, see App), or
 * send and answer challenges. On the left the format and the team (each opens a list to pick from;
 * L/R also step through the teams) over the actions; on the right the team picked, large. Challenges
 * that arrive show in a box over the page (B leaves one for later, and a button brings it back), as do
 * the lists, the form to challenge someone and a challenger's Trainer Card.
 */
@Component({
  selector: 'app-play-scene',
  host: { class: 'block' },
  template: '',
})
export class PlayScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly session = inject(BattleSession);
  private readonly teamStore = inject(TeamStore);
  private readonly dex = inject(ChampionsDex);
  private readonly challenges = inject(ShowdownChallenges);
  private readonly rooms = inject(BattleRooms);
  private readonly connection = inject(ShowdownConnection);
  private readonly login = inject(ShowdownLogin);
  private readonly search = inject(ShowdownSearch);
  private readonly selection = inject(PlaySelection);

  private readonly focus = new CanvasFocus();
  private readonly picker = new OptionPickerView(this.focus);
  private readonly popup = new ChallengePopupView(this.focus);
  private readonly form = new ChallengeFormView(this.focus);
  private readonly card = new TrainerCardView(this.focus);

  private readonly format = this.selection.playFormat;
  private readonly randomTeams = computed(() => this.format().randomTeams);
  private readonly teams = this.selection.teams;
  private readonly chosenTeam = this.selection.team;

  private readonly teamOptions = computed((): PickerOption[] =>
    this.teams().map((team) => ({
      id: team.id,
      title: team.name,
      detail: `${team.sets.length} Pokémon`,
      sprites: team.sets.map((set) => this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species)),
    })),
  );

  private readonly teamPosition = computed(() => {
    const teams = this.teams();
    const index = teams.findIndex((team) => team.id === this.chosenTeam()?.id);
    return teams.length > 1 ? `${index + 1} of ${teams.length} teams` : 'Your only team for this format';
  });

  /** Six cards; null for an empty slot (or a "?" one with random teams). */
  private readonly cards = computed((): (PreviewCard | null)[] => {
    const sets = this.randomTeams() ? [] : (this.chosenTeam()?.sets ?? []);
    const cards = sets.slice(0, MAX_TEAM_SIZE).map((set): PreviewCard => {
      const info = speciesInfo(set.species);
      return {
        // Holding its Mega Stone, it shows as the Mega it becomes.
        sprite: this.dex.mega(set.species, set.item)?.sprite ?? this.dex.species(set.species)?.sprite ?? spriteId(set.species),
        species: info?.name ?? set.species,
        types: (info?.types ?? []).map((name) => ({ name, color: typeColor(name) || '#4b5563' })),
        item: set.item,
        itemId: this.dex.item(set.item)?.id ?? toId(set.item),
      };
    });
    return [...cards, ...Array<null>(MAX_TEAM_SIZE - cards.length).fill(null)];
  });

  /** Connected with a name: Showdown only lets named players search. */
  private readonly online = computed(() => this.login.state().status === 'named' && this.connection.state().status === 'connected');
  /** A ladder search is under way (in any format: the home screen's Random Battle searches too). */
  private readonly searching = computed(() => this.search.searching() !== null);
  private readonly hasTeam = computed(() => this.randomTeams() || this.chosenTeam() !== null);
  /** BATTLE! searches (online, with a team for the format), cancels the search, or goes back to the open battle. */
  private readonly canBattle = computed(() => this.session.active() || this.searching() || (this.online() && this.hasTeam()));

  /** Under BATTLE!: what it does now, or what it's waiting for. */
  private readonly battleLine = computed(() => {
    if (this.session.active()) return 'Back to your battle';
    if (this.rooms.joining()) return 'Joining battle…';
    if (this.searching()) return 'Searching for an opponent…';
    if (!this.hasTeam()) return 'Build a team for this format first';
    const status = this.login.state().status;
    if (status === 'offline') return 'Connect from the home menu first';
    if (status === 'unavailable') return 'No name on Showdown: online battles unavailable';
    if (!this.online()) return 'Connecting to Showdown…';
    return 'Find an opponent on the ladder';
  });
  private readonly canCycle = computed(() => !this.randomTeams() && this.teams().length > 1);

  // The challenge panel, under BATTLE! (ChallengePanel).
  /** Our name once the server calls us by it, for other players to challenge. */
  private readonly name = computed(() => (this.online() ? this.login.state().name : null));
  private readonly statusText = computed(() => {
    const login = this.login.state();
    if (login.status === 'offline') return 'Offline';
    if (login.status === 'unavailable') return 'Online battles unavailable';
    if (this.connection.state().status !== 'connected') return 'Connecting to Showdown…';
    return 'Getting a name on Showdown…';
  });
  /** A guest can ask for another random name once connected, unless one is being claimed right now. */
  private readonly canRename = computed(
    () => this.connection.state().status === 'connected' && this.login.state().mode === 'guest' && ['named', 'unavailable'].includes(this.login.state().status),
  );
  private readonly problem = computed(() => {
    const login = this.login.state();
    // The ladder search's refusal (BATTLE! has no room for it) shows here too.
    return login.status === 'unavailable' ? login.error : (this.search.error() ?? this.challenges.error());
  });
  private readonly hintText = computed(() => {
    const outgoing = this.challenges.outgoing();
    if (this.login.state().status === 'offline') return 'Connect from the menu to send and receive challenges.';
    const problem = this.problem();
    if (problem) return problem;
    if (outgoing) return `Waiting for ${outgoing.to} to accept your ${PLAYABLE_FORMATS.find((f) => f.id === outgoing.format)?.label ?? outgoing.format} challenge…`;
    if (this.postponedCount() > 0) return `${this.challenges.incoming()[0]?.from ?? 'A player'} is waiting for your answer.`;
    return 'Players can challenge this name, or challenge one yourself in the format picked.';
  });

  /** Challenges left for later (by the challenger's ID): no box for them until asked for. */
  private readonly postponed = signal<readonly string[]>([]);
  private readonly unanswered = computed(() => this.challenges.incoming().filter((challenge) => !this.postponed().includes(challenge.fromId)));
  /** The challenge in the box: the one accepted while its battle opens, else the next one unanswered. */
  private readonly popupChallenge = computed(() => this.challenges.accepted() ?? this.unanswered()[0] ?? null);
  /** The teams the challenge on show can be accepted with (its format's, or the one it borrows them from). */
  private readonly popupTeams = computed(() => {
    const challenge = this.popupChallenge();
    if (!challenge?.needsTeam) return [];
    const teamFormat = PLAYABLE_FORMATS.find((format) => format.id === challenge.format)?.teamFormat ?? challenge.format;
    return this.teamStore.teams().filter((team) => team.format === teamFormat && team.sets.length > 0);
  });
  private readonly waitingBehind = computed(() => Math.max(0, this.unanswered().length - (this.challenges.accepted() ? 0 : 1)));
  private readonly postponedCount = computed(() => this.challenges.incoming().length - this.unanswered().length);

  private formOpen = false;
  private cardOpen = false;
  private lastLayer: Layer = 'page';
  /** Where the focus goes when the page shows again. */
  private returnTo: PageControl = 'battle';
  private leaving: { at: number; path: string } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.focusPage();
    const release = [
      this.navigation.registerButton('buttonL', () => this.pressLR(-1)),
      this.navigation.registerButton('buttonR', () => this.pressLR(1)),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
    });
  }

  private layer(): Layer {
    if (this.cardOpen) return 'card';
    if (this.popupChallenge()) return 'popup';
    if (this.picker.isOpen) return 'picker';
    if (this.formOpen) return 'form';
    return 'page';
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    const layer = this.layer();
    if (layer === 'picker') {
      const used = this.picker.input(action);
      if (used !== null) return used;
    }
    if (action === 'back') {
      if (layer === 'card') this.closeCard();
      else if (layer === 'popup') this.postpone();
      else if (layer === 'form') this.closeForm();
      else if (layer === 'page') this.leave('/');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  /** L/R: the picker's pages, the challenge's team, or the page's team (wrapping around). */
  private pressLR(by: 1 | -1): boolean {
    const layer = this.layer();
    if (layer === 'picker') return this.picker.page(by);
    if (layer === 'popup') return this.popupModel() !== null && this.popup.cycle(this.popupModel()!, by);
    if (layer !== 'page' || !this.canCycle() || this.searching()) return false;
    const teams = this.teams();
    const index = teams.findIndex((team) => team.id === this.chosenTeam()?.id);
    this.selection.teamId.set(teams[(index + by + teams.length) % teams.length].id);
    return true;
  }

  private openPicker(which: 'format' | 'team'): void {
    this.returnTo = which;
    if (which === 'format') {
      this.picker.open('Pick a format', FORMAT_OPTIONS, this.format().id, (id) => this.selection.format.set(id));
    } else {
      this.picker.open('Pick a team', this.teamOptions(), this.chosenTeam()?.id ?? null, (id) => this.selection.teamId.set(id));
    }
  }

  private openForm(): void {
    this.returnTo = 'challenge';
    this.formOpen = true;
    this.form.open();
  }

  private closeForm(): void {
    this.formOpen = false;
  }

  private postpone(): void {
    const challenge = this.popupChallenge();
    if (!challenge || this.popup.joining(challenge)) return;
    // Unless another box is open under it, the focus goes to the button that brings it back.
    if (!this.picker.isOpen && !this.formOpen) this.returnTo = 'challenge';
    this.postponed.update((ids) => [...ids, challenge.fromId]);
  }

  private openCard(name: string): void {
    this.cardOpen = true;
    this.card.open(name);
  }

  /** Back to the challenge, on the button that opened the card. */
  private closeCard(): void {
    this.cardOpen = false;
    this.focus.focus(POPUP_CARD_ID);
  }

  /**
   * Searches the ladder in the format picked, with the team picked (none in random formats), or cancels
   * the search under way. A battle still open takes this button back to it.
   */
  private battle(): void {
    if (this.session.active()) {
      void this.router.navigateByUrl('/battle');
      return;
    }
    // A match was found: its battle opens by itself.
    if (this.rooms.joining()) return;
    if (this.searching()) {
      this.search.cancel();
      return;
    }
    if (!this.canBattle()) return;
    const team = this.chosenTeam();
    this.search.search(this.format().id, team ? packTeam(team.sets) : null);
  }

  private leave(path: string): void {
    this.leaving ??= { at: performance.now(), path };
  }

  /** The page shows again: the control that opened the box, or the nearest one that works. */
  private focusPage(): void {
    const enabled: Record<PageControl, boolean> = {
      format: !this.searching(),
      team: !this.searching() && !this.randomTeams(),
      challenge: this.challenges.outgoing() !== null || this.postponedCount() > 0 || this.name() !== null,
      battle: this.canBattle(),
    };
    const order: PageControl[] = [this.returnTo, 'battle', 'team', 'format'];
    this.focus.focus(order.find((control) => enabled[control]) ?? 'format');
    this.returnTo = 'battle';
  }

  private popupModel(): PopupModel | null {
    const challenge = this.popupChallenge();
    if (!challenge) return null;
    return {
      challenge,
      waiting: this.waitingBehind(),
      teams: this.popupTeams(),
      preferredTeam: this.selection.teamId(),
      viewCard: () => this.openCard(challenge.from),
    };
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    const layer = this.layer();
    if (layer !== this.lastLayer) {
      if (layer === 'page') this.focusPage();
      if (layer === 'picker' && this.lastLayer === 'popup') this.picker.focusSelected();
      if (this.lastLayer === 'popup' && layer !== 'card') this.popup.reset();
      this.lastLayer = layer;
    }
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.bar.draw(ctx, { title: 'Battle', icon: 'battle', back: () => this.onAction('back') });
    this.drawSelectors(ctx);
    this.drawActions(ctx);
    this.drawPreview(ctx);

    if (layer === 'picker') this.picker.draw(ctx);
    else if (layer === 'form') this.form.draw(ctx, this.format(), this.chosenTeam(), () => this.closeForm());
    else if (layer === 'popup') this.popup.draw(ctx, this.popupModel()!);
    else if (layer === 'card') {
      modal(ctx, CARD_BOX);
      this.card.draw(ctx, () => this.closeCard());
    }

    if (this.leaving) {
      const t = Math.min(1, (now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        const path = this.leaving.path;
        this.leaving = null;
        void this.router.navigateByUrl(path);
      }
    }
    this.focus.end();
    renderer.end();
  }

  /** The format and team selectors: the choice, its detail and a ▼ to open its list. */
  private selector(ctx: UiContext, id: string, y: number, title: string, detail: string, disabled: boolean, accept: () => void, arrow = true): void {
    const p = ctx.palette;
    const box = { x: SELECT_BOX.x + 12, y, w: 410, h: 84 };
    const focused = !disabled && ctx.focus.control({ id, ...box, accept });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
    label(ctx, title, box.x + 18, box.y + 26, { size: 24, bold: true }, disabled ? p.muted : p.ink, { maxWidth: arrow ? 330 : 370 });
    label(ctx, detail, box.x + 18, box.y + 58, { size: 16 }, p.muted, { maxWidth: arrow ? 330 : 370 });
    if (arrow) ctx.renderer.image(maskOf(ctx.renderer, DOWN), box.x + 366, box.y + 34, 4, disabled ? p.muted : p.accentText);
    if (focused) focusRing(ctx, box);
  }

  private drawSelectors(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    retroBox(ctx, SELECT_BOX);
    const x = SELECT_BOX.x;
    const y = SELECT_BOX.y;
    const searching = this.searching();
    label(ctx, 'FORMAT', x + 20, y + 26, { size: 20, bold: true }, p.muted);
    this.selector(ctx, 'format', y + 44, this.format().label, this.format().detail, searching, () => this.openPicker('format'));

    label(ctx, 'TEAM', x + 20, y + 162, { size: 20, bold: true }, p.muted);
    if (this.canCycle()) {
      pill(ctx, 'L', x + 274, y + 162, 28);
      renderer.image(maskOf(renderer, LEFT), x + 330, y + 155, 2, p.muted);
      renderer.image(maskOf(renderer, RIGHT), x + 354, y + 155, 2, p.muted);
      pill(ctx, 'R', x + 382, y + 162, 28);
    }
    const team = this.chosenTeam();
    if (this.randomTeams()) {
      renderer.rect(x + 12, y + 180, 410, 84, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 6, border: 2 });
      label(ctx, 'Random team', x + 30, y + 206, { size: 24, bold: true }, p.ink);
      label(ctx, 'Showdown hands each player one', x + 30, y + 238, { size: 16 }, p.muted);
    } else if (team) {
      this.selector(ctx, 'team', y + 180, team.name, this.teamPosition(), searching, () => this.openPicker('team'));
    } else {
      this.selector(ctx, 'team', y + 180, 'No teams yet', 'Build one in the Teambuilder', false, () => {
        this.navigation.focusPageAfterNavigation();
        this.leave('/teambuilder');
      }, false);
    }
  }

  private drawActions(ctx: UiContext): void {
    const p = ctx.palette;
    retroBox(ctx, ACTION_BOX);
    const x = ACTION_BOX.x + 12;
    const y = ACTION_BOX.y;

    // BATTLE!, big, with what it does now under it.
    const battle = { x, y: y + 14, w: 410, h: 96 };
    const enabled = this.canBattle();
    const focused = enabled && ctx.focus.control({ id: 'battle', ...battle, accept: () => this.battle() });
    ctx.renderer.rect(battle.x, battle.y, battle.w, battle.h, { fill: enabled ? p.accent : p.rim, stroke: enabled ? p.bar : p.outline, radius: 6, border: 2 });
    const ink = enabled ? ([1, 1, 1, 1] as const) : p.muted;
    label(ctx, this.searching() ? 'CANCEL' : 'BATTLE!', battle.x + battle.w / 2, battle.y + 36, { size: 48, bold: true }, ink, { align: 'center' });
    label(ctx, this.battleLine(), battle.x + battle.w / 2, battle.y + 74, { size: 16 }, ink, { align: 'center', maxWidth: 390 });
    if (focused) focusRing(ctx, battle);

    // The challenge panel.
    const top = y + 124;
    const panelButton = { x, y: top, w: 410, h: 52 };
    const outgoing = this.challenges.outgoing();
    const postponed = this.postponedCount();
    if (outgoing) {
      button(ctx, 'challenge', panelButton, 'Cancel challenge', { primary: true, size: 24, accept: () => this.challenges.cancelChallenge() });
    } else if (postponed > 0) {
      button(ctx, 'challenge', panelButton, `Answer challenge${postponed > 1 ? `s (${postponed})` : ''}`, { primary: true, size: 24, accept: () => this.postponed.set([]) });
    } else {
      button(ctx, 'challenge', panelButton, 'Challenge a player', { size: 24, disabled: !this.name(), accept: () => this.openForm() });
    }
    const name = this.name();
    if (name) {
      label(ctx, 'Name:', x, top + 82, { size: 18 }, p.muted);
      label(ctx, name, x + 72, top + 82, { size: 20, bold: true }, p.ink, { maxWidth: 218 });
    } else {
      label(ctx, this.statusText(), x, top + 82, { size: 18 }, p.muted, { maxWidth: 290 });
    }
    // A guest's name is random: another one, for when it's taken or blocked.
    if (this.canRename()) button(ctx, 'new-name', { x: x + 300, y: top + 66, w: 110, h: 32 }, 'New name', { size: 16, accept: () => this.login.newName() });
    const problem = this.problem();
    paragraph(ctx, this.hintText(), x, top + 104, 410, 22, { size: 14, bold: !!problem }, problem ? p.danger : p.muted, 2);
  }

  private drawPreview(ctx: UiContext): void {
    const p = ctx.palette;
    retroBox(ctx, PREVIEW_BOX);
    const title = this.randomTeams() ? 'Random team' : (this.chosenTeam()?.name ?? 'No team for this format');
    label(ctx, title, PREVIEW_BOX.x + 24, PREVIEW_BOX.y + 32, { size: 30, bold: true }, p.ink, { maxWidth: 440 });
    label(ctx, this.format().label, PREVIEW_BOX.x + 716, PREVIEW_BOX.y + 34, { size: 18 }, p.muted, { align: 'right', maxWidth: 236 });
    drawTeamPreview(ctx, PREVIEW_BOX.x + 15, PREVIEW_BOX.y + 68, this.cards(), this.randomTeams());
  }
}
