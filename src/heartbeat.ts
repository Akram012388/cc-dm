// 30s heartbeat writer. 60s session expiry cleanup.

import { updateHeartbeat, expireStaleSessions } from "./bus.js";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
export function startHeartbeat(sessionId: string): void {
  if (!sessionId || sessionId.trim().length === 0) {
    console.error("[cc-dm/heartbeat] sessionId is required");
    return;
  }

  if (heartbeatTimer || cleanupTimer) {
    stopHeartbeat();
  }

  try {
    updateHeartbeat(sessionId);
  } catch (err) {
    console.error("[cc-dm/heartbeat] initial heartbeat failed:", err);
  }

  try {
    expireStaleSessions();
  } catch (err) {
    console.error("[cc-dm/heartbeat] initial cleanup failed:", err);
  }

  heartbeatTimer = setInterval(() => {
    try {
      updateHeartbeat(sessionId);
    } catch (err) {
      console.error("[cc-dm/heartbeat] heartbeat write failed:", err);
    }
  }, 30_000);

  cleanupTimer = setInterval(() => {
    try {
      expireStaleSessions();
    } catch (err) {
      console.error("[cc-dm/heartbeat] stale session cleanup failed:", err);
    }
  }, 60_000);

  process.on("exit", () => stopHeartbeat());
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Smoke test — only runs when executed directly: bun run src/heartbeat.ts
if (import.meta.main) {
  const { initBus, registerSession, listActiveSessions } = await import("./bus.js");

  initBus();
  registerSession("heartbeat-test", "worker");
  startHeartbeat("heartbeat-test");
  console.log("Heartbeat started for heartbeat-test");

  setTimeout(() => {
    const sessions = listActiveSessions();
    console.log("Active sessions (2s):", sessions);
  }, 2_000);

  setTimeout(() => {
    stopHeartbeat();
    console.log("Heartbeat stopped");
  }, 4_000);

  setTimeout(() => {
    const sessions = listActiveSessions();
    console.log("Active sessions (5s):", sessions);
  }, 5_000);

  setTimeout(() => {}, 6_000);
}
