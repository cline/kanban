import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import type { RuntimeAgentId } from "@/runtime/types";

export interface TaskAgentOption {
	value: RuntimeAgentId;
	label: string;
	installed: boolean;
}

export function TaskAgentSelect({
	id,
	value,
	options,
	onChange,
}: {
	id?: string;
	value: RuntimeAgentId | null;
	options: TaskAgentOption[];
	onChange: (value: RuntimeAgentId) => void;
}): ReactElement {
	return (
		<div>
			<span className="text-[11px] text-text-secondary block mb-1">Agent runtime</span>
			<div className="relative inline-flex w-full">
				<select
					id={id}
					value={value ?? ""}
					onChange={(event) => onChange(event.currentTarget.value as RuntimeAgentId)}
					className="h-8 w-full appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none disabled:cursor-default disabled:text-text-secondary"
					disabled={options.length === 0}
				>
					<option value="" disabled>
						{options.length === 0 ? "Loading runtimes…" : "Select runtime"}
					</option>
					{options.map((option) => (
						<option key={option.value} value={option.value} disabled={!option.installed}>
							{option.label}
							{option.installed ? "" : " (not installed)"}
						</option>
					))}
				</select>
				<ChevronDown
					size={14}
					className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
				/>
			</div>
		</div>
	);
}
