import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { speciesInfo } from '@core/dex/species';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { iconTexture, pixelTexture } from '@core/gl/gl-textures';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { OptionPickerView, PickerOption } from '@core/gl/ui/option-picker';
import { drawGround, drawSlantedButton, drawSprite } from '@core/gl/ui/menu-kit';
import { PageBar } from '@core/gl/ui/page-bar';
import { Box, UiContext, button, label, paragraph } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleRooms } from '@features/connection/battle-rooms';
import { connectionNotice } from '@features/connection/connection-notice';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { BALL } from '@features/home/gl/logo-ball';
import { ChallengeFormView, ChallengePopupView, POPUP_CARD_ID, PopupModel } from '@features/play/gl/challenge-views';
import { FormatCard, FormatCarouselView } from '@features/play/gl/format-carousel';
import { FormatGridView, formatTileId } from '@features/play/gl/format-grid';
import { ShowcaseTeam, TeamShowcaseView } from '@features/play/gl/team-showcase';
import { PlaySelection, preferredTeam } from '@features/play/state/play-selection';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { MAX_TEAM_SIZE } from '@features/teambuilder/models/team';
import { inGridOrder } from '@features/teambuilder/gl/team-grid-view';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { HOME_MENU_ITEMS } from '@features/home/state/home-menu';
import { PLAYABLE_FORMATS, PlayableFormat, RANDOM_PLAY_FORMATS, TEAM_PLAY_FORMATS } from '@shared/data/formats';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

/** What's on top: a challenger's card, their challenge, a list or the form opened, else the page. */
type Layer = 'card' | 'popup' | 'picker' | 'form' | 'page';
/** The page's controls focus goes back to once the page shows again. */
type PageControl = 'format' | 'team' | 'challenge' | 'battle';

function formatOptions(formats: readonly PlayableFormat[]): PickerOption[] {
  return formats.map((format) => ({ id: format.id, title: format.label, detail: format.detail, category: format.category }));
}

/** The actions along the foot: who's playing on the left, BATTLE! in the middle, challenges on the right. */
const BATTLE_BOX: Box = { x: 412, y: 590, w: 470, h: 108 };
const CHALLENGE_BOX: Box = { x: 906, y: 600, w: 326, h: 92 };
/** Who's playing: a name plate as the menu's, left of BATTLE!. */
const PLATE_BOX: Box = { x: 32, y: 590, w: 356, h: 108 };
const LEAVE_MS = 180;

/**
 * The Battle page, drawn on the stage as a showcase in three rows: the formats as a carousel that
 * goes round, the teams for the format picked as another (each Pokémon with its sprite, types, item
 * and ability), and the actions: BATTLE! searches Showdown's ladder for an opponent (it cancels the
 * search while it runs, and the format's card turns over to show it; a match opens the battle, see
 * App), and players can be challenged and challenges answered. ZL/ZR change the format and L/R the
 * team from anywhere, so the focus can stay on BATTLE!; up reaches the rows, whose left/right turn
 * them and A opens their list. Challenges that arrive show in a panel over the page (B leaves one for
 * later, and a button brings it back), as do the lists, the form to challenge someone and a
 * challenger's Trainer Card.
 *
 * The Random Battle page (/random, from the home menu's Random Battle) is the same page for the random
 * formats, its own format kept apart from the Battle page's: no teams to pick, so instead of the two
 * rows every format is in sight as a grid of tiles (FormatGridView); A on one picks it and goes on to
 * BATTLE!.
 */
@Component({
  selector: 'app-play-scene',
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
  /** The Random Battle page: the random formats instead of the team ones. */
  private readonly random = inject(ActivatedRoute).snapshot.data['random'] === true;
  /** The formats this page offers. */
  private readonly pageFormats = this.random ? RANDOM_PLAY_FORMATS : TEAM_PLAY_FORMATS;
  private readonly formatOptions = formatOptions(this.pageFormats);

  private readonly focus = new CanvasFocus();
  private readonly picker = new OptionPickerView(this.focus);
  private readonly popup = new ChallengePopupView(this.focus);
  private readonly form = new ChallengeFormView(this.focus);
  private readonly card = new TrainerCardView(this.focus);
  private readonly formats = new FormatCarouselView();
  private readonly showcase = new TeamShowcaseView();
  private readonly grid = new FormatGridView();
  /** The Poké Ball the cards are drawn with (the logo's), made with the stage's renderer. */
  private ball: Texture | null = null;

  private readonly format = this.random ? this.selection.randomPlayFormat : this.selection.playFormat;
  /** Sets this page's format. */
  private readonly setFormat = (id: string): void => (this.random ? this.selection.randomFormat : this.selection.format).set(id);
  private readonly formatIndex = computed(() =>
    Math.max(
      0,
      this.pageFormats.findIndex((format) => format.id === this.format().id),
    ),
  );
  private readonly randomTeams = computed(() => this.format().randomTeams);
  private readonly teams = computed(() => (this.random ? [] : this.selection.teams()));
  private readonly chosenTeam = computed(() => (this.random ? null : this.selection.team()));
  private readonly teamIndex = computed(() =>
    Math.max(
      0,
      this.teams().findIndex((team) => team.id === this.chosenTeam()?.id),
    ),
  );

  private readonly teamOptions = computed((): PickerOption[] =>
    this.teams().map((team) => ({
      id: team.id,
      title: team.name,
      detail: `${team.favourite ? 'Favourite · ' : ''}${team.sets.length} Pokémon`,
      sprites: team.sets.map((set) => this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species)),
    })),
  );

  /** Every format's card: how many teams the player has for it. */
  private readonly formatCards = computed((): FormatCard[] => {
    const teams = this.teamStore.teams().filter((team) => team.sets.length > 0);
    return this.pageFormats.map((format) => ({
      format,
      teams: format.randomTeams ? 0 : teams.filter((team) => team.format === (format.teamFormat ?? format.id)).length,
    }));
  });

  /** The format's teams as the showcase draws them. */
  private readonly showcaseTeams = computed((): ShowcaseTeam[] =>
    this.teams().map((team) => ({
      name: team.name,
      members: team.sets.slice(0, MAX_TEAM_SIZE).map((set) => {
        const info = speciesInfo(set.species);
        return {
          // Holding its Mega Stone, it shows as the Mega it becomes.
          sprite: this.dex.mega(set.species, set.item)?.sprite ?? this.dex.species(set.species)?.sprite ?? spriteId(set.species),
          species: info?.name ?? set.species,
          types: info?.types ?? [],
          item: set.item,
          itemId: this.dex.item(set.item)?.id ?? toId(set.item),
          ability: set.ability,
        };
      }),
    })),
  );

  /** Connected with a name: Showdown only lets named players search. */
  private readonly online = computed(() => this.login.state().status === 'named' && this.connection.state().status === 'connected');
  /** A ladder search is under way (in any format: the home screen's Random Battle searches too). */
  private readonly searching = computed(() => this.search.searching() !== null);
  /** The format and team can't change: a search is under way, or its battle is opening. */
  private readonly locked = computed(() => this.searching() || this.rooms.joining());
  private readonly hasTeam = computed(() => this.randomTeams() || this.chosenTeam() !== null);
  /** BATTLE! searches (online, with a team for the format), cancels the search, or goes back to the open battle. */
  private readonly canBattle = computed(() => this.session.active() || this.searching() || (this.online() && this.hasTeam()));

  /** Under BATTLE!: what it does now, or what it's waiting for. */
  private readonly battleLine = computed(() => {
    if (this.session.active()) return 'Back to your battle';
    if (this.rooms.joining()) return 'Joining battle…';
    if (this.search.cancelling()) return 'Cancelling the search…';
    if (this.searching()) return 'Searching for an opponent…';
    if (!this.hasTeam()) return 'Build a team for this format first';
    const status = this.login.state().status;
    if (status === 'offline') return 'Connect from the home menu first';
    if (status === 'unavailable') return 'No name on Showdown: online battles unavailable';
    if (!this.online()) return 'Connecting to Showdown…';
    const team = this.chosenTeam();
    return team ? `Ladder · with ${team.name}` : 'Find an opponent on the ladder';
  });
  private readonly canCycleTeams = computed(() => !this.randomTeams() && this.teams().length > 1 && !this.locked());

  // Who's playing, left of BATTLE!.
  /** Our name once the server calls us by it, for other players to challenge. */
  private readonly name = computed(() => (this.online() ? this.login.state().name : null));
  private readonly statusText = computed(() => {
    const login = this.login.state();
    if (login.status === 'offline') return 'Offline';
    if (login.status === 'unavailable') return 'Online battles unavailable';
    // The connection dropped (or keeps failing): why, and that it's being got back.
    const notice = connectionNotice(this.connection.state(), login);
    if (notice) return notice;
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
    return 'Players can challenge this name.';
  });

  /** Challenges left for later (by the challenger's ID): no panel for them until asked for. */
  private readonly postponed = signal<readonly string[]>([]);
  private readonly unanswered = computed(() => this.challenges.incoming().filter((challenge) => !this.postponed().includes(challenge.fromId)));
  /** The challenge in the panel: the one accepted while its battle opens, else the next one unanswered. */
  private readonly popupChallenge = computed(() => this.challenges.accepted() ?? this.unanswered()[0] ?? null);
  /** The teams the challenge on show can be accepted with (its format's, or the one it borrows them from). */
  private readonly popupTeams = computed(() => {
    const challenge = this.popupChallenge();
    if (!challenge?.needsTeam) return [];
    const teamFormat = PLAYABLE_FORMATS.find((format) => format.id === challenge.format)?.teamFormat ?? challenge.format;
    return inGridOrder(this.teamStore.teams()).filter((team) => team.format === teamFormat && team.sets.length > 0);
  });
  private readonly waitingBehind = computed(() => Math.max(0, this.unanswered().length - (this.challenges.accepted() ? 0 : 1)));
  private readonly postponedCount = computed(() => this.challenges.incoming().length - this.unanswered().length);

  private formOpen = false;
  private cardOpen = false;
  private lastLayer: Layer = 'page';
  /** Where the focus goes when the page shows again. */
  private returnTo: PageControl = 'battle';
  /** BATTLE!'s and the challenge button's eased focus. */
  private battleFocus = 0;
  private challengeFocus = 0;
  private chatIcon: Texture | null = null;
  private leaving: { at: number; path: string } | null = null;
  /** When the search on the format's card began (the clock on its back). */
  private searchSince = 0;
  private wasSearching = false;

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
      this.navigation.registerButton('buttonZL', () => this.pressZ(-1)),
      this.navigation.registerButton('buttonZR', () => this.pressZ(1)),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
      const textures = [this.ball, this.chatIcon];
      this.stage.whenReady(({ renderer }) => textures.forEach((texture) => texture && renderer.deleteTexture(texture)));
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
    if (layer !== 'page') return false;
    return this.stepTeam(by);
  }

  /** ZL/ZR: the page's format (wrapping around), from wherever the focus is. */
  private pressZ(by: 1 | -1): boolean {
    if (this.layer() !== 'page') return false;
    return this.stepFormat(by);
  }

  private stepFormat(by: 1 | -1): boolean {
    if (this.locked()) return false;
    const count = this.pageFormats.length;
    this.setFormat(this.pageFormats[(this.formatIndex() + by + count) % count].id);
    return true;
  }

  private stepTeam(by: 1 | -1): boolean {
    if (!this.canCycleTeams()) return false;
    const teams = this.teams();
    this.selection.teamId.set(teams[(this.teamIndex() + by + teams.length) % teams.length].id);
    return true;
  }

  private openPicker(which: 'format' | 'team'): void {
    this.returnTo = which;
    if (which === 'format') {
      this.picker.open('Pick a format', this.formatOptions, this.format().id, this.setFormat);
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

  /** The challenge button: cancels the challenge sent, brings back the ones left for later, or opens the form. */
  private challengeAction(): void {
    if (this.challenges.outgoing()) this.challenges.cancelChallenge();
    else if (this.postponedCount() > 0) this.postponed.set([]);
    else if (this.name()) this.openForm();
  }

  private leave(path: string): void {
    this.leaving ??= { at: performance.now(), path };
  }

  /** The page shows again: the control that opened the box, or the nearest one that works. */
  private focusPage(): void {
    const enabled: Record<PageControl, boolean> = {
      format: !this.locked(),
      team: !this.locked() && !this.randomTeams(),
      challenge: this.challenges.outgoing() !== null || this.postponedCount() > 0 || this.name() !== null,
      battle: this.canBattle(),
    };
    const order: PageControl[] = [this.returnTo, 'battle', 'team', 'format'];
    const control = order.find((control) => enabled[control]) ?? 'format';
    // The Random Battle page's format control is the picked format's tile.
    this.focus.focus(this.random && control === 'format' ? formatTileId(this.format().id) : control);
    this.returnTo = 'battle';
  }

  private popupModel(): PopupModel | null {
    const challenge = this.popupChallenge();
    if (!challenge) return null;
    return {
      challenge,
      waiting: this.waitingBehind(),
      teams: this.popupTeams(),
      preferredTeam: preferredTeam(this.popupTeams(), this.selection.teamId())?.id ?? null,
      viewCard: () => this.openCard(challenge.from),
    };
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    this.ball ??= pixelTexture(renderer, BALL);
    const layer = this.layer();
    if (layer !== this.lastLayer) {
      if (layer === 'page') this.focusPage();
      if (layer === 'picker' && this.lastLayer === 'popup') this.picker.focusSelected();
      if (this.lastLayer === 'popup' && layer !== 'card') this.popup.reset();
      this.lastLayer = layer;
    }
    if (this.searching() && !this.wasSearching) this.searchSince = now;
    this.wasSearching = this.searching();

    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    drawGround(ctx, 1);
    this.bar.drawHeader(ctx, { title: this.random ? 'RANDOM BATTLE' : 'BATTLE', icon: this.random ? 'random' : 'battle', back: () => this.onAction('back') });
    if (this.random) this.drawGrid(ctx);
    else {
      this.drawFormats(ctx);
      this.drawTeams(ctx);
    }
    this.drawPlayer(ctx);
    this.drawBattle(ctx);
    this.drawChallenge(ctx);

    if (layer === 'picker') this.picker.draw(ctx);
    else if (layer === 'form') this.form.draw(ctx, this.format(), this.chosenTeam(), () => this.closeForm());
    else if (layer === 'popup') this.popup.draw(ctx, this.popupModel()!);
    else if (layer === 'card') {
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

  /** The search under way, as the format's card (or tile) shows it. */
  private searchModel(now: number): { since: number; title: string; line: string } | null {
    const searched = this.search.searching();
    const joining = this.rooms.joining();
    if (!joining && !searched) return null;
    const searchedLabel = PLAYABLE_FORMATS.find((format) => format.id === searched)?.label ?? this.format().label;
    return {
      since: this.searchSince,
      title: joining ? 'Opponent found!' : this.search.cancelling() ? 'Cancelling…' : `Searching… ${clock(now - this.searchSince)}`,
      line: joining ? 'Joining battle…' : `Ladder · ${searchedLabel}`,
    };
  }

  /** The Random Battle page's formats, all in sight; a pick goes on to BATTLE!. */
  private drawGrid(ctx: UiContext): void {
    this.grid.draw(ctx, {
      formats: this.pageFormats,
      picked: this.format().id,
      locked: this.locked(),
      ball: this.ball,
      search: this.searchModel(ctx.now),
      pick: (id) => {
        if (this.locked()) return;
        this.setFormat(id);
        if (this.canBattle()) this.focus.focus('battle');
      },
    });
  }

  private drawFormats(ctx: UiContext): void {
    this.formats.draw(ctx, {
      cards: this.formatCards(),
      index: this.formatIndex(),
      focused: this.focus.focused === 'format',
      locked: this.locked(),
      ball: this.ball,
      search: this.searchModel(ctx.now),
      open: () => this.openPicker('format'),
      step: (by) => this.stepFormat(by),
    });
  }

  private drawTeams(ctx: UiContext): void {
    this.showcase.draw(ctx, {
      teams: this.showcaseTeams(),
      index: this.teamIndex(),
      random: this.randomTeams(),
      formatLabel: this.format().label,
      focused: this.focus.focused === 'team',
      locked: this.locked(),
      ball: this.ball,
      open: () => (this.teams().length > 0 ? this.openPicker('team') : this.leave('/teambuilder')),
      step: (by) => this.stepTeam(by),
    });
  }

  /** Who's playing (or why nobody is yet) on a name plate with their trainer, a guest's New name, and the page's hint or problem. */
  private drawPlayer(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const box = PLATE_BOX;
    renderer.rect(box.x, box.y + 10, box.w, box.h, { fill: [0, 0, 0, 0.2], radius: 16, softness: 18 });
    renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.rim, border: 1, radius: 16 });
    const name = this.name();
    const avatar = name ? ctx.images.pixelArt(avatarUrl(this.login.state().avatar)) : null;
    // The trainer, in a little window at the left.
    renderer.rect(box.x + 12, box.y + 12, 60, 60, { fill: p.select, radius: 12 });
    if (avatar) {
      renderer.clip({ x: box.x + 12, y: box.y + 12, w: 60, h: 60 });
      renderer.rect(box.x + 4, box.y + 6, 76, 76, { fill: [1, 1, 1, 1], texture: avatar });
      renderer.clip(null);
    } else if (this.ball) {
      renderer.image(this.ball, box.x + 30, box.y + 30, 1, [1, 1, 1, 0.5]);
    }
    const x = box.x + 86;
    const width = box.w - 98;
    if (name) {
      label(ctx, name, x, box.y + 30, { size: 22, bold: true }, p.ink, { maxWidth: this.canRename() ? width - 110 : width });
      label(ctx, 'Playing as', x, box.y + 56, { size: 14 }, p.muted);
    } else {
      label(ctx, this.statusText(), x, box.y + 38, { size: 17, bold: true }, p.muted, { maxWidth: this.canRename() ? width - 110 : width });
    }
    // A guest's name is random: another one, for when it's taken or blocked.
    if (this.canRename()) button(ctx, 'new-name', { x: box.x + box.w - 120, y: box.y + 12, w: 108, h: 32 }, 'New name', { size: 16, accept: () => this.login.newName() });
    const problem = this.problem();
    paragraph(ctx, this.hintText(), box.x + 14, box.y + 84, box.w - 28, 18, { size: 13, bold: !!problem }, problem ? p.danger : p.muted, 1);
  }

  /** BATTLE!, the page's main action as the menu's slanted accent button, with what it does now on its chip; CANCEL while searching. */
  private drawBattle(ctx: UiContext): void {
    const box = BATTLE_BOX;
    const enabled = this.canBattle();
    const focused = enabled && ctx.focus.control({ id: 'battle', ...box, accept: () => this.battle() });
    this.battleFocus += ((focused ? 1 : 0) - this.battleFocus) * 0.25;
    // The leads: both in doubles (the second a little behind, to the left), one in singles.
    const members = this.showcaseTeams()[this.teamIndex()]?.members ?? [];
    const leads = members.slice(0, this.format().category === 'Doubles' ? 2 : 1).map((member) => member.sprite);
    drawSlantedButton(ctx, {
      ...box,
      f: this.battleFocus,
      alpha: enabled ? 1 : 0.6,
      title: this.searching() ? 'CANCEL' : 'BATTLE!',
      titleSize: 42,
      titleY: 34,
      chipBottom: 26,
      plate: enabled ? ctx.palette.accent : ctx.palette.rim,
      primary: enabled,
      faded: !enabled,
      chips: [{ text: this.battleLine(), tone: 'muted' }],
      // The leads in their own colours, opaque while BATTLE! can be pressed (the kit dims art at rest: over
      // the accent it read as a button that can't be pressed); faded with it otherwise.
      art:
        leads.length > 0 && !this.randomTeams()
          ? (b, alpha, grow) => {
              const size = 112 * grow;
              for (let i = leads.length - 1; i >= 0; i--) {
                drawSprite(ctx, leads[i], b.x + b.w - 30 - size - i * 96, b.y + b.h - size + 14, size, enabled ? 1 : alpha);
              }
            }
          : undefined,
    });
  }

  /** Challenge a player, Cancel challenge or Answer challenges, as a slanted button (in the accent while waiting). */
  private drawChallenge(ctx: UiContext): void {
    const p = ctx.palette;
    const box = CHALLENGE_BOX;
    const outgoing = this.challenges.outgoing();
    const postponed = this.postponedCount();
    const waiting = outgoing !== null || postponed > 0;
    const enabled = waiting || this.name() !== null;
    const title = outgoing ? 'CANCEL CHALLENGE' : postponed > 0 ? `ANSWER${postponed > 1 ? ` (${postponed})` : ''}` : 'CHALLENGE';
    const line = outgoing ? `to ${outgoing.to}` : postponed > 0 ? `${this.challenges.incoming()[0]?.from ?? 'A player'} is waiting` : 'A player, by name';
    const focused = enabled && ctx.focus.control({ id: 'challenge', ...box, accept: () => this.challengeAction() });
    this.challengeFocus += ((focused ? 1 : 0) - this.challengeFocus) * 0.25;
    this.chatIcon ??= iconTexture(ctx.renderer, 'chats', false);
    const plate = HOME_MENU_ITEMS.find((item) => item.id === 'chats')?.plate[p.appearance];
    drawSlantedButton(ctx, {
      ...box,
      f: this.challengeFocus,
      alpha: enabled ? 1 : 0.6,
      title,
      titleSize: 22,
      icon: waiting ? null : this.chatIcon,
      plate: plate ? rgba(plate) : p.rim,
      primary: waiting,
      faded: !enabled,
      chips: [{ text: line, tone: 'muted' }],
    });
  }
}

/** A search's clock: 0:07. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
