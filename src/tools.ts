// MCP tool handlers: dm, who, register, broadcast

import { writeMessage, listActiveSessions, registerSession, findSessionsByName, readPendingMessages } from "./bus.js";
import { sanitize } from "./sanitize.js";

export type DmResult = {
  success: boolean;
  to: string;
  error?: string;
};

export type WhoResult = {
  sessions: Array<{ id: string; name: string; role: string; cwd: string; project: string; last_seen: string }>;
  count: number;
  error?: string;
};

export type RegisterResult = {
  success: boolean;
  sessionId: string;
  name: string;
  role: string;
  project: string;
  error?: string;
};

export type BroadcastResult = {
  success: boolean;
  from: string;
  recipientCount: number;
  error?: string;
};

export type Identity = {
  name: string;
  role: string;
  project: string;
};

const META_KEY_RE = /^[a-zA-Z0-9_]+$/;

export function validateMetaKeys(meta: Record<string, string>): string | null {
  for (const key of Object.keys(meta)) {
    if (!META_KEY_RE.test(key)) {
      return `invalid meta key "${key}" — only letters, digits, and underscores allowed`;
    }
  }
  return null;
}

export function buildMeta(
  priority?: string,
  messageType?: string,
  threadId?: string,
): { meta: Record<string, string>; error?: string } {
  if (threadId && threadId.length > 64) {
    return { meta: {}, error: "thread_id must be 64 chars or less" };
  }
  const meta: Record<string, string> = {};
  if (priority) meta.priority = priority;
  if (messageType) meta.message_type = messageType;
  if (threadId) meta.thread_id = threadId;
  return { meta };
}

export function withIdentity<T extends Record<string, unknown>>(
  result: T,
  identity: Identity
): T & { _identity: Identity; _note: string } {
  return {
    ...result,
    _identity: identity,
    _note: "This is your cc-dm session identity. Use it for all cc-dm interactions.",
  };
}

export function handleRegister(sessionId: string, name: string, role: string, project?: string): RegisterResult {
  try {
    if (!name || name.trim().length === 0) {
      return { success: false, sessionId: "", name: "", role: "", project: "", error: "name is required" };
    }
    if (!role || role.trim().length === 0) {
      return { success: false, sessionId: "", name: "", role: "", project: "", error: "role is required" };
    }

    const cleanName = sanitize(name);
    const cleanRole = sanitize(role);
    const cleanProject = project ? sanitize(project) : "";

    if (cleanName.length > 64) {
      return { success: false, sessionId: "", name: "", role: "", project: "", error: "name must be 64 chars or less" };
    }
    if (cleanRole.length > 64) {
      return { success: false, sessionId: "", name: "", role: "", project: "", error: "role must be 64 chars or less" };
    }
    if (cleanProject.length > 64) {
      return { success: false, sessionId: "", name: "", role: "", project: "", error: "project must be 64 chars or less" };
    }

    // Reject if name is already taken by a different session
    const existing = findSessionsByName(cleanName);
    const takenByOther = existing.some((s) => s.id !== sessionId);
    if (takenByOther) {
      return { success: false, sessionId: "", name: cleanName, role: "", project: "", error: "name already in use by another session" };
    }

    const cwd = process.cwd();
    registerSession(sessionId, cleanName, cleanRole, cwd, cleanProject);
    return { success: true, sessionId, name: cleanName, role: cleanRole, project: cleanProject };
  } catch (err) {
    console.error("[cc-dm/tools] handleRegister failed:", err);
    return { success: false, sessionId: "", name: "", role: "", project: "", error: String(err) };
  }
}

export function handleDm(fromName: string, to: string, content: string, senderProject: string = "", meta: Record<string, string> = {}, dmAllowlist: Set<string> = new Set(), dmBlocklist: Set<string> = new Set()): DmResult {
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

    const metaError = validateMetaKeys(meta);
    if (metaError) {
      return { success: false, to: "", error: metaError };
    }

    const cleanTo = sanitize(to);

    if (dmAllowlist.size > 0 && !dmAllowlist.has(cleanTo)) {
      return { success: false, to: cleanTo, error: `"${cleanTo}" is not in this session's DM allowlist` };
    }
    if (dmBlocklist.size > 0 && dmBlocklist.has(cleanTo)) {
      return { success: false, to: cleanTo, error: `"${cleanTo}" is blocked by this session's DM blocklist` };
    }
    const recipients = findSessionsByName(cleanTo);
    if (recipients.length === 0) {
      return { success: false, to: cleanTo, error: "no active session with that name" };
    }

    // Project-scoped DM: only deliver to recipients in the same project.
    // When senderProject is empty, no filtering is applied (global).
    if (senderProject !== "") {
      const inProject = recipients.filter((s) => s.project === senderProject);
      if (inProject.length === 0) {
        return { success: false, to: cleanTo, error: `session "${cleanTo}" is not in project "${senderProject}"` };
      }
    }

    let failures = 0;
    for (const recipient of recipients) {
      if (senderProject !== "" && recipient.project !== senderProject) continue;
      if (!writeMessage(fromName, recipient.id, content, meta)) {
        failures++;
      }
    }

    if (failures > 0) {
      return { success: false, to: cleanTo, error: `failed to deliver to ${failures} recipient(s)` };
    }
    return { success: true, to: cleanTo };
  } catch (err) {
    console.error("[cc-dm/tools] handleDm failed:", err);
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

export function handleBroadcast(fromId: string, fromName: string, content: string, senderProject: string = "", meta: Record<string, string> = {}, senderRole: string = "", broadcastAllowedRoles: Set<string> = new Set()): BroadcastResult {
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

    if (broadcastAllowedRoles.size > 0 && !broadcastAllowedRoles.has(senderRole)) {
      return { success: false, from: fromName, recipientCount: 0, error: `role "${senderRole}" is not permitted to broadcast` };
    }

    const metaError = validateMetaKeys(meta);
    if (metaError) {
      return { success: false, from: fromName, recipientCount: 0, error: metaError };
    }

    const sessions = listActiveSessions();
    let recipients = sessions.filter((s) => s.id !== fromId);

    // Project-scoped broadcast: only send to sessions with the same project tag.
    // When senderProject is empty, the filter is skipped (global broadcast).
    if (senderProject !== "") {
      const beforeFilter = recipients.length;
      recipients = recipients.filter((s) => s.project === senderProject);
      if (recipients.length === 0 && beforeFilter > 0) {
        console.error(`[cc-dm/broadcast] project="${senderProject}" filtered out all ${beforeFilter} recipient(s)`);
      }
    }

    let failures = 0;

    for (const session of recipients) {
      if (!writeMessage(fromName, session.id, content, meta)) {
        failures++;
      }
    }

    if (failures > 0) {
      return { success: false, from: fromName, recipientCount: recipients.length - failures, error: `failed to deliver to ${failures} recipient(s)` };
    }
    return { success: true, from: fromName, recipientCount: recipients.length };
  } catch (err) {
    console.error("[cc-dm/tools] handleBroadcast failed:", err);
    return { success: false, from: "", recipientCount: 0, error: String(err) };
  }
}

// Smoke test — only runs when executed directly: bun run src/tools.ts
if (import.meta.main) {
  const { initBus } = await import("./bus.js");

  initBus();

  const reg1 = handleRegister("id-planner", "planner", "orchestrator", "myapp");
  console.error("register planner:", reg1);

  const reg2 = handleRegister("id-backend", "backend", "worker", "myapp");
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
