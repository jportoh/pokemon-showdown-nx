import { DestroyRef, Service, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { splitLine } from '@features/connection/showdown-protocol';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { Team } from '@features/teambuilder/models/team';

/** How long to wait for the server (including connecting) before giving up. */
const RESPONSE_TIMEOUT_MS = 20_000;

export type ValidationStatus = 'checking' | 'valid' | 'invalid' | 'error';

export interface ValidationResult {
  status: ValidationStatus;
  /** What the server said (or why it couldn't be asked); empty while checking. */
  message: string;
  /** Why the team was rejected, one line each. */
  problems: string[];
}

/**
 * Checks a team against its format on the Showdown server, as its teambuilder's Validate does: the
 * team is sent with `/utm` and checked with `/vtm`, and the server answers with a `|popup|`. Connects
 * as a guest if needed, and closes the connection again afterwards if nothing else is using it.
 */
@Service()
export class TeamValidation {
  private readonly connection = inject(ShowdownConnection);
  private readonly chat = inject(ChatRoomStore);
  private readonly login = inject(ShowdownLogin);
  private readonly render = inject(RenderScheduler);

  private readonly resultSignal = signal<ValidationResult | null>(null);
  /** The latest validation, or null before the first one. */
  readonly result = this.resultSignal.asReadonly();

  /** The commands still to send, until the connection is open. */
  private pending: { team: string; format: string } | null = null;
  private awaitingReply = false;
  private connectedForValidation = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.connection.opened.pipe(takeUntilDestroyed()).subscribe(() => this.sendPending());
    this.connection.frames.pipe(takeUntilDestroyed()).subscribe((frame) => {
      if (!this.awaitingReply) return;
      const popup = frame.lines.find((line) => line.startsWith('|popup|'));
      if (popup !== undefined) this.finish(parsePopup(splitLine(popup, 1)[1] ?? ''));
    });
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  validate(team: Team): void {
    this.clearTimer();
    this.awaitingReply = false;
    if (team.sets.length === 0) {
      this.pending = null;
      this.publish({ status: 'error', message: 'Add at least one Pokémon to validate the team.', problems: [] });
      return;
    }

    this.pending = { team: packTeam(team.sets), format: team.format };
    this.publish({ status: 'checking', message: '', problems: [] });
    this.timer = setTimeout(
      () => this.finish({ status: 'error', message: "The server didn't answer. Check the connection and try again.", problems: [] }),
      RESPONSE_TIMEOUT_MS,
    );
    if (this.connection.state().status === 'connected') {
      this.sendPending();
    } else {
      this.connectedForValidation ||= this.connection.state().status === 'offline';
      this.connection.connect();
    }
  }

  private sendPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.awaitingReply = true;
    this.connection.send('', `/utm ${pending.team}`);
    this.connection.send('', `/vtm ${pending.format}`);
  }

  private finish(result: ValidationResult): void {
    this.clearTimer();
    this.pending = null;
    this.awaitingReply = false;
    this.publish(result);
    // The socket costs the console its traffic: close it unless the player connected meanwhile (from
    // the home screen) or the chat has joined a room.
    if (this.connectedForValidation && !this.login.state().mode && this.chat.joinState() === 'idle') this.connection.disconnect();
    this.connectedForValidation = false;
  }

  private publish(result: ValidationResult): void {
    this.resultSignal.set(result);
    this.render.request();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * The server's answer, with `||` for line breaks:
 * "Your team is valid for [Gen 9 Champions] VGC 2026 Reg M-C." or
 * "Your team was rejected for the following reasons:||||- Incineroar can't learn Spore.||- …".
 * Anything else (e.g. too many validations in a short time) is shown as it is.
 */
function parsePopup(text: string): ValidationResult {
  const lines = text
    .split('||')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.some((line) => line.startsWith('Your team is valid'))) {
    return { status: 'valid', message: lines.join(' '), problems: [] };
  }
  if (lines.some((line) => line.startsWith('Your team was rejected'))) {
    // A clause's detail comes as its own line, "- (You have more than one Incineroar)": it joins the one before.
    const problems: string[] = [];
    for (const line of lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2))) {
      if (line.startsWith('(') && problems.length > 0) problems[problems.length - 1] += ` ${line}`;
      else problems.push(line);
    }
    return { status: 'invalid', message: 'Your team was rejected for these reasons:', problems };
  }
  return { status: 'error', message: lines.join(' '), problems: [] };
}
