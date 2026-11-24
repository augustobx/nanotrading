/** The global floor applies to both target modes; this never lowers risk limits. */
export function effectiveRRMinimums(policy?: {
  minNetRR: number; minRRShort: number; minRRExtended: number;
} | null): { short: number; extended: number } {
  return {
    short: Math.max(policy?.minNetRR ?? 4, policy?.minRRShort ?? 2),
    extended: Math.max(policy?.minNetRR ?? 4, policy?.minRRExtended ?? 4),
  };
}
