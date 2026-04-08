export function formatBalance(balance: number | null | undefined): string {
	if (balance === null || balance === undefined) {
		return "—";
	}
	return `$${balance.toFixed(2)}`;
}
