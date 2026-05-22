/**
 * Cooperative pause primitive. Consumers call {@link waitWhilePaused} at safe
 * checkpoints. Independent from `AbortSignal` — abort wins at the next signal
 * check.
 *
 * @example
 * ```ts
 * const pauseController = new PauseController();
 * const runPromise = kit.install.run(plan, { pauseController });
 *
 * // Pause from a UI button click:
 * pauseController.pause();
 *
 * // Resume later — in-flight downloads finish; queued actions wait for resume():
 * pauseController.resume();
 *
 * await runPromise;
 * ```
 */
export class PauseController {
  #paused = false;
  #waiters: Array<() => void> = [];

  get paused(): boolean {
    return this.#paused;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    const list = this.#waiters;
    this.#waiters = [];
    for (const resolve of list) resolve();
  }

  waitWhilePaused(): Promise<void> {
    if (!this.#paused) return Promise.resolve();
    return new Promise<void>((resolve) => this.#waiters.push(resolve));
  }
}
