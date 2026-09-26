import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { formatName } from '@shared/data/formats';
import { toId } from '@shared/utils/to-id';
import { ShowdownConnection } from './showdown-connection';
import { ShowdownLogin } from './showdown-login';
import { splitLine } from './showdown-protocol';

/** Another player asking us for a battle. */
export interface Challenge {
  /** Their name as shown ("ffenrix"). */
  from: string;
  fromId: string;
  /** The format's ID ("gen9randombattle"). */
  format: string;
  formatName: string;
  /** Random formats bring their own teams; the others need one of ours, which can't be sent yet. */
  needsTeam: boolean;
}

/** How long a popup after accepting or rejecting is taken as the server's answer to it. */
const ANSWER_WINDOW_MS = 5000;

/**
 * Challenges other players send us. Showdown sends them as private messages:
 * `|pm| ffenrix|!Brewser1234|/challenge gen9randombattle|gen9randombattle|||`, and the same with an
 * empty `/challenge` when it's withdrawn (or, from our side, once we've answered). Accepting starts a
 * battle room, which BattleRooms picks up.
 */
@Service()
export class ShowdownChallenges {
  private readonly connection = inject(ShowdownConnection);
  private readonly login = inject(ShowdownLogin);
  private readonly render = inject(RenderScheduler);
  private readonly incomingSignal = signal<readonly Challenge[]>([]);
  private readonly errorSignal = signal<string | null>(null);
  /** When we last accepted or rejected: a popup soon after is the server's answer. */
  private answeredAt = 0;

  /** Pending challenges, oldest first. */
  readonly incoming = this.incomingSignal.asReadonly();
  /** Why the last accept failed (a popup from the server), until the next answer. */
  readonly error = this.errorSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line, 3);
        if (type === 'pm') this.onPm(args[0] ?? '', args[1] ?? '', args[2] ?? '');
        else if (type === 'popup' && Date.now() - this.answeredAt < ANSWER_WINDOW_MS) this.setError(args.join('|'));
      }
    });
    // Challenges don't survive a new connection.
    this.connection.opened.subscribe(() => this.setIncoming([]));
  }

  /** Random formats need no team: `/utm null` clears any team sent before. */
  accept(challenge: Challenge): void {
    this.answer(challenge);
    this.connection.send('', '/utm null');
    this.connection.send('', `/accept ${challenge.fromId}`);
  }

  reject(challenge: Challenge): void {
    this.answer(challenge);
    this.connection.send('', `/reject ${challenge.fromId}`);
  }

  private answer(challenge: Challenge): void {
    this.answeredAt = Date.now();
    this.errorSignal.set(null);
    this.setIncoming(this.incomingSignal().filter((c) => c.fromId !== challenge.fromId));
  }

  /** `|pm|SENDER|RECEIVER|MESSAGE`, each name with a leading rank character. */
  private onPm(sender: string, receiver: string, message: string): void {
    if (!message.startsWith('/challenge')) return;
    const me = this.login.userId();
    const fromId = toId(sender);
    if (toId(receiver) !== me || fromId === me) return;
    const format = message.slice('/challenge'.length).trim().split('|')[0];
    const others = this.incomingSignal().filter((c) => c.fromId !== fromId);
    if (!format) {
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
    this.setIncoming([...others, challenge]);
  }

  private setIncoming(challenges: readonly Challenge[]): void {
    this.incomingSignal.set(challenges);
    this.render.request();
  }

  private setError(error: string): void {
    this.errorSignal.set(error);
    this.render.request();
  }
}
