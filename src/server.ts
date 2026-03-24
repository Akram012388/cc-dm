// MCP server entry point. Declares claude/channel capability. Spawned by Claude Code via stdio.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initBus, readPendingMessages, deleteDeliveredMessage, deregisterSession } from "./bus.js";
import { handleDm, handleWho, handleRegister, handleBroadcast } from "./tools.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";
import { sanitize } from "./sanitize.js";

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
let sessionProject = SESSION_PROJECT;

type ChannelNotification = {
  method: "notifications/claude/channel";
  params: {
    content: string;
    meta: Record<string, string>;
  };
};

function buildRegistrationInstruction(): string {
  if (NAME_PROVIDED && ROLE_PROVIDED) {
    return `Your session is registered as "${SESSION_NAME}" with role "${SESSION_ROLE}". Do NOT call register unless the user explicitly asks to change the name or role.`;
  }
  const missing = [];
  if (!NAME_PROVIDED) missing.push("session name");
  if (!ROLE_PROVIDED) missing.push("role");
  return `Your ${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} not been configured. On your first interaction, invoke the /cc-dm:register skill to ask the user for ${missing.length === 1 ? "it" : "both values"}. Do NOT guess or self-assign values.`;
}

const registrationInstruction = buildRegistrationInstruction();

const server = new Server<never, ChannelNotification>(
  { name: "cc-dm", version: "1.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `You are connected to cc-dm. Your session id is "${SESSION_ID}". ${registrationInstruction} Messages from other sessions arrive as <channel source="cc-dm" from_session="..." to_session="...">. Act on messages addressed to your session name. Available tools: register, dm, who, broadcast.`,
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
      description: "Send a direct message to another session by name",
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
        sessionProject = result.project;
        console.error(`cc-dm session registered as "${sessionName}" project="${sessionProject}"`);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    case "dm": {
      const result = handleDm(
        sessionName,
        String(req.params.arguments?.to ?? ""),
        String(req.params.arguments?.content ?? "")
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    case "who": {
      const result = handleWho();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    case "broadcast": {
      const result = handleBroadcast(
        SESSION_ID,
        sessionName,
        String(req.params.arguments?.content ?? ""),
        sessionProject
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
      const messages = readPendingMessages(SESSION_ID);
      if (messages.length === 0) return;

      for (const message of messages) {
        if (deliveredIds.has(message.id)) {
          try { deleteDeliveredMessage(message.id); } catch { /* retry delete */ }
          continue;
        }
        try {
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: message.content,
              meta: {
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
  handleRegister(SESSION_ID, SESSION_NAME, SESSION_ROLE, SESSION_PROJECT);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  startHeartbeat(SESSION_ID);
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
