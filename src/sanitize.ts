// Shared string sanitizer: trim, lowercase, spaces→hyphens.

export function sanitize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
