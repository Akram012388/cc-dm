// MCP tool handlers: dm, who, register, broadcast

export function handleDm(from: string, to: string, content: string): void {
  // TODO: Write DM to bus via writeMessage
}

export function handleWho(): any[] {
  // TODO: Return active sessions via listActiveSessions
  return [];
}

export function handleRegister(sessionId: string, role: string): void {
  // TODO: Register session via registerSession
}

export function handleBroadcast(from: string, content: string): void {
  // TODO: Write message to all active sessions except sender
}
