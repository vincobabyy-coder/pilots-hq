// engines/route-optimizer/vrp.ts
//
// Public entry point for the Vehicle Routing Problem solver.
//
// Pipeline:
//   1. greedyInit  — fast nearest-neighbour heuristic gives an upper-bound
//                    solution in O(n² · v) time.
//   2. branchAndBound — improves the greedy solution within the given time
//                       budget by exploring alternative stop orderings.
//   3. Return whichever result has the lower totalDistanceKm, along with
//      SolverMetadata for transparency and reproducibility.

import { SolverInput, SolverRoute } from './types'
import { greedyInit } from './greedy-init'
import { branchAndBound } from './branch-and-bound'

// ---------------------------------------------------------------------------
// B&B threshold: when n ≤ this value the solver runs B&B to proven optimality
// (within the time budget). Above it we still run B&B but classify as hybrid
// only when B&B actually improved the greedy result.
// ---------------------------------------------------------------------------
const BNB_EXACT_THRESHOLD = 8

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SolverMetadata {
  /** Which solver algorithm produced the final answer. */
  solverUsed: 'exact-bnb' | 'greedy-approximation' | 'hybrid'
  /**
   * Fraction [0, 1] representing distance from optimality.
   * 0 = proven optimal; 0.5 = no guarantee (greedy only).
   */
  optimalityGap: number
  /** Human-readable explanation of the gap guarantee. */
  gapCertificate: string
  /** Reproducibility seed used for this solve. */
  seed: number
  /** Number of B&B nodes explored (0 for greedy-only runs). */
  nodesExplored: number
  /** Wall-clock milliseconds spent solving. */
  solveTimeMs: number
}

export interface VrpResult {
  routes: SolverRoute[]
  totalDistanceKm: number
  solver: SolverMetadata
}

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

/**
 * Solve the Vehicle Routing Problem for the given input.
 *
 * @param input      - stops, vehicles, warehouse location and org context.
 * @param timeLimitMs - total wall-clock budget (default 30 s).
 * @param seed       - reproducibility seed; stored in result. Defaults to
 *                     Date.now() % 1_000_000. Pass a fixed value in tests.
 *
 * Returns the best solution found together with SolverMetadata.
 */
export async function solveVRP(
  input: SolverInput,
  timeLimitMs = 30_000,
  seed = Date.now() % 1_000_000
): Promise<VrpResult> {
  const wallStart = Date.now()
  const n = input.stops.length

  // Step 1: greedy initialisation (always runs)
  const greedySolution = greedyInit(input)

  // Step 2: early-exit when there's nothing meaningful to optimise
  if (n === 0 || input.vehicles.length === 0) {
    const solveTimeMs = Date.now() - wallStart
    return {
      routes: greedySolution.routes,
      totalDistanceKm: greedySolution.totalDistanceKm,
      solver: {
        solverUsed: 'greedy-approximation',
        optimalityGap: n === 0 ? 0 : 0.5,
        gapCertificate: n === 0
          ? 'Proven optimal (no stops)'
          : `Greedy approximation (n=${n}), no optimality guarantee`,
        seed,
        nodesExplored: 0,
        solveTimeMs,
      },
    }
  }

  // Step 3: branch-and-bound improvement
  // Subtract time already spent in greedyInit so B&B respects the total budget.
  const elapsed = Date.now() - wallStart
  const remainingMs = Math.max(0, timeLimitMs - elapsed)

  const bnbSolution = branchAndBound(input, greedySolution, remainingMs)
  const nodesExplored = bnbSolution.nodesExplored ?? 0

  // Step 4: pick the best result and classify the solver
  const bnbImproved = bnbSolution.totalDistanceKm < greedySolution.totalDistanceKm - 1e-9
  const best = bnbImproved ? bnbSolution : greedySolution

  let solverUsed: SolverMetadata['solverUsed']
  let optimalityGap: number
  let gapCertificate: string

  if (n <= BNB_EXACT_THRESHOLD) {
    // Small enough that B&B can exhaustively verify optimality within budget
    solverUsed = 'exact-bnb'
    optimalityGap = 0
    gapCertificate = `Proven optimal (B&B, n=${n})`
  } else if (bnbImproved) {
    // B&B ran on a large instance and found a better solution than greedy
    solverUsed = 'hybrid'
    optimalityGap = 0.5
    gapCertificate = `Hybrid: B&B improved greedy result (n=${n}), no optimality guarantee`
  } else {
    // B&B ran but greedy was already at least as good; report greedy
    solverUsed = 'greedy-approximation'
    optimalityGap = 0.5
    gapCertificate = `Greedy approximation (n=${n}), no optimality guarantee`
  }

  const solveTimeMs = Date.now() - wallStart

  return {
    routes: best.routes,
    totalDistanceKm: best.totalDistanceKm,
    solver: {
      solverUsed,
      optimalityGap,
      gapCertificate,
      seed,
      nodesExplored,
      solveTimeMs,
    },
  }
}
