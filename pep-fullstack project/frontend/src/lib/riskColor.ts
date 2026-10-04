/** Risk-score → colour scale used by the entity graph's node glow ring
 * and detail panel. Matches the bands the timeline's participant bar
 * uses locally, so "red" means the same risk level in both views. */
export function riskColor(score: number): string {
  if (score >= 0.75) return "var(--accent-red)";
  if (score >= 0.5) return "#FF9500";
  if (score >= 0.25) return "#FFCC00";
  return "var(--accent-blue)";
}
