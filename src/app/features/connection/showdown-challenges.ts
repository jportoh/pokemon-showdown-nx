import { Service, inject, signal } from '@angular/core';
import { BattleMusic } from '@core/audio/battle-music';
import { AudioEngine } from '@core/audio/audio-engine';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { AppSettings } from '@core/settings/app-settings';
import { merge } from 'rxjs';
import { formatName } from '@shared/data/formats';
import { toId } from '@shared/utils/to-id';
import { BattleRooms } from './battle-rooms';
import { ShowdownConnection } from './showdown-connection';
import { ShowdownLogin } from './showdown-login';
import { spectatorsCommand, splitLine } from './showdown-protocol';

/** Another player asking us for a battle. */
export interface Challenge {
  /** Their name as shown ("ffenrix"). */
  from: string;
  fromId: string;
  /** The format's ID ("gen9randombattle"). */
  format: string;
  formatName: string;
  /** Random formats bring their own teams; the others need one of ours to accept. */
  needsTeam: boolean;
}

/** A challenge we sent (a rematch), until it's accepted, rejected or cancelled. */
export interface OutgoingChallenge {
  /** Their name as shown. */
  to: string;
  toId: string;
  /** The format's ID ("gen9randombattle"). */
  format: string;
}

/** How long a popup after accepting, rejecting or challenging is taken as the server's answer to it. */
const ANSWER_WINDOW_MS = 5000;

/**
 * Challenges other players send us. Showdown sends them as private messages:
 * `|pm| ffenrix|!Brewser1234|/challenge gen9randombattle|gen9randombattle|||`, and the same with an
 * empty `/challenge` when it's withdrawn (or, from our side, once we've answered). Accepting starts a
 * battle room, which BattleRooms picks up. Ours go out as `/challenge ffenrix, gen9randombattle`, and
 * the server echoes them the same way with us as sender. In formats played with our own teams, the
 * team goes first, packed, with `/utm` (as for a ladder search); `/utm null` clears it otherwise.
 */
@Service()
export class ShowdownChallenges {
  private readonly connection = inject(ShowdownConnection);
  /** The next battle's music downloads while the player waits for it. */
  private readonly music = inject(BattleMusic);
  private readonly login = inject(ShowdownLogin);
  private readonly render = inject(RenderScheduler);
  private readonly rooms = inject(BattleRooms);
  private readonly settings = inject(AppSettings);
  private readonly audio = inject(AudioEngine);
  private readonly incomingSignal = signal<readonly Challenge[]>([]);
  private readonly errorSignal = signal<string | null>(null);
  private readonly outgoingSignal = signal<OutgoingChallenge | null>(null);
  private readonly acceptedSignal = signal<Challenge | null>(null);
  private readonly acceptFailedSignal = signal<string | null>(null);
  private acceptTimer: ReturnType<typeof setTimeout> | null = null;
  /** When we last accepted, rejected or challenged: a popup soon after is the server's answer. */
  private answeredAt = 0;
  /** The server has echoed our challenge back: it went out. */
  private outgoingConfirmed = false;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending challenges, oldest first. */
  readonly incoming = this.incomingSignal.asReadonly();
  /** Why the last accept or challenge failed (a popup from the server, a rejection), until the next one. */
  readonly error = this.errorSignal.asReadonly();
  /** The challenge we sent, while it waits for an answer. */
  readonly outgoing = this.outgoingSignal.asReadonly();
  /** The challenge we accepted, until its battle has something to show (or it failed). */
  readonly accepted = this.acceptedSignal.asReadonly();
  /** Whose challenge we couldn't accept (the server refused our team, say): it waits again, with `error`. */
  readonly acceptFailed = this.acceptFailedSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line, 3);
        if (type === 'pm') this.onPm(args[0] ?? '', args[1] ?? '', args[2] ?? '');
        // Errors in battle rooms (`|error|[Invalid choice]…`) aren't answers to challenges.
        else if ((type === 'popup' || (type === 'error' && !frame.roomId)) && Date.now() - this.answeredAt < ANSWER_WINDOW_MS)
          this.onPopup(args.join('|'));
      }
    });
    // Challenges don't survive a new connection, or the end of one.
    merge(this.connection.opened, this.connection.ended).subscribe(() => {
      this.setIncoming([]);
      this.setOutgoing(null);
      this.setAccepted(null);
      this.acceptFailedSignal.set(null);
    });
    this.rooms.started.subscribe(() => this.setAccepted(null));
  }

  /** Challenges a player, with our packed team in formats that need one (null in random formats). */
  challenge(to: string, format: string, team: string | null = null): void {
    if (this.outgoingSignal()) return;
    this.answeredAt = Date.now();
    this.errorSignal.set(null);
    const id = toId(to);
    this.connection.send('', spectatorsCommand(this.settings.settings().allowSpectators));
    this.connection.send('', `/utm ${team ?? 'null'}`);
    this.connection.send('', `/challenge ${id}, ${format}`);
    this.music.prepareNext();
    this.setOutgoing({ to, toId: id, format });
    // Silence isn't an answer either: said, so it shows (the challenge may still go out).
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      if (this.outgoingSignal() && !this.outgoingConfirmed && !this.errorSignal()) {
        this.setError('The server has not confirmed the challenge.');
      }
    }, ANSWER_WINDOW_MS);
  }

  /** Withdraws the challenge we sent, if any. */
  cancelChallenge(): void {
    const outgoing = this.outgoingSignal();
    if (!outgoing) return;
    this.connection.send('', `/cancelchallenge ${outgoing.toId}`);
    this.setOutgoing(null);
  }

  /** Accepts, with our packed team when the format needs one (null in random formats). */
  accept(challenge: Challenge, team: string | null = null): void {
    this.answer(challenge);
    this.connection.send('', spectatorsCommand(this.settings.settings().allowSpectators));
    this.connection.send('', `/utm ${team ?? 'null'}`);
    this.connection.send('', `/accept ${challenge.fromId}`);
    this.music.prepareNext();
    this.setAccepted(challenge);
    // No battle room by then, and no refusal either: it isn't coming.
    this.acceptTimer = setTimeout(() => {
      this.acceptTimer = null;
      if (this.acceptedSignal() && !this.rooms.joining()) {
        this.failAccept();
        this.setError('The battle did not start.');
      }
    }, ANSWER_WINDOW_MS);
  }

  reject(challenge: Challenge): void {
    this.answer(challenge);
    this.connection.send('', `/reject ${challenge.fromId}`);
  }

  private answer(challenge: Challenge): void {
    this.answeredAt = Date.now();
    this.errorSignal.set(null);
    this.acceptFailedSignal.set(null);
    this.setIncoming(this.incomingSignal().filter((c) => c.fromId !== challenge.fromId));
  }

  /** `|pm|SENDER|RECEIVER|MESSAGE`, each name with a leading rank character. */
  private onPm(sender: string, receiver: string, message: string): void {
    const outgoing = this.outgoingSignal();
    // The rejection comes as a message ("ffenrix rejected the challenge."), after or before the empty
    // `/challenge` that ends it.
    if (!message.startsWith('/challenge')) {
      if (/rejected the challenge/.test(message)) {
        this.setError(plainText(message));
        this.setOutgoing(null);
      } else if (outgoing && Date.now() - this.answeredAt < ANSWER_WINDOW_MS && (message.startsWith('/error') || !toId(sender))) {
        // Soon after challenging, an error or a message from the server itself ("~") is its answer:
        // some refusals come this way rather than as a popup.
        this.onPopup(plainText(message));
      }
      return;
    }
    const me = this.login.userId();
    const fromId = toId(sender);
    const format = message.slice('/challenge'.length).trim().split('|')[0];
    // Ours, echoed: gone when empty (accepted, rejected or cancelled; an accepted one starts a battle).
    if (fromId === me) {
      if (outgoing?.toId !== toId(receiver)) return;
      if (format) this.outgoingConfirmed = true;
      else this.setOutgoing(null);
      return;
    }
    if (toId(receiver) !== me) return;
    const others = this.incomingSignal().filter((c) => c.fromId !== fromId);
    if (!format) {
      if (this.acceptFailedSignal() === fromId) this.acceptFailedSignal.set(null);
      this.setIncoming(others);
      return;
    }
    const challenge: Challenge = {
      from: sender.replace(/^[^A-Za-z0-9]/, ''),
      fromId,
      format,
      formatName: formatName(format),
      needsTeam: !format.includes('random'),
    };
    // A new challenge rings (not one sent again, as when its format changes).
    if (others.length === this.incomingSignal().length) this.audio.play('challenge');
    this.setIncoming([...others, challenge]);
  }

  private setIncoming(challenges: readonly Challenge[]): void {
    this.incomingSignal.set(challenges);
    this.render.request();
  }

  /** An error after challenging ("The user 'ffenrix' was not found.") means the challenge didn't go out. */
  private onPopup(error: string): void {
    this.setOutgoing(null);
    this.failAccept();
    // A popup's "||" is a line break.
    this.setError(error.replace(/\|\|/g, ' ').trim());
  }

  private setOutgoing(challenge: OutgoingChallenge | null): void {
    this.outgoingConfirmed = false;
    if (!challenge && this.confirmTimer !== null) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.outgoingSignal.set(challenge);
    this.render.request();
  }

  /**
   * The challenge we accepted didn't start a battle (the server refused our team, say). It's still
   * pending on the server, so it waits for an answer again, first in line, to be accepted with another team.
   */
  private failAccept(): void {
    const challenge = this.acceptedSignal();
    this.setAccepted(null);
    if (!challenge) return;
    this.acceptFailedSignal.set(challenge.fromId);
    this.setIncoming([challenge, ...this.incomingSignal().filter((c) => c.fromId !== challenge.fromId)]);
  }

  private setAccepted(challenge: Challenge | null): void {
    if (!challenge && this.acceptTimer !== null) {
      clearTimeout(this.acceptTimer);
      this.acceptTimer = null;
    }
    this.acceptedSignal.set(challenge);
    this.render.request();
  }

  private setError(error: string): void {
    this.errorSignal.set(error);
    this.render.request();
  }
}

/** A PM's text as it reads: "/error You can't…" or "/raw <b>…</b>" → the words alone. */
function plainText(message: string): string {
  return message
    .replace(/^\/\w+\s+/, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
