/** Animate a numeric counter from its current text to a target value. */
export function animateCount(el: HTMLElement, target: number): void {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (prefersReducedMotion) {
    el.textContent = String(target);
    return;
  }

  const current = parseInt(el.textContent || "0", 10);
  if (current === target) return;

  const duration = 300;
  const startTime = performance.now();
  const startVal = current;

  function update(now: number): void {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = Math.round(startVal + (target - startVal) * eased);
    el.textContent = String(val);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}
