// MCP server entry point. Declares claude/channel capability. Spawned by Claude Code via stdio.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { initBus, readPendingMessages, deleteDeliveredMessage, deregisterSession, registerSession } from "./bus.js";
import { handleDm, handleWho, handleRegister, handleBroadcast, withIdentity, buildMeta } from "./tools.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";
import { sanitize } from "./sanitize.js";
import { parseVerdict, formatPermissionRequest } from "./permission.js";

const SESSION_ID = `session-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

const NAME_PROVIDED = !!(process.env.CC_DM_SESSION_NAME?.trim() || process.env.CC_DM_SESSION_ID?.trim());
const ROLE_PROVIDED = !!process.env.CC_DM_SESSION_ROLE?.trim();

const SESSION_NAME = sanitize(
  process.env.CC_DM_SESSION_NAME?.trim() ||
  process.env.CC_DM_SESSION_ID?.trim() ||
  SESSION_ID
);

const SESSION_ROLE = sanitize(
  process.env.CC_DM_SESSION_ROLE?.trim() || "worker"
);

const SESSION_PROJECT = sanitize(
  process.env.CC_DM_SESSION_PROJECT?.trim() || ""
);

let sessionName = SESSION_NAME;
let sessionRole = SESSION_ROLE;
let sessionProject = SESSION_PROJECT;

const PERMISSION_RELAY = process.env.CC_DM_PERMISSION_RELAY === "1";
const PERMISSION_APPROVER = process.env.CC_DM_PERMISSION_APPROVER?.trim() || "";

const BROADCAST_ALLOWED_ROLES = new Set(
  (process.env.CC_DM_BROADCAST_ALLOWED_ROLES?.trim() || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const DM_ALLOWLIST = new Set(
  (process.env.CC_DM_DM_ALLOWLIST?.trim() || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const DM_BLOCKLIST = new Set(
  (process.env.CC_DM_DM_BLOCKLIST?.trim() || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

if (DM_ALLOWLIST.size > 0 && DM_BLOCKLIST.size > 0) {
  console.error("[cc-dm] Fatal: CC_DM_DM_ALLOWLIST and CC_DM_DM_BLOCKLIST are mutually exclusive. Set one or neither.");
  process.exit(1);
}

type ChannelNotification = {
  method: "notifications/claude/channel";
  params: {
    content: string;
    meta: Record<string, string>;
  };
};

type PermissionVerdict = {
  method: "notifications/claude/channel/permission";
  params: {
    request_id: string;
    behavior: "allow" | "deny";
  };
};

type PendingPermission = {
  requestId: string;
  timestamp: number;
};

const pendingPermissions = new Map<string, PendingPermission>();

const PERMISSION_EXPIRY_MS = 5 * 60 * 1000;

function cleanupExpiredPermissions(): void {
  const cutoff = Date.now() - PERMISSION_EXPIRY_MS;
  for (const [id, entry] of pendingPermissions) {
    if (entry.timestamp < cutoff) pendingPermissions.delete(id);
  }
}

const PermissionRequestNotificationSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

function buildRegistrationInstruction(): string {
  if (NAME_PROVIDED && ROLE_PROVIDED) {
    const projectNote = SESSION_PROJECT
      ? ` in project "${SESSION_PROJECT}"`
      : " with no project scope (broadcasts will be global)";
    return `Your session is registered as "${SESSION_NAME}" with role "${SESSION_ROLE}"${projectNote}. Do NOT call register unless the user explicitly asks to change the name, role, or project.`;
  }
  const missing = [];
  if (!NAME_PROVIDED) missing.push("session name");
  if (!ROLE_PROVIDED) missing.push("role");
  return `Your ${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} not been configured. On your first interaction, invoke the /cc-dm:register skill to ask the user for ${missing.length === 1 ? "it" : "both values"}. Do NOT guess or self-assign values.`;
}

const registrationInstruction = buildRegistrationInstruction();

const experimentalCapabilities: Record<string, object> = { "claude/channel": {} };
if (PERMISSION_RELAY) {
  experimentalCapabilities["claude/channel/permission"] = {};
}

const permissionNote = PERMISSION_RELAY
  ? ` Tool approvals for this session are relayed via cc-dm${PERMISSION_APPROVER ? ` to "${PERMISSION_APPROVER}"` : " to all project sessions"}. Approvals may take longer than usual.`
  : "";

const server = new Server<never, ChannelNotification | PermissionVerdict>(
  { name: "cc-dm", version: "1.3.0" },
  {
    capabilities: {
      experimental: experimentalCapabilities,
      tools: {},
    },
    instructions: `You are connected to cc-dm. Your session id is "${SESSION_ID}". ${registrationInstruction}${permissionNote} Messages from other sessions arrive as <channel source="cc-dm" from_session="..." to_session="...">. Act on messages addressed to your session name. Available tools: register, dm, who, broadcast.`,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "register",
      description: "Register this session with a display name, role, and optional project in cc-dm",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Display name for this session e.g. planner, backend, tests",
          },
          role: {
            type: "string",
            description: "Role description e.g. orchestrator, worker, reviewer",
          },
          project: {
            type: "string",
            description: "Project tag for this session e.g. myapp, api-server. If set, broadcasts are scoped to sessions with the same project tag.",
          },
        },
        required: ["name", "role"],
      },
    },
    {
      name: "dm",
      description: "Send a direct message to another session by name. If this session has a project set, only sessions in the same project can be reached.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description: "Target session name",
          },
          content: {
            type: "string",
            description: "Message content to send",
          },
          priority: {
            type: "string",
            enum: ["urgent", "normal", "low"],
            description: "Message priority (default: normal)",
          },
          message_type: {
            type: "string",
            enum: ["task", "question", "status", "review"],
            description: "Message type for categorization",
          },
          thread_id: {
            type: "string",
            maxLength: 64,
            description: "Thread ID for conversation threading",
          },
        },
        required: ["to", "content"],
      },
    },
    {
      name: "who",
      description: "List all active cc-dm sessions on this machine",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "broadcast",
      description: "Broadcast a message to active sessions. If this session has a project set, only sessions in the same project receive the message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          content: {
            type: "string",
            description: "Message to send to all active sessions",
          },
          priority: {
            type: "string",
            enum: ["urgent", "normal", "low"],
            description: "Message priority (default: normal)",
          },
          message_type: {
            type: "string",
            enum: ["task", "question", "status", "review"],
            description: "Message type for categorization",
          },
          thread_id: {
            type: "string",
            maxLength: 64,
            description: "Thread ID for conversation threading",
          },
        },
        required: ["content"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  switch (req.params.name) {
    case "register": {
      const requestedProject = req.params.arguments?.project;
      const projectArg = requestedProject !== undefined
        ? String(requestedProject)
        : sessionProject;

      const result = handleRegister(
        SESSION_ID,
        String(req.params.arguments?.name ?? ""),
        String(req.params.arguments?.role ?? ""),
        projectArg
      );
      if (result.success) {
        sessionName = result.name;
        sessionRole = result.role;
        sessionProject = result.project;
        console.error(`cc-dm session registered as "${sessionName}" role="${sessionRole}" project="${sessionProject}"`);
      }
      const enriched = withIdentity(result, { name: sessionName, role: sessionRole, project: sessionProject });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
    case "dm": {
      const { meta, error: metaError } = buildMeta(
        req.params.arguments?.priority as string | undefined,
        req.params.arguments?.message_type as string | undefined,
        req.params.arguments?.thread_id as string | undefined,
      );
      if (metaError) {
        const errResult = { success: false, to: "", error: metaError };
        const enriched = withIdentity(errResult, { name: sessionName, role: sessionRole, project: sessionProject });
        return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
      }
      const result = handleDm(
        sessionName,
        String(req.params.arguments?.to ?? ""),
        String(req.params.arguments?.content ?? ""),
        sessionProject,
        meta,
        DM_ALLOWLIST,
        DM_BLOCKLIST
      );
      const enriched = withIdentity(result, { name: sessionName, role: sessionRole, project: sessionProject });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
    case "who": {
      const result = handleWho();
      const enriched = withIdentity(result, { name: sessionName, role: sessionRole, project: sessionProject });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
    case "broadcast": {
      const { meta, error: metaError } = buildMeta(
        req.params.arguments?.priority as string | undefined,
        req.params.arguments?.message_type as string | undefined,
        req.params.arguments?.thread_id as string | undefined,
      );
      if (metaError) {
        const errResult = { success: false, from: sessionName, recipientCount: 0, error: metaError };
        const enriched = withIdentity(errResult, { name: sessionName, role: sessionRole, project: sessionProject });
        return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
      }
      const result = handleBroadcast(
        SESSION_ID,
        sessionName,
        String(req.params.arguments?.content ?? ""),
        sessionProject,
        meta,
        sessionRole,
        BROADCAST_ALLOWED_ROLES
      );
      const enriched = withIdentity(result, { name: sessionName, role: sessionRole, project: sessionProject });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
    default:
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown tool" }) }] };
  }
});

let pollTimer: ReturnType<typeof setInterval> | null = null;
const deliveredIds = new Set<number>();

function startPollLoop(): void {
  pollTimer = setInterval(async () => {
    try {
      cleanupExpiredPermissions();
      const messages = readPendingMessages(SESSION_ID);
      if (messages.length === 0) return;

      for (const message of messages) {
        if (deliveredIds.has(message.id)) {
          try { deleteDeliveredMessage(message.id); } catch (err) { console.error(`[cc-dm/poll] retry delete failed for message ${message.id}:`, err); }
          continue;
        }

        // Verdict interception: check if this message is a permission verdict
        if (PERMISSION_RELAY && pendingPermissions.size > 0) {
          const verdict = parseVerdict(message.content);
          if (verdict && pendingPermissions.has(verdict.requestId)) {
            try {
              await server.notification({
                method: "notifications/claude/channel/permission",
                params: {
                  request_id: verdict.requestId,
                  behavior: verdict.behavior,
                },
              });
              pendingPermissions.delete(verdict.requestId);
              console.error(`[cc-dm/permission] verdict "${verdict.behavior}" for request ${verdict.requestId} from ${message.from_session}`);
              deleteDeliveredMessage(message.id);
            } catch (err) {
              console.error(`[cc-dm/permission] failed to deliver verdict for ${verdict.requestId}:`, err);
            }
            continue;
          }
        }

        try {
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: message.content,
              meta: {
                ...message.meta,
                from_session: message.from_session,
                to_session: sessionName,
                message_id: String(message.id),
                sent_at: message.created_at,
              },
            },
          });
          deliveredIds.add(message.id);
          deleteDeliveredMessage(message.id);
          deliveredIds.delete(message.id);
        } catch (err) {
          console.error(`[cc-dm/poll] failed to deliver message ${message.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cc-dm/poll] error reading messages:", err);
    }
  }, 500);
}

export function stopPollLoop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function shutdown(): void {
  stopPollLoop();
  stopHeartbeat();
  deregisterSession(SESSION_ID);
  console.error(`cc-dm session "${sessionName}" (${SESSION_ID}) deregistered`);
  process.exit(0);
}

async function main(): Promise<void> {
  initBus();
  const initialReg = handleRegister(SESSION_ID, SESSION_NAME, SESSION_ROLE, SESSION_PROJECT);
  if (!initialReg.success) {
    console.error(`[cc-dm] initial registration failed: ${initialReg.error}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (PERMISSION_RELAY) {
    server.setNotificationHandler(PermissionRequestNotificationSchema, async ({ params }) => {
      const { request_id, tool_name, description, input_preview } = params;
      pendingPermissions.set(request_id, { requestId: request_id, timestamp: Date.now() });
      const content = formatPermissionRequest({
        requestId: request_id,
        toolName: tool_name,
        description,
        inputPreview: input_preview,
        fromSession: sessionName,
      });

      if (PERMISSION_APPROVER) {
        const result = handleDm(sessionName, PERMISSION_APPROVER, content, sessionProject);
        if (!result.success) {
          console.error(`[cc-dm/permission] failed to relay request ${request_id} to "${PERMISSION_APPROVER}": ${result.error}`);
        } else {
          console.error(`[cc-dm/permission] relayed request ${request_id} (${tool_name}) to "${PERMISSION_APPROVER}"`);
        }
      } else {
        const result = handleBroadcast(SESSION_ID, sessionName, content, sessionProject);
        console.error(`[cc-dm/permission] broadcast request ${request_id} (${tool_name}) to ${result.recipientCount} session(s)`);
      }
    });
    console.error(`[cc-dm/permission] relay enabled${PERMISSION_APPROVER ? ` → approver: "${PERMISSION_APPROVER}"` : " → broadcast to project"}`);
  }

  startHeartbeat(SESSION_ID, () => {
    try {
      registerSession(SESSION_ID, sessionName, sessionRole, process.cwd(), sessionProject);
      console.error(`[cc-dm/heartbeat] session ghosted — re-registered as "${sessionName}"`);
    } catch (err) {
      console.error("[cc-dm/heartbeat] ghost re-registration failed:", err);
    }
  });
  setTimeout(() => {
    startPollLoop();
  }, 1000);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  console.error(`cc-dm session "${SESSION_NAME}" [${SESSION_ID}] (${SESSION_ROLE}) project="${SESSION_PROJECT}" started`);
  console.error(`Bus: ~/.cc-dm/bus.db`);
  console.error(`Poll: 500ms`);
}

main().catch((err) => {
  console.error("cc-dm fatal error:", err);
  process.exit(1);
});
