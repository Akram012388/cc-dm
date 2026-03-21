// 30s heartbeat writer. 60s session expiry cleanup.

export function startHeartbeat(sessionId: string): void {
  // TODO: Start 30s interval that calls updateHeartbeat and expireStaleSessions
}

export function stopHeartbeat(): void {
  // TODO: Clear heartbeat interval
}
