/** Explicit allowlist: never accept an exception, storage, location, or training state here. */
export function createErrorDiagnostics(recoveryAvailable: boolean): string {
  return JSON.stringify({
    errorCode: 'KENDOMENU_UNEXPECTED_UI_ERROR',
    recoveryAvailable: recoveryAvailable === true,
  });
}

export async function copyErrorDiagnostics(recoveryAvailable: boolean): Promise<void> {
  await navigator.clipboard.writeText(createErrorDiagnostics(recoveryAvailable));
}
