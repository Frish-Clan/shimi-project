export function riskColor(score) {
  if (score >= 70) return '#ef4444';
  if (score >= 50) return '#f97316';
  if (score >= 30) return '#eab308';
  return '#22c55e';
}

export function riskClass(score) {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'elevated';
  return 'stable';
}

export function riskLabel(score) {
  if (score >= 70) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 30) return 'Elevated';
  return 'Stable';
}

export function stabilityColor(pvScore) {
  if (pvScore >= 1.0) return '#22c55e';
  if (pvScore >= 0.0) return '#86efac';
  if (pvScore >= -1.0) return '#eab308';
  if (pvScore >= -2.0) return '#f97316';
  return '#ef4444';
}

export function stabilityFillColor(pvScore) {
  if (pvScore === null || pvScore === undefined) return '#374151';
  if (pvScore >= 1.0) return '#15803d';
  if (pvScore >= 0.0) return '#166534';
  if (pvScore >= -1.0) return '#92400e';
  if (pvScore >= -2.0) return '#9a3412';
  return '#7f1d1d';
}
