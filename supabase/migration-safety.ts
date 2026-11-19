/** The reset-bearing historical migration may only run in the atomic preservation batch. */
export function assertOrdinaryMigrationSafety(selected: string[], applied: string[]) {
  if (
    selected.some((file) => file.startsWith('20261104000001_')) &&
    !applied.includes('20261104000001')
  ) {
    throw new Error(
      'LEGACY_POINTS_PRESERVATION_REQUIRED: ordinary per-file migration cannot apply the November 4 reset. Use the verified atomic preservation batch.',
    );
  }
}
