// MCP tool handlers: dm, who, register, broadcast

import { writeMessage, listActiveSessions, registerSession, findSessionsByName, readPendingMessages } from "./bus.js";
import { sanitize } from "./sanitize.js";

export type DmResult = {
  success: boolean;
  to: string;
  error?: string;
};

export type WhoResult = {
  sessions: Array<{ id: string; name: string; role: string; cwd: string; last_seen: string }>;
  count: number;
  error?: string;
};

export type RegisterResult = {
  success: boolean;
  sessionId: string;
  name: string;
  role: string;
  error?: string;
};

export type BroadcastResult = {
  success: boolean;
  from: string;
  recipientCount: number;
  error?: string;
};

export function handleRegister(sessionId: string, name: string, role: string): RegisterResult {
  try {
    if (!name || name.trim().length === 0) {
      return { success: false, sessionId: "", name: "", role: "", error: "name is required" };
    }
    if (!role || role.trim().length === 0) {
      return { success: false, sessionId: "", name: "", role: "", error: "role is required" };
    }

    const cleanName = sanitize(name);
    const cleanRole = sanitize(role);

    if (cleanName.length > 64) {
      return { success: false, sessionId: "", name: "", role: "", error: "name must be 64 chars or less" };
    }
    if (cleanRole.length > 64) {
      return { success: false, sessionId: "", name: "", role: "", error: "role must be 64 chars or less" };
    }

    // Reject if name is already taken by a different session
    const existing = findSessionsByName(cleanName);
    const takenByOther = existing.some((s) => s.id !== sessionId);
    if (takenByOther) {
      return { success: false, sessionId: "", name: cleanName, role: "", error: "name already in use by another session" };
    }

    const cwd = process.cwd();
    registerSession(sessionId, cleanName, cleanRole, cwd);
    return { success: true, sessionId, name: cleanName, role: cleanRole };
  } catch (err) {
    return { success: false, sessionId: "", name: "", role: "", error: String(err) };
  }
}

export function handleDm(fromName: string, to: string, content: string): DmResult {
  try {
    if (!fromName || fromName.trim().length === 0) {
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
    const recipients = findSessionsByName(cleanTo);
    if (recipients.length === 0) {
      return { success: false, to: cleanTo, error: "no active session with that name" };
    }

    let failures = 0;
    for (const recipient of recipients) {
      if (!writeMessage(fromName, recipient.id, content)) {
        failures++;
      }
    }

    if (failures > 0) {
      return { success: false, to: cleanTo, error: `failed to deliver to ${failures} recipient(s)` };
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

export function handleBroadcast(fromId: string, fromName: string, content: string): BroadcastResult {
  try {
    if (!fromId || fromId.trim().length === 0) {
      return { success: false, from: "", recipientCount: 0, error: "from is required" };
    }
    if (!content || content.trim().length === 0) {
      return { success: false, from: fromName, recipientCount: 0, error: "content is required" };
    }
    if (content.length > 10_000) {
      return { success: false, from: fromName, recipientCount: 0, error: "content must be under 10000 chars" };
    }

    const sessions = listActiveSessions();
    const recipients = sessions.filter((s) => s.id !== fromId);
    let failures = 0;

    for (const session of recipients) {
      if (!writeMessage(fromName, session.id, content)) {
        failures++;
      }
    }

    if (failures > 0) {
      return { success: false, from: fromName, recipientCount: recipients.length - failures, error: `failed to deliver to ${failures} recipient(s)` };
    }
    return { success: true, from: fromName, recipientCount: recipients.length };
  } catch (err) {
    return { success: false, from: "", recipientCount: 0, error: String(err) };
  }
}

// Smoke test — only runs when executed directly: bun run src/tools.ts
if (import.meta.main) {
  const { initBus } = await import("./bus.js");

  initBus();

  const reg1 = handleRegister("id-planner", "planner", "orchestrator");
  console.error("register planner:", reg1);

  const reg2 = handleRegister("id-backend", "backend", "worker");
  console.error("register backend:", reg2);

  const dm = handleDm("planner", "backend", "scaffold the auth module");
  console.error("dm planner→backend:", dm);

  const bc = handleBroadcast("id-planner", "planner", "standup in 5");
  console.error("broadcast from planner:", bc);

  const who = handleWho();
  console.error("who:", who);

  const msgs = readPendingMessages("id-backend");
  console.error("backend messages:", msgs);
}
