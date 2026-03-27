import { describe, test, expect } from "bun:test";
import { parseVerdict, formatPermissionRequest, VERDICT_RE } from "../src/permission.js";

describe("VERDICT_RE", () => {
  test("matches 'yes xxxxx'", () => {
    expect(VERDICT_RE.test("yes abcde")).toBe(true);
  });

  test("matches 'no xxxxx'", () => {
    expect(VERDICT_RE.test("no abcde")).toBe(true);
  });

  test("matches 'y xxxxx'", () => {
    expect(VERDICT_RE.test("y abcde")).toBe(true);
  });

  test("matches 'n xxxxx'", () => {
    expect(VERDICT_RE.test("n abcde")).toBe(true);
  });

  test("matches with leading/trailing whitespace", () => {
    expect(VERDICT_RE.test("  yes abcde  ")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(VERDICT_RE.test("YES ABCDE")).toBe(true);
    expect(VERDICT_RE.test("No AbCdE")).toBe(true);
  });

  test("rejects IDs with excluded chars (l, I, 1)", () => {
    expect(VERDICT_RE.test("yes abcle")).toBe(false);
  });

  test("rejects IDs shorter than 5 chars", () => {
    expect(VERDICT_RE.test("yes abcd")).toBe(false);
  });

  test("rejects IDs longer than 5 chars", () => {
    expect(VERDICT_RE.test("yes abcdef")).toBe(false);
  });

  test("rejects messages with extra text", () => {
    expect(VERDICT_RE.test("yes abcde sounds good")).toBe(false);
  });

  test("rejects non-verdict messages", () => {
    expect(VERDICT_RE.test("hello world")).toBe(false);
    expect(VERDICT_RE.test("")).toBe(false);
  });
});

describe("parseVerdict", () => {
  test("parses 'yes xxxxx' as allow", () => {
    const result = parseVerdict("yes abcde");
    expect(result).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  test("parses 'y xxxxx' as allow", () => {
    const result = parseVerdict("y abcde");
    expect(result).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  test("parses 'no xxxxx' as deny", () => {
    const result = parseVerdict("no abcde");
    expect(result).toEqual({ requestId: "abcde", behavior: "deny" });
  });

  test("parses 'n xxxxx' as deny", () => {
    const result = parseVerdict("n abcde");
    expect(result).toEqual({ requestId: "abcde", behavior: "deny" });
  });

  test("normalizes requestId to lowercase", () => {
    const result = parseVerdict("YES ABCDE");
    expect(result!.requestId).toBe("abcde");
  });

  test("returns null for non-verdict content", () => {
    expect(parseVerdict("hello world")).toBeNull();
    expect(parseVerdict("")).toBeNull();
    expect(parseVerdict("yes abcde extra text")).toBeNull();
  });

  test("returns null for IDs with excluded chars", () => {
    expect(parseVerdict("yes abcle")).toBeNull();
  });
});

describe("formatPermissionRequest", () => {
  test("formats a complete permission request message", () => {
    const msg = formatPermissionRequest({
      requestId: "abcde",
      toolName: "Bash",
      description: "Execute a shell command",
      inputPreview: '{"command": "rm -rf dist/"}',
      fromSession: "worker-1",
    });
    expect(msg).toContain("[Permission Request]");
    expect(msg).toContain("worker-1");
    expect(msg).toContain("Bash");
    expect(msg).toContain("abcde");
    expect(msg).toContain("rm -rf dist/");
    expect(msg).toContain("yes abcde");
    expect(msg).toContain("no abcde");
  });

  test("handles empty inputPreview", () => {
    const msg = formatPermissionRequest({
      requestId: "fghkm",
      toolName: "Write",
      description: "Write a file",
      inputPreview: "",
      fromSession: "backend",
    });
    expect(msg).toContain("Write");
    expect(msg).toContain("fghkm");
    expect(msg).not.toContain("Input:");
  });
});
