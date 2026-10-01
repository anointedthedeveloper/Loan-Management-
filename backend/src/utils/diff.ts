/** Returns only the top-level fields that differ, so audit entries stay small and readable. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[] = []) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.includes(key)) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) { b[key] = before[key] ?? null; a[key] = after[key] ?? null; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
