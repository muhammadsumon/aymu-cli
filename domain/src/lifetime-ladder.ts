// The lifetime launch ladder (owner decision 2026-11-25): one lifetime plan sold at a public, seat-limited series of
// prices. The owner lists the Paddle prices in order with a seat cap each (`offers.lifetime_ladder`); the last step
// has no cap and is the permanent price. Which step is on sale is decided on the SERVER from webhook-verified sales
// only (`resolveLadder`), and the checkout uses that step's price. The browser never names a price or a step.
import { z } from 'zod';

export const LadderStep = z.strictObject({
  /** Paddle price id (`pri_…`) mapped to the lifetime plan in `paddle_prices` for this deployment's PADDLE_ENV. */
  paddlePriceId: z.string().regex(/^pri_[a-z0-9]{1,64}$/),
  /** Seats sold at this step before the next one opens; null only on the last step (the permanent price). */
  seats: z.int().min(1).max(100_000).nullable(),
});
export type LadderStep = z.infer<typeof LadderStep>;

export const LifetimeLadder = z
  .array(LadderStep)
  .max(20)
  .superRefine((steps, ctx) => {
    if (steps.length === 0) return; // no ladder: the plan's default price is used
    steps.forEach((s, i) => {
      const last = i === steps.length - 1;
      if (last !== (s.seats === null)) {
        ctx.addIssue({ code: 'custom', message: 'only the last step has no seat cap, and it must have none' });
      }
    });
    if (new Set(steps.map((s) => s.paddlePriceId)).size !== steps.length) {
      ctx.addIssue({ code: 'custom', message: 'a price appears twice in the ladder' });
    }
  });
export type LifetimeLadder = z.infer<typeof LifetimeLadder>;

/** `closed`: a step that never filled before the launch deadline passed. */
export type LadderStepState = 'sold_out' | 'current' | 'upcoming' | 'closed';

/** The launch deadline (`offers.lifetime_launch_ends_at`): an ISO date-time, or '' for none. */
export const LaunchEndsAt = z.union([z.literal(''), z.iso.datetime({ offset: true })]);

/** Epoch ms of a stored deadline, or null for none (or an unparsable value, which never ends a launch early). */
export function launchEndsAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface ResolvedStep {
  readonly index: number;
  readonly paddlePriceId: string;
  readonly seats: number | null;
  /** Seats of this step already sold (0 for upcoming steps). */
  readonly sold: number;
  readonly state: LadderStepState;
}

export interface ResolvedLadder {
  readonly steps: readonly ResolvedStep[];
  readonly current: ResolvedStep;
  /** Seats left at the current price, or null on the uncapped last step. */
  readonly seatsLeft: number | null;
  readonly totalSold: number;
  /** The launch deadline passed: the last step (the regular price) is on sale whatever was sold. */
  readonly ended: boolean;
}

/**
 * Which step is on sale after `sold` verified lifetime sales. Steps fill in order; the uncapped last step never sells
 * out. Once `ended` (the launch deadline passed), the last step is on sale and unfilled steps are `closed`. Returns
 * null for an empty ladder. `sold` below 0 or not an integer is treated as 0 (never invents sales).
 */
export function resolveLadder(ladder: LifetimeLadder, sold: number, ended = false): ResolvedLadder | null {
  if (ladder.length === 0) return null;
  const totalSold = Number.isSafeInteger(sold) && sold > 0 ? sold : 0;
  let before = 0;
  let currentIndex = ladder.length - 1;
  for (let i = 0; i < ladder.length; i += 1) {
    const cap = ladder[i]?.seats ?? null;
    if (cap === null || totalSold < before + cap) {
      currentIndex = i;
      break;
    }
    before += cap;
  }
  const fillIndex = currentIndex;
  if (ended) currentIndex = ladder.length - 1;
  let start = 0;
  const steps = ladder.map((s, i): ResolvedStep => {
    const state: LadderStepState =
      i < fillIndex ? 'sold_out' : i === currentIndex ? 'current' : i < currentIndex ? 'closed' : 'upcoming';
    const sold = state === 'sold_out' ? (s.seats ?? 0) : i === fillIndex ? totalSold - start : 0;
    start += s.seats ?? 0;
    return { index: i, paddlePriceId: s.paddlePriceId, seats: s.seats, sold, state };
  });
  const current = steps[currentIndex] as ResolvedStep;
  return {
    steps,
    current,
    seatsLeft: current.seats === null ? null : current.seats - current.sold,
    totalSold,
    ended,
  };
}
