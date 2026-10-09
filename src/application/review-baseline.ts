/**
 * The one revision a review round's mission diff is measured from. The agent
 * reviewer's prompt and the classifier's evidence both resolve it here, so they
 * cannot disagree about which commits belong to the mission.
 */
export function resolveReviewBaseline(baseline: string | undefined, fallback: string): string {
  return baseline || fallback;
}
