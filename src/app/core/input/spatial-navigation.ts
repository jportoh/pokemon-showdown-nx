export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A control that can take focus, where it is, and the scroll region it sits in (if any). */
export interface Candidate {
  element: HTMLElement;
  box: Box;
  region: HTMLElement | null;
  /** Scrolled out of its region's visible area. */
  clipped: boolean;
}

/** Scroll regions carry the ScrollRegion directive's attribute (see shared/directives/scroll-region). */
const REGION_ATTRIBUTE = 'appscrollregion';

/** How far (px) a control may overlap the current one and still count as being beyond it. */
const OVERLAP_TOLERANCE = 8;

/** Sideways offset weighs more than distance, so moving down prefers what's straight below. */
const SIDEWAYS_WEIGHT = 2;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** A field that takes typing. A read-only one (the export text) is navigated like any other control. */
export function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element || (element as HTMLInputElement).readOnly) return false;
  const tag = element.tagName;
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has(((element as HTMLInputElement).type || '').toLowerCase());
}

export function isFocusable(element: Element): element is HTMLElement {
  const tag = element.tagName;
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return !(element as HTMLButtonElement).disabled;
  if (tag === 'INPUT') return !(element as HTMLInputElement).disabled && (element as HTMLInputElement).type !== 'hidden';
  if (tag === 'A' && element.getAttribute('href') !== null) return true;
  const tabindex = element.getAttribute('tabindex');
  return tabindex !== null && Number(tabindex) >= 0;
}

export function isScrollRegion(element: Element): boolean {
  return element.getAttribute(REGION_ATTRIBUTE) !== null;
}

export function boxOf(element: Element): Box | null {
  const rect = element.getBoundingClientRect?.();
  if (!rect || rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/**
 * Where an element is on screen, for navigation. Inside a scroll region its vertical place is
 * computed from the region's box, its offset in the content and the region's scroll position, rather
 * than read from its own box: on the console, boxes inside a scrolled region don't seem to follow
 * the scrolling (see revealInRegion). In browsers both give the same result.
 */
export function screenBoxOf(element: HTMLElement, region: HTMLElement | null = regionOf(element)): Box | null {
  const box = boxOf(element);
  if (!box || !region) return box;
  const regionBox = boxOf(region);
  const top = contentTop(element, region);
  if (!regionBox || top === null) return box;
  const screenTop = regionBox.top + (region.clientTop || 0) + top - region.scrollTop;
  return { left: box.left, right: box.right, top: screenTop, bottom: screenTop + (box.bottom - box.top) };
}

/** Whether the engine reports element boxes at all; without them, navigation falls back to document order. */
export function boxesSupported(): boolean {
  return boxOf(document.body) !== null;
}

/**
 * Every visible focusable control under `root`, in document order. Walks childNodes by hand rather
 * than using a selector (a `getElementsByTagName('*')` returned nothing on Brewser). Subtrees hidden
 * with the `hidden` class or attribute are skipped without measuring them; other hidden controls
 * (display: none, so an empty box) are left out too. So are controls scrolled out of view in a region,
 * except in the region the current control is in, so the d-pad can scroll through a list.
 *
 * Without element boxes (`withBoxes` false), every control outside a hidden subtree is listed with an
 * empty box, for navigation in document order.
 */
export function collectCandidates(root: Element, currentRegion: HTMLElement | null, withBoxes = true): Candidate[] {
  const found: Candidate[] = [];
  const noBox: Box = { left: 0, top: 0, right: 0, bottom: 0 };
  const walk = (node: Node, region: HTMLElement | null, regionBox: Box | null): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const element = child as HTMLElement;
      if (isHidden(element)) continue;
      if (isFocusable(element)) {
        const box = withBoxes ? screenBoxOf(element, region) : noBox;
        if (box) {
          const clipped = regionBox !== null && (box.bottom <= regionBox.top || box.top >= regionBox.bottom);
          if (!clipped || region === currentRegion) found.push({ element, box, region, clipped });
        }
      }
      if (isScrollRegion(element)) {
        const box = withBoxes ? boxOf(element) : null;
        if (box || !withBoxes) walk(element, element, box);
      } else {
        walk(element, region, regionBox);
      }
    }
  };
  walk(root, null, null);
  return found;
}

function isHidden(element: HTMLElement): boolean {
  return element.getAttribute('hidden') !== null || (element.classList?.contains('hidden') ?? false) || element.style?.display === 'none';
}

export function regionOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (isScrollRegion(node)) return node;
  }
  return null;
}

/** The nearest candidate beyond `origin` in `direction`, or null at the edge. */
export function nearestInDirection(origin: Box, direction: Direction, candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const box = candidate.box;
    let distance: number;
    let sideways: number;
    switch (direction) {
      case 'down':
        if (box.top < origin.bottom - OVERLAP_TOLERANCE || centerY(box) <= centerY(origin)) continue;
        distance = box.top - origin.bottom;
        sideways = gap(box.left, box.right, origin.left, origin.right);
        break;
      case 'up':
        if (box.bottom > origin.top + OVERLAP_TOLERANCE || centerY(box) >= centerY(origin)) continue;
        distance = origin.top - box.bottom;
        sideways = gap(box.left, box.right, origin.left, origin.right);
        break;
      case 'right':
        if (box.left < origin.right - OVERLAP_TOLERANCE || centerX(box) <= centerX(origin)) continue;
        distance = box.left - origin.right;
        sideways = gap(box.top, box.bottom, origin.top, origin.bottom);
        break;
      case 'left':
        if (box.right > origin.left + OVERLAP_TOLERANCE || centerX(box) >= centerX(origin)) continue;
        distance = origin.left - box.right;
        sideways = gap(box.top, box.bottom, origin.top, origin.bottom);
        break;
    }
    // Ties (e.g. several controls straight below) go to the one whose centre is closest.
    const score = Math.max(0, distance) + SIDEWAYS_WEIGHT * sideways + centerDistance(box, origin) / 1000;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** The candidate closest to `origin` in any direction: where focus goes when its control disappears. */
export function nearestTo(origin: Box, candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = centerDistance(candidate.box, origin);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Rows of context kept visible above and below the focused one when a region scrolls (as a factor of its height). */
const REVEAL_CONTEXT = 1.5;

/**
 * Scrolls `element`'s region, if it has one, just enough to show it with some context around it
 * (up to REVEAL_CONTEXT rows, less when the region is too short for that). The element's place in the
 * region comes from offsetTop (layout, unaffected by scrolling) and the scroll position is set
 * outright: on the console, adjusting it by the difference between screen boxes overshot a little
 * more with every step down the move list until the focused row scrolled out of view (the boxes
 * evidently don't follow the region's scrolling there). Screen boxes are only the fallback.
 */
export function revealInRegion(element: HTMLElement): void {
  const region = regionOf(element);
  if (!region) return;
  const top = contentTop(element, region);
  const height = element.offsetHeight;
  const view = region.clientHeight;
  if (top !== null && Number.isFinite(height) && view > 0) {
    const margin = Math.max(0, Math.min(height * REVEAL_CONTEXT, (view - height) / 2));
    const max = Math.max(0, region.scrollHeight - view);
    if (top - margin < region.scrollTop) region.scrollTop = Math.max(0, top - margin);
    else if (top + height + margin > region.scrollTop + view) region.scrollTop = Math.min(max, top + height + margin - view);
    return;
  }
  const box = boxOf(element);
  const regionBox = boxOf(region);
  if (!box || !regionBox) return;
  if (box.top < regionBox.top) region.scrollTop -= regionBox.top - box.top;
  else if (box.bottom > regionBox.bottom) region.scrollTop += box.bottom - regionBox.bottom;
}

/** Where `element` sits in `region`'s scrolled content (px from its top), or null without offsets. */
function contentTop(element: HTMLElement, region: HTMLElement): number | null {
  const elementTop = pageTop(element);
  const regionTop = pageTop(region);
  if (elementTop === null || regionTop === null) return null;
  return elementTop - regionTop - (region.clientTop || 0);
}

/** Distance from the page's top through the offsetParent chain; null if the engine has no offsets. */
function pageTop(element: HTMLElement): number | null {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    if (!Number.isFinite(node.offsetTop)) return null;
    top += node.offsetTop;
  }
  return top;
}

/** Distance between two intervals on one axis; 0 when they overlap. */
function gap(start: number, end: number, otherStart: number, otherEnd: number): number {
  if (end < otherStart) return otherStart - end;
  if (start > otherEnd) return start - otherEnd;
  return 0;
}

function centerX(box: Box): number {
  return (box.left + box.right) / 2;
}

function centerY(box: Box): number {
  return (box.top + box.bottom) / 2;
}

function centerDistance(a: Box, b: Box): number {
  return Math.hypot(centerX(a) - centerX(b), centerY(a) - centerY(b));
}
