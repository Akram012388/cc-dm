import { test, expect } from "bun:test";
import { sanitize } from "../src/sanitize.js";

test("trims whitespace", () => {
  expect(sanitize("  hello  ")).toBe("hello");
});

test("lowercases", () => {
  expect(sanitize("PLANNER")).toBe("planner");
});

test("replaces spaces with hyphens", () => {
  expect(sanitize("my session name")).toBe("my-session-name");
});

test("collapses multiple spaces to single hyphen", () => {
  expect(sanitize("too   many    spaces")).toBe("too-many-spaces");
});

test("handles empty-after-trim", () => {
  expect(sanitize("   ")).toBe("");
});
