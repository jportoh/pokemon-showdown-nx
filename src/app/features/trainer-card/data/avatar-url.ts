import { TRAINER_SPRITES_URL } from '@features/connection/showdown-config';
import { toId } from '@shared/utils/to-id';
import { AVATAR_ALIASES } from './avatar-aliases';

/**
 * The sprite of a Showdown avatar, as its client resolves it: a number or old name maps to a sprite
 * name, "#name" is a custom avatar on the sprites server. Avatars with a file extension live on the
 * battle server itself (not in the network allow-list), so they show as the unknown trainer.
 */
export function avatarUrl(avatar: string): string {
  const name = AVATAR_ALIASES[avatar] ?? avatar;
  if (name.startsWith('#')) return `${TRAINER_SPRITES_URL}trainers-custom/${toId(name.slice(1))}.png`;
  if (!name || name.includes('.')) return `${TRAINER_SPRITES_URL}trainers/unknown.png`;
  return `${TRAINER_SPRITES_URL}trainers/${encodeURIComponent(name)}.png`;
}
