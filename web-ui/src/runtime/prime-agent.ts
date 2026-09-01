import type { RuntimeAgentId } from "@/runtime/types";
export function isNativePrimeAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return false; // PTY for now, ACP disabled
}
export function isPrimeAcpEnabled(): boolean {
	return false;
}
