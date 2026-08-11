export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
