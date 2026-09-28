import type { RoutineEntry, RoutineRunResult } from '@shared/events'

export interface RoutineSchedulerDeps {
  getRoutines: () => RoutineEntry[]
  runRoutine: (routine: RoutineEntry) => Promise<RoutineRunResult>
  /** Called once a run settles — the caller persists lastRun/nextRunAt and surfaces it (notification, journal). */
  onRun: (routine: RoutineEntry, result: RoutineRunResult) => void
  now?: () => number
  tickMs?: number
}

/**
 * SCH-01/02: a tick-based poller, not a per-routine timer — simpler to reason about and to test
 * (one fake-clock tick covers every due routine), and avoids the classic setTimeout-drift problem
 * of scheduling far-future callbacks individually. Routines fire strictly sequentially, one at a
 * time: this is the deliberately narrow slice of SCH-02 (a background session pool) that SCH-01
 * actually needs — a full concurrent multi-session pool with its own UI is a separate, undone
 * card (see docs/ROADMAP.md).
 */
export class RoutineScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  private ticking = false

  constructor(private readonly deps: RoutineSchedulerDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? 30_000)
    // A routine already due at startup (e.g. Vivi was closed when it should have fired) shouldn't
    // have to wait out a full tick interval before it's noticed.
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Exposed for tests — runs one poll pass synchronously with the injected clock. */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = (this.deps.now ?? Date.now)()
      const due = this.deps
        .getRoutines()
        .filter(
          (r) => r.enabled && r.nextRunAt !== null && r.nextRunAt <= now && !this.running.has(r.id),
        )
      for (const routine of due) {
        this.running.add(routine.id)
        try {
          const result = await this.deps.runRoutine(routine)
          this.deps.onRun(routine, result)
        } finally {
          this.running.delete(routine.id)
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
