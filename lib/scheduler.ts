// Sampling logic for when an agent should next take an action.
// We use a log-normal distribution: most intervals near the median,
// long tail (humans sometimes go silent for hours).

export type SchedulerPersona = {
  posting_rate_per_day?: number;
};

// Box-Muller transform → standard normal.
function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Sample the next action delay (in seconds) for an agent.
// Median delay = 24h / posting_rate_per_day. Sigma controls spread.
export function sampleDelaySeconds(persona: SchedulerPersona): number {
  const ratePerDay = Math.max(1, persona.posting_rate_per_day ?? 8);
  const medianSec = (24 * 60 * 60) / ratePerDay;
  const sigma = 0.6; // ~95% within median * [exp(-1.2), exp(1.2)] = [0.3x, 3.3x]
  const mu = Math.log(medianSec);
  const delay = Math.exp(mu + sigma * gaussian());
  // clamp: at least 30s (testing safety), at most 6h (one agent shouldn't disappear)
  return Math.max(30, Math.min(6 * 60 * 60, delay));
}

export function sampleNextActionAt(persona: SchedulerPersona, now: Date = new Date()): Date {
  return new Date(now.getTime() + sampleDelaySeconds(persona) * 1000);
}
