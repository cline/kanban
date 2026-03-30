import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { ChevronDown, Timer } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useId, useMemo } from "react";

import type { TaskSchedule } from "@/types";

type ScheduleType = "once" | "recurring";
type FrequencyUnit = "minutes" | "hours" | "days" | "weeks";

const FREQUENCY_UNIT_OPTIONS: Array<{ value: FrequencyUnit; label: string }> = [
	{ value: "minutes", label: "Minutes" },
	{ value: "hours", label: "Hours" },
	{ value: "days", label: "Days" },
	{ value: "weeks", label: "Weeks" },
];

const UNIT_TO_MS: Record<FrequencyUnit, number> = {
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
	weeks: 604_800_000,
};

function msToUnitAndValue(ms: number): { value: number; unit: FrequencyUnit } {
	if (ms >= UNIT_TO_MS.weeks && ms % UNIT_TO_MS.weeks === 0) {
		return { value: ms / UNIT_TO_MS.weeks, unit: "weeks" };
	}
	if (ms >= UNIT_TO_MS.days && ms % UNIT_TO_MS.days === 0) {
		return { value: ms / UNIT_TO_MS.days, unit: "days" };
	}
	if (ms >= UNIT_TO_MS.hours && ms % UNIT_TO_MS.hours === 0) {
		return { value: ms / UNIT_TO_MS.hours, unit: "hours" };
	}
	return { value: ms / UNIT_TO_MS.minutes, unit: "minutes" };
}

function buildSchedule(
	type: ScheduleType,
	intervalMs: number | undefined,
	cronExpression: string | undefined,
): TaskSchedule {
	return {
		type,
		intervalMs,
		cronExpression,
		nextRunAt: Date.now(),
		runCount: 0,
		enabled: true,
	};
}

export function TaskScheduleSection({
	schedule,
	onScheduleChange,
}: {
	schedule: TaskSchedule | undefined;
	onScheduleChange: (schedule: TaskSchedule | undefined) => void;
}): ReactElement {
	const isEnabled = schedule !== undefined;
	const scheduleTypeId = useId();
	const frequencyValueId = useId();
	const frequencyUnitId = useId();
	const cronInputId = useId();

	const scheduleType: ScheduleType = schedule?.type ?? "recurring";
	const useCron = schedule?.cronExpression != null && schedule.cronExpression.trim().length > 0;

	const { intervalValue, intervalUnit } = useMemo(() => {
		if (schedule?.intervalMs && schedule.intervalMs > 0) {
			const { value, unit } = msToUnitAndValue(schedule.intervalMs);
			return { intervalValue: value, intervalUnit: unit };
		}
		return { intervalValue: 1, intervalUnit: "weeks" as FrequencyUnit };
	}, [schedule?.intervalMs]);

	const cronExpression = schedule?.cronExpression ?? "";

	const handleToggle = useCallback(() => {
		if (isEnabled) {
			onScheduleChange(undefined);
		} else {
			onScheduleChange(buildSchedule("recurring", UNIT_TO_MS.weeks, undefined));
		}
	}, [isEnabled, onScheduleChange]);

	const handleTypeChange = useCallback(
		(newType: string) => {
			if (newType === "once" || newType === "recurring") {
				onScheduleChange(
					buildSchedule(
						newType,
						useCron ? undefined : intervalValue * UNIT_TO_MS[intervalUnit],
						useCron ? cronExpression : undefined,
					),
				);
			}
		},
		[cronExpression, intervalUnit, intervalValue, onScheduleChange, useCron],
	);

	const handleIntervalValueChange = useCallback(
		(raw: string) => {
			const parsed = Number.parseInt(raw, 10);
			if (Number.isNaN(parsed) || parsed <= 0) {
				return;
			}
			onScheduleChange(buildSchedule(scheduleType, parsed * UNIT_TO_MS[intervalUnit], undefined));
		},
		[intervalUnit, onScheduleChange, scheduleType],
	);

	const handleIntervalUnitChange = useCallback(
		(newUnit: string) => {
			if (newUnit === "minutes" || newUnit === "hours" || newUnit === "days" || newUnit === "weeks") {
				onScheduleChange(buildSchedule(scheduleType, intervalValue * UNIT_TO_MS[newUnit], undefined));
			}
		},
		[intervalValue, onScheduleChange, scheduleType],
	);

	const handleCronChange = useCallback(
		(value: string) => {
			onScheduleChange(buildSchedule(scheduleType, undefined, value));
		},
		[onScheduleChange, scheduleType],
	);

	const handleSwitchToCron = useCallback(() => {
		onScheduleChange(buildSchedule(scheduleType, undefined, "0 * * * *"));
	}, [onScheduleChange, scheduleType]);

	const handleSwitchToInterval = useCallback(() => {
		onScheduleChange(buildSchedule(scheduleType, UNIT_TO_MS.weeks, undefined));
	}, [onScheduleChange, scheduleType]);

	return (
		<RadixCollapsible.Root open={isEnabled} onOpenChange={() => handleToggle()}>
			<RadixCollapsible.Trigger asChild>
				<button
					type="button"
					className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none group"
				>
					<Timer
						size={13}
						className={isEnabled ? "text-accent" : "text-text-tertiary group-hover:text-text-secondary"}
					/>
					<span className={isEnabled ? "text-text-primary" : "text-text-tertiary group-hover:text-text-secondary"}>
						Schedule
					</span>
					<ChevronDown
						size={12}
						className={`transition-transform text-text-tertiary ${isEnabled ? "rotate-180" : ""}`}
					/>
				</button>
			</RadixCollapsible.Trigger>
			<ScheduleContent
				isEnabled={isEnabled}
				scheduleType={scheduleType}
				scheduleTypeId={scheduleTypeId}
				useCron={useCron}
				cronExpression={cronExpression}
				cronInputId={cronInputId}
				intervalValue={intervalValue}
				intervalUnit={intervalUnit}
				frequencyValueId={frequencyValueId}
				frequencyUnitId={frequencyUnitId}
				onTypeChange={handleTypeChange}
				onCronChange={handleCronChange}
				onIntervalValueChange={handleIntervalValueChange}
				onIntervalUnitChange={handleIntervalUnitChange}
				onSwitchToCron={handleSwitchToCron}
				onSwitchToInterval={handleSwitchToInterval}
			/>
		</RadixCollapsible.Root>
	);
}

function ScheduleContent({
	isEnabled,
	scheduleType,
	scheduleTypeId,
	useCron,
	cronExpression,
	cronInputId,
	intervalValue,
	intervalUnit,
	frequencyValueId,
	frequencyUnitId,
	onTypeChange,
	onCronChange,
	onIntervalValueChange,
	onIntervalUnitChange,
	onSwitchToCron,
	onSwitchToInterval,
}: {
	isEnabled: boolean;
	scheduleType: ScheduleType;
	scheduleTypeId: string;
	useCron: boolean;
	cronExpression: string;
	cronInputId: string;
	intervalValue: number;
	intervalUnit: FrequencyUnit;
	frequencyValueId: string;
	frequencyUnitId: string;
	onTypeChange: (value: string) => void;
	onCronChange: (value: string) => void;
	onIntervalValueChange: (value: string) => void;
	onIntervalUnitChange: (value: string) => void;
	onSwitchToCron: () => void;
	onSwitchToInterval: () => void;
}): ReactElement | null {
	if (!isEnabled) {
		return null;
	}

	const selectClass =
		"h-7 appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none";

	return (
		<RadixCollapsible.Content>
			<div className="flex flex-col gap-2 mt-2 pl-5">
				<div className="flex items-center gap-2">
					<label htmlFor={scheduleTypeId} className="text-[11px] text-text-secondary shrink-0">
						Type
					</label>
					<div className="relative inline-flex">
						<select
							id={scheduleTypeId}
							value={scheduleType}
							onChange={(e) => onTypeChange(e.currentTarget.value)}
							className={selectClass}
							style={{ width: "12ch", maxWidth: "100%" }}
						>
							<option value="recurring">Recurring</option>
							<option value="once">Once</option>
						</select>
						<ChevronDown
							size={14}
							className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
						/>
					</div>
				</div>

				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-[11px] text-text-secondary shrink-0">Every</span>
					{useCron ? (
						<CronFields
							cronInputId={cronInputId}
							cronExpression={cronExpression}
							onCronChange={onCronChange}
							onSwitchToInterval={onSwitchToInterval}
						/>
					) : (
						<IntervalFields
							frequencyValueId={frequencyValueId}
							frequencyUnitId={frequencyUnitId}
							intervalValue={intervalValue}
							intervalUnit={intervalUnit}
							onIntervalValueChange={onIntervalValueChange}
							onIntervalUnitChange={onIntervalUnitChange}
							onSwitchToCron={onSwitchToCron}
						/>
					)}
				</div>
			</div>
		</RadixCollapsible.Content>
	);
}

function CronFields({
	cronInputId,
	cronExpression,
	onCronChange,
	onSwitchToInterval,
}: {
	cronInputId: string;
	cronExpression: string;
	onCronChange: (value: string) => void;
	onSwitchToInterval: () => void;
}): ReactElement {
	return (
		<>
			<input
				id={cronInputId}
				type="text"
				value={cronExpression}
				onChange={(e) => onCronChange(e.currentTarget.value)}
				placeholder="* * * * *"
				className="h-7 w-[16ch] rounded-md border border-border-bright bg-surface-2 px-2 text-[12px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
			/>
			<button
				type="button"
				onClick={onSwitchToInterval}
				className="text-[11px] text-text-tertiary hover:text-text-secondary cursor-pointer shrink-0"
			>
				Use interval
			</button>
		</>
	);
}

function IntervalFields({
	frequencyValueId,
	frequencyUnitId,
	intervalValue,
	intervalUnit,
	onIntervalValueChange,
	onIntervalUnitChange,
	onSwitchToCron,
}: {
	frequencyValueId: string;
	frequencyUnitId: string;
	intervalValue: number;
	intervalUnit: FrequencyUnit;
	onIntervalValueChange: (value: string) => void;
	onIntervalUnitChange: (value: string) => void;
	onSwitchToCron: () => void;
}): ReactElement {
	return (
		<>
			<input
				id={frequencyValueId}
				type="number"
				min={1}
				value={intervalValue}
				onChange={(e) => onIntervalValueChange(e.currentTarget.value)}
				className="h-7 w-[6ch] rounded-md border border-border-bright bg-surface-2 px-2 text-[12px] text-text-primary focus:border-border-focus focus:outline-none tabular-nums"
			/>
			<div className="relative inline-flex">
				<select
					id={frequencyUnitId}
					value={intervalUnit}
					onChange={(e) => onIntervalUnitChange(e.currentTarget.value)}
					className="h-7 appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none"
					style={{ width: "10ch", maxWidth: "100%" }}
				>
					{FREQUENCY_UNIT_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<ChevronDown
					size={14}
					className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
				/>
			</div>
			<button
				type="button"
				onClick={onSwitchToCron}
				className="text-[11px] text-text-tertiary hover:text-text-secondary cursor-pointer shrink-0"
			>
				Use cron
			</button>
		</>
	);
}
