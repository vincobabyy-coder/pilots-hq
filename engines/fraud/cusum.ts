export interface CusumState {
  cusum_pos: number  // upper cumulative sum (detects upward drift)
  cusum_neg: number  // lower cumulative sum (detects downward drift)
  k:         number  // allowance (slack) parameter — typically 0.5 × sigma
  h:         number  // decision threshold — typically 4–5 × sigma
  mean:      number  // target (in-control) mean
}

export interface CusumResult {
  cusumPos:  number
  cusumNeg:  number
  alertUp:   boolean  // upward drift detected (cusum_pos > h)
  alertDown: boolean  // downward drift detected (cusum_neg > h)
  isAlert:   boolean  // alertUp || alertDown
  newState:  CusumState
}

const MIN_K = 0.001
const MIN_H = 0.01

// Initialise a CUSUM state from a baseline mean and sigma.
// k = 0.5 * sigma (floor at MIN_K)
// h = 5 * sigma  (floor at MIN_H)
export function initCusumState(mean: number, sigma: number): CusumState {
  if (!Number.isFinite(mean)) {
    throw new Error(`initCusumState: mean must be a finite number, got ${mean}`)
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new Error(`initCusumState: sigma must be a finite non-negative number, got ${sigma}`)
  }

  const k = Math.max(0.5 * sigma, MIN_K)
  const h = Math.max(5.0 * sigma, MIN_H)

  return {
    cusum_pos: 0,
    cusum_neg: 0,
    k,
    h,
    mean,
  }
}

// Applies one observation to existing CUSUM state (two-sided).
// Upper: S+ = max(0, S+_prev + (x - mean - k))
// Lower: S- = max(0, S-_prev + (mean - x - k))
// Alert when S+ > h or S- > h.
// Returns new state (immutable — old state unchanged).
export function updateCusum(state: CusumState, observation: number): CusumResult {
  if (!Number.isFinite(observation)) {
    throw new Error(`updateCusum: observation must be a finite number, got ${observation}`)
  }

  const { cusum_pos: prevPos, cusum_neg: prevNeg, k, h, mean } = state

  const cusumPos = Math.max(0, prevPos + (observation - mean - k))
  const cusumNeg = Math.max(0, prevNeg + (mean - observation - k))

  const alertUp   = cusumPos > h
  const alertDown = cusumNeg > h
  const isAlert   = alertUp || alertDown

  const newState: CusumState = {
    cusum_pos: cusumPos,
    cusum_neg: cusumNeg,
    k,
    h,
    mean,
  }

  return { cusumPos, cusumNeg, alertUp, alertDown, isAlert, newState }
}

// Resets CUSUM counters to 0 (after alert acknowledged).
// All parameters (mean, k, h) are preserved.
export function resetCusum(state: CusumState): CusumState {
  return {
    ...state,
    cusum_pos: 0,
    cusum_neg: 0,
  }
}

// Processes a batch of observations sequentially.
// Returns all intermediate CusumResults (one per observation).
export function processBatch(
  initialState: CusumState,
  observations: number[]
): CusumResult[] {
  if (!Array.isArray(observations)) {
    throw new Error('processBatch: observations must be an array')
  }

  const results: CusumResult[] = []
  let currentState = initialState

  for (const obs of observations) {
    const result = updateCusum(currentState, obs)
    results.push(result)
    currentState = result.newState
  }

  return results
}
