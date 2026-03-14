import { Loader2 } from "lucide-react";

import { cn } from "@/components/ui/cn";

export function Spinner({ size = 16, className }: { size?: number; className?: string }): React.ReactElement {
	return <Loader2 size={size} className={cn("animate-spin text-text-secondary", className)} />;
}
