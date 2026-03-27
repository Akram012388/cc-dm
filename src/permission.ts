// Pure functions for permission relay: verdict parsing and request formatting.

export const VERDICT_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

export function parseVerdict(content: string): { requestId: string; behavior: "allow" | "deny" } | null {
  const match = VERDICT_RE.exec(content);
  if (!match) return null;
  const answer = match[1].toLowerCase();
  const requestId = match[2].toLowerCase();
  const behavior = (answer === "y" || answer === "yes") ? "allow" : "deny";
  return { requestId, behavior };
}

export type PermissionRequestParams = {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
  fromSession: string;
};

export function formatPermissionRequest(params: PermissionRequestParams): string {
  return [
    `[Permission Request] Session "${params.fromSession}" wants to use ${params.toolName}:`,
    `  ${params.description}`,
    params.inputPreview ? `  Input: ${params.inputPreview}` : "",
    `  Request ID: ${params.requestId}`,
    "",
    `Reply with "yes ${params.requestId}" to approve or "no ${params.requestId}" to deny.`,
  ].filter(Boolean).join("\n");
}
