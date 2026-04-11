// The Cline API returns balance in micro-units (1 credit = 1,000,000 micro-units).
const MICRO_UNITS_PER_CREDIT = 1_000_000;
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export function formatBalance(microUnits: number | null | undefined): string {
	if (microUnits === null || microUnits === undefined) {
		return "-";
	}
	const credits = microUnits / MICRO_UNITS_PER_CREDIT;
	return USD_FORMATTER.format(credits);
}
