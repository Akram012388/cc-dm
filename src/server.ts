// MCP server entry point. Declares claude/channel capability. Spawned by Claude Code via stdio.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initBus, readMessages } from "./bus.js";
import { handleDm, handleWho, handleRegister, handleBroadcast } from "./tools.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";

const SESSION_ID =
  process.env.CC_DM_SESSION_ID?.trim() ||
  `session-${Math.random().toString(16).slice(2, 8)}`;

const SESSION_ROLE = process.env.CC_DM_SESSION_ROLE?.trim() || "worker";

let activeSessionId = SESSION_ID;

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
    instructions: `You are connected to cc-dm. Your session id is "${SESSION_ID}". Messages from other sessions arrive as <channel source="cc-dm" from_session="..." to_session="...">. Act on messages addressed to your session id or to_session="all". Available tools: register, dm, who, broadcast. Always register your session on startup if not already registered.`,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "register",
      description: "Register this session with a name and role in cc-dm",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: {
            type: "string",
            description: "Unique name for this session e.g. planner, backend, tests",
          },
          role: {
            type: "string",
            description: "Role description e.g. orchestrator, worker, reviewer",
          },
        },
        required: ["session_id", "role"],
      },
    },
    {
      name: "dm",
      description: "Send a direct message to another session or to all sessions",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description: "Target session id, or 'all' to broadcast",
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
        String(req.params.arguments?.session_id ?? ""),
        String(req.params.arguments?.role ?? "")
      );
      if (result.success && result.sessionId !== activeSessionId) {
        activeSessionId = result.sessionId;
        startHeartbeat(activeSessionId);
        console.error(`cc-dm session identity updated to "${activeSessionId}"`);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    case "dm": {
      const result = handleDm(
        activeSessionId,
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
        activeSessionId,
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
      const messages = readMessages(activeSessionId);
      if (messages.length === 0) return;

      for (const message of messages) {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: message.content,
            meta: {
              from_session: message.from_session,
              to_session: activeSessionId,
              message_id: String(message.id),
              sent_at: message.created_at,
            },
          },
        });
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
  process.exit(0);
}

async function main(): Promise<void> {
  initBus();
  handleRegister(SESSION_ID, SESSION_ROLE);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  startHeartbeat(SESSION_ID);
  setTimeout(() => {
    startPollLoop();
  }, 1000);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(`cc-dm session "${SESSION_ID}" (${SESSION_ROLE}) started`);
  console.error(`Bus: ~/.cc-dm/bus.db`);
  console.error(`Poll: 500ms`);
}

main().catch((err) => {
  console.error("cc-dm fatal error:", err);
  process.exit(1);
});
