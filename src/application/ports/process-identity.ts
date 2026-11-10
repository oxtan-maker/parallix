/** Stable operating-system process identity; startId prevents recycled PID matches. */
export interface ProcessIdentity {
  readonly pid: number;
  readonly startId: string | null;
}
