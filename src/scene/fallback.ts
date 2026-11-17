// WebGL context loss: the standard `webglcontextlost` and `webglcontextrestored` events on the canvas.
// The default of the lost event is prevented, which is what allows a restore. If no restore arrives
// within 5,000 ms the caller shows the renderer-unavailable banner.

export const CONTEXT_RESTORE_TIMEOUT_MS = 5000;

export interface ContextHandlers {
  onLost(): void;
  onRestored(): void;
  onFallback(): void;
}

export interface EventTargetLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** Returns a function that removes both listeners and the pending timer. */
export function watchContext(target: EventTargetLike, handlers: ContextHandlers, timeoutMs: number = CONTEXT_RESTORE_TIMEOUT_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const lost = (event: Event): void => {
    event.preventDefault();
    clear();
    handlers.onLost();
    timer = setTimeout(() => {
      timer = null;
      handlers.onFallback();
    }, timeoutMs);
  };
  const restored = (): void => {
    clear();
    handlers.onRestored();
  };
  target.addEventListener("webglcontextlost", lost);
  target.addEventListener("webglcontextrestored", restored);
  return () => {
    clear();
    target.removeEventListener("webglcontextlost", lost);
    target.removeEventListener("webglcontextrestored", restored);
  };
}