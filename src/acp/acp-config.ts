export function isPrimeAcpEnabled(): boolean {
  const raw = process.env.KANBAN_PRIME_ACP_ENABLED ?? process.env.PRIME_ACP_ENABLED;
  if (raw === undefined || raw === null || raw.trim() === "") {
    return true;
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
export function isPrimeAcpFeatureFlagged(): boolean {
  return isPrimeAcpEnabled();
}
