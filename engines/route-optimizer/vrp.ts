// engines/route-optimizer/vrp.ts
//
// Public entry point for the Vehicle Routing Problem solver.
//
// Pipeline:
//   1. greedyInit  — fast nearest-neighbour heuristic gives an upper-bound
//                    solution in O(n² · v) time.
//   2. branchAndBound — improves the greedy solution within the given time
//                       budget by exploring alternative stop orderings.
//   3. Return whichever result has the lower totalDistanceKm.

import { SolverInput, SolverResult } from './types'
import { greedyInit } from './greedy-init'
import { branchAndBound } from './branch-and-bound'

/**
 * Solve the Vehicle Routing Problem for the given input.
 *
 * 1. Run greedy nearest-neighbor to get an initial solution.
 * 2. Pass to branch-and-bound to improve within timeLimitMs.
 * Returns the best solution found.
 */
export async function solveVRP(
  input: SolverInput,
  timeLimitMs = 30_000
): Promise<SolverResult> {
  const wallStart = Date.now()

  // Step 1: greedy initialisation
  const greedySolution = greedyInit(input)

  // Step 2: early-exit when there's nothing meaningful to optimise
  if (input.stops.length === 0 || input.vehicles.length === 0) {
    return {
      ...greedySolution,
      solveTimeMs: Date.now() - wallStart,
    }
  }

  // Step 3: branch-and-bound improvement
  // Subtract time already spent in greedyInit so the B&B respects the
  // caller's total budget.
  const elapsed = Date.now() - wallStart
  const remainingMs = Math.max(0, timeLimitMs - elapsed)

  const bnbSolution = branchAndBound(input, greedySolution, remainingMs)

  // Step 4: return whichever is better
  const best =
    bnbSolution.totalDistanceKm < greedySolution.totalDistanceKm
      ? bnbSolution
      : greedySolution

  return {
    routes: best.routes,
    totalDistanceKm: best.totalDistanceKm,
    solveTimeMs: Date.now() - wallStart,
  }
}
