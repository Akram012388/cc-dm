// MCP tool handlers: dm, who, register, broadcast

import { writeMessage, readMessages, listActiveSessions, registerSession } from "./bus.js";

export type DmResult = {
  success: boolean;
  to: string;
  error?: string;
};

export type WhoResult = {
  sessions: Array<{ id: string; role: string; last_seen: string }>;
  count: number;
  error?: string;
};

export type RegisterResult = {
  success: boolean;
  sessionId: string;
  role: string;
  error?: string;
};

export type BroadcastResult = {
  success: boolean;
  from: string;
  recipientCount: number;
  error?: string;
};

function sanitize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function handleRegister(sessionId: string, role: string): RegisterResult {
  try {
    if (!sessionId || sessionId.trim().length === 0) {
      return { success: false, sessionId: "", role: "", error: "sessionId is required" };
    }
    if (sessionId.length > 64) {
      return { success: false, sessionId: "", role: "", error: "sessionId must be 64 chars or less" };
    }
    if (!role || role.trim().length === 0) {
      return { success: false, sessionId: "", role: "", error: "role is required" };
    }
    if (role.length > 64) {
      return { success: false, sessionId: "", role: "", error: "role must be 64 chars or less" };
    }

    const cleanId = sanitize(sessionId);
    const cleanRole = sanitize(role);
    registerSession(cleanId, cleanRole);
    return { success: true, sessionId: cleanId, role: cleanRole };
  } catch (err) {
    return { success: false, sessionId: "", role: "", error: String(err) };
  }
}

export function handleDm(from: string, to: string, content: string): DmResult {
  try {
    if (!from || from.trim().length === 0) {
      return { success: false, to: "", error: "from is required" };
    }
    if (!to || to.trim().length === 0) {
      return { success: false, to: "", error: "to is required" };
    }
    if (!content || content.trim().length === 0) {
      return { success: false, to: "", error: "content is required" };
    }
    if (content.length > 10_000) {
      return { success: false, to: "", error: "content must be under 10000 chars" };
    }

    const cleanTo = sanitize(to);
    const ok = writeMessage(from, cleanTo, content);
    if (!ok) {
      return { success: false, to: cleanTo, error: "failed to write message" };
    }
    return { success: true, to: cleanTo };
  } catch (err) {
    return { success: false, to: "", error: String(err) };
  }
}

export function handleWho(): WhoResult {
  try {
    const sessions = listActiveSessions();
    return { sessions, count: sessions.length };
  } catch (err) {
    console.error("[cc-dm/tools] handleWho failed:", err);
    return { sessions: [], count: 0, error: String(err) };
  }
}

export function handleBroadcast(from: string, content: string): BroadcastResult {
  try {
    if (!from || from.trim().length === 0) {
      return { success: false, from: "", recipientCount: 0, error: "from is required" };
    }
    if (!content || content.trim().length === 0) {
      return { success: false, from, recipientCount: 0, error: "content is required" };
    }
    if (content.length > 10_000) {
      return { success: false, from, recipientCount: 0, error: "content must be under 10000 chars" };
    }

    const sessions = listActiveSessions();
    const recipients = sessions.filter((s) => s.id !== from);
    let failures = 0;

    for (const session of recipients) {
      if (!writeMessage(from, session.id, content)) {
        failures++;
      }
    }

    if (failures > 0) {
      return { success: false, from, recipientCount: recipients.length - failures, error: `failed to deliver to ${failures} recipient(s)` };
    }
    return { success: true, from, recipientCount: recipients.length };
  } catch (err) {
    return { success: false, from: "", recipientCount: 0, error: String(err) };
  }
}

// Smoke test — only runs when executed directly: bun run src/tools.ts
if (import.meta.main) {
  const { initBus } = await import("./bus.js");

  initBus();

  const reg1 = handleRegister("planner", "orchestrator");
  console.log("register planner:", reg1);

  const reg2 = handleRegister("backend", "worker");
  console.log("register backend:", reg2);

  const dm = handleDm("planner", "backend", "scaffold the auth module");
  console.log("dm planner→backend:", dm);

  const bc = handleBroadcast("planner", "standup in 5");
  console.log("broadcast from planner:", bc);

  const who = handleWho();
  console.log("who:", who);

  const msgs = readMessages("backend");
  console.log("backend messages:", msgs);
}
