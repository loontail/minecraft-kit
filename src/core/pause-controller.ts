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
 * // Resume later — the transfer continues from the chunk it parked on. There is no HTTP range
 * // resume: if the idle connection was dropped while paused, the file restarts from byte 0.
 * pauseController.resume();
 *
 * await runPromise;
 * ```
 */
export class PauseController {
  private paused_ = false;
  private waiters: Array<() => void> = [];

  get paused(): boolean {
    return this.paused_;
  }

  pause(): void {
    this.paused_ = true;
  }

  resume(): void {
    this.paused_ = false;
    const list = this.waiters;
    this.waiters = [];
    for (const resolve of list) resolve();
  }

  waitWhilePaused(): Promise<void> {
    if (!this.paused_) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
