/* eslint-disable prettier/prettier */
export function getKeywordScore(keyword: string, list: string[]): number {
  const index = list.indexOf(keyword);
  const length = list.length;

  // Keyword not found in the list
  if (index === -1) {
    return 0;
  }

  // Handle the edge case of a single-item list
  if (length === 1) {
    // If there's only one item, its index is 0, which should score 1.0
    return 1.0;
  }

  // Calculate the normalized index (a value from 0 to 1)
  // This represents how far down the list the item is.
  const normalizedIndex = index / (length - 1);

  // Apply a non-linear transformation using square root
  // Formula: score = MaxScore - (Range * CurveFunction(NormalizedIndex))
  // Here: MaxScore = 1.0, Range = (1.0 - 0.5) = 0.5, CurveFunction = sqrt
  const score = 1.0 - 0.5 * Math.sqrt(normalizedIndex);

  // Return the calculated score (ensuring it stays within the 0.5-1.0 bounds)
  // Although the formula naturally does this, Math.max/min adds robustness.
  return Math.max(0.5, Math.min(1.0, score));
}
