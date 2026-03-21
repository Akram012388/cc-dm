// MCP server entry point. Declares claude/channel capability. Spawned by Claude Code via stdio.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initBus, readPendingMessages, markDelivered, deregisterSession } from "./bus.js";
import { handleDm, handleWho, handleRegister, handleBroadcast } from "./tools.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";

const SESSION_ID = `session-${Math.random().toString(16).slice(2, 8)}`;

const SESSION_NAME =
  process.env.CC_DM_SESSION_NAME?.trim() ||
  process.env.CC_DM_SESSION_ID?.trim() ||
  SESSION_ID;

const SESSION_ROLE = process.env.CC_DM_SESSION_ROLE?.trim() || "worker";

let sessionName = SESSION_NAME;

type ChannelNotification = {
  method: "notifications/claude/channel";
  params: {
    content: string;
    meta: Record<string, string>;
  };
};

const server = new Server<never, ChannelNotification>(
  { name: "cc-dm", version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `You are connected to cc-dm. Your session id is "${SESSION_ID}". Messages from other sessions arrive as <channel source="cc-dm" from_session="..." to_session="...">. Act on messages addressed to your session name or to_session="all". Available tools: register, dm, who, broadcast. Always register your session on startup if not already registered.`,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "register",
      description: "Register this session with a display name and role in cc-dm",
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
      description: "Broadcast a message to all active sessions",
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
      const result = handleRegister(
        SESSION_ID,
        String(req.params.arguments?.name ?? ""),
        String(req.params.arguments?.role ?? "")
      );
      if (result.success) {
        sessionName = result.name;
        console.error(`cc-dm session name updated to "${sessionName}"`);
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
        String(req.params.arguments?.content ?? "")
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    default:
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown tool" }) }] };
  }
});

let pollTimer: ReturnType<typeof setInterval> | null = null;

// Using notification() — sendNotification() not available in installed SDK version
function startPollLoop(): void {
  pollTimer = setInterval(async () => {
    try {
      const messages = readPendingMessages(SESSION_ID);
      if (messages.length === 0) return;

      for (const message of messages) {
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
        markDelivered(message.id);
      }
    } catch (err) {
      console.error("[cc-dm/poll] error:", err);
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
  handleRegister(SESSION_ID, SESSION_NAME, SESSION_ROLE);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  startHeartbeat(SESSION_ID);
  setTimeout(() => {
    startPollLoop();
  }, 1000);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  console.error(`cc-dm session "${SESSION_NAME}" [${SESSION_ID}] (${SESSION_ROLE}) started`);
  console.error(`Bus: ~/.cc-dm/bus.db`);
  console.error(`Poll: 500ms`);
}

main().catch((err) => {
  console.error("cc-dm fatal error:", err);
  process.exit(1);
});
