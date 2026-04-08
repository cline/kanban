// The Cline API returns balance in micro-units (1 credit = 1,000,000 micro-units).
const MICRO_UNITS_PER_CREDIT = 1_000_000;

export function formatBalance(microUnits: number | null | undefined): string {
	if (microUnits === null || microUnits === undefined) {
		return "—";
	}
	const credits = microUnits / MICRO_UNITS_PER_CREDIT;
	return credits.toFixed(2);
}
