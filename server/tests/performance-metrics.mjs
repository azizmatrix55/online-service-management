// Nearest-rank percentiles. Every measured request, including failures, is counted.
export function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a,b) => a-b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}
export function summarize(samples) {
  const durations = samples.map(item => item.durationMs)
  const valid = samples.filter(item => item.valid)
  const fastValid = samples.filter(item => item.valid && item.durationMs < 2000).length
  return {
    requests: samples.length,
    validResponses: valid.length,
    errors: samples.length - valid.length,
    medianMs: percentile(durations, .5),
    p95Ms: percentile(durations, .95),
    maxMs: durations.length ? Math.max(...durations) : null,
    validUnderTwoSeconds: fastValid,
    validUnderTwoSecondsPercent: samples.length ? fastValid / samples.length * 100 : null,
    targetMet: samples.length > 0 && fastValid / samples.length >= .95,
  }
}
