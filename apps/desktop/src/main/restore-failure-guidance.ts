export interface RestoreFailureGuidancePort {
  show(): void
  showError(
    title: string,
    message: string
  ): Promise<'retry' | 'cancel' | void> | 'retry' | 'cancel' | void
}

export function showRestoreFailureGuidance(
  errors: RestoreFailureGuidancePort
): ReturnType<RestoreFailureGuidancePort['showError']> {
  errors.show()
  return errors.showError(
    'Display settings need attention',
    'ChromaShift could not restore one or more connected displays. You can try again now or keep ChromaShift running. Technical details are available in Diagnostics.'
  )
}
