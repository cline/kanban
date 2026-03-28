import * as Sentry from "@sentry/react";
import { RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/button";

function AppErrorFallback({ error, resetError }: { error: unknown; resetError: () => void }): ReactElement {
	const message = error instanceof Error ? error.message : "Cline hit an unexpected UI error.";

	return (
		<div className="min-h-screen bg-surface-0 text-text-primary flex items-center justify-center p-6">
			<div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 shadow-2xl">
				<div className="flex items-center gap-3 text-text-primary">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg border border-status-red/30 bg-status-red/10 text-status-red">
						<TriangleAlert size={18} />
					</div>
					<div>
						<h1 className="text-lg font-semibold">Cline hit an unexpected UI error.</h1>
						<p className="mt-1 text-sm text-text-secondary">
							You can try rendering the app again or reload the page.
						</p>
					</div>
				</div>
				<div className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-secondary">
					{message}
				</div>
				<div className="mt-5 flex flex-wrap gap-2">
					<Button size="md" variant="default" icon={<RotateCcw size={16} />} onClick={resetError}>
						Try again
					</Button>
					<Button
						size="md"
						variant="primary"
						icon={<RefreshCw size={16} />}
						onClick={() => {
							window.location.reload();
						}}
					>
						Reload page
					</Button>
				</div>
			</div>
		</div>
	);
}

export function AppErrorBoundary({ children }: { children: ReactNode }): ReactElement {
	return (
		<Sentry.ErrorBoundary
			beforeCapture={(scope) => {
				scope.setTag("boundary", "root_app");
			}}
			fallback={({ error, resetError }) => <AppErrorFallback error={error} resetError={resetError} />}
		>
			{children}
		</Sentry.ErrorBoundary>
	);
}
