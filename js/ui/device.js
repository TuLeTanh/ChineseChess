/**
 * Device pointer capability helper (C1).
 * Exposes `isCoarse()` only. Layout NEVER depends on isCoarse — only on viewport
 * size via `computeLayoutMode`. Touch-specific interaction depends on `event.pointerType`.
 */

export function isCoarse() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('touch') === '1') return true;
    if (params.get('touch') === '0') return false;
  } catch {
    // ignore
  }
  return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}
