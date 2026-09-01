import type { RuntimeAgentId } from "@/runtime/types";
export function isNativePrimeAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId === "prime";
}
export function isPrimeAcpEnabled(): boolean {
	return true;
}
