// SQLite WAL message bus. Shared across all cc-dm session instances via ~/.cc-dm/bus.db

export function initBus(): void {
  // TODO: Create ~/.cc-dm/bus.db, set WAL mode, create sessions and messages tables
}

export function registerSession(sessionId: string, role: string): void {
  // TODO: Insert or update session in sessions table
}

export function updateHeartbeat(sessionId: string): void {
  // TODO: Update last_seen timestamp for session
}

export function expireStaleSessions(): void {
  // TODO: Delete sessions with last_seen older than 60s
}

export function writeMessage(fromSession: string, toSession: string, content: string): void {
  // TODO: Insert message row into messages table
}

export function readMessages(sessionId: string): any[] {
  // TODO: Read and delete pending messages for session
  return [];
}

export function listActiveSessions(): any[] {
  // TODO: Return all sessions with last_seen within 60s
  return [];
}
