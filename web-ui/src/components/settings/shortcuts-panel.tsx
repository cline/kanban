import * as RadixPopover from "@radix-ui/react-popover";
import { ChevronDown, Plus, X } from "lucide-react";
import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useRef, useState } from "react";

import { SettingSection } from "@/components/settings/setting-section";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeProjectShortcut } from "@/runtime/types";

function getNextShortcutLabel(shortcuts: RuntimeProjectShortcut[], baseLabel: string): string {
	const normalizedTakenLabels = new Set(
		shortcuts.map((s) => s.label.trim().toLowerCase()).filter((l) => l.length > 0),
	);
	const normalizedBaseLabel = baseLabel.trim().toLowerCase();
	if (!normalizedTakenLabels.has(normalizedBaseLabel)) {
		return baseLabel;
	}
	let suffix = 2;
	while (normalizedTakenLabels.has(`${normalizedBaseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

function ShortcutIconPicker({
	value,
	onSelect,
}: {
	value: string | undefined;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getRuntimeShortcutPickerOption(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-7 px-1.5 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<ShortcutIconDisplay icon={value} size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function ShortcutIconDisplay({ icon, size = 14 }: { icon: string | undefined; size?: number }): ReactElement {
	const Component = getRuntimeShortcutIconComponent(icon);
	return <Component size={size} />;
}

export function ShortcutsPanel({
	shortcuts,
	onShortcutsChange,
	controlsDisabled,
}: {
	shortcuts: RuntimeProjectShortcut[];
	onShortcutsChange: Dispatch<SetStateAction<RuntimeProjectShortcut[]>>;
	controlsDisabled: boolean;
}): ReactElement {
	const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);
	const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

	useEffect(() => {
		if (pendingScrollIndex === null) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const target = rowRefs.current[pendingScrollIndex] ?? null;
			if (target) {
				target.scrollIntoView({ block: "nearest", behavior: "smooth" });
				const firstInput = target.querySelector("input");
				firstInput?.focus();
				setPendingScrollIndex(null);
			}
		});
		return () => window.cancelAnimationFrame(frame);
	}, [pendingScrollIndex, shortcuts]);

	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<div className="flex items-center justify-between mb-1">
					<h2 className="text-base font-semibold text-text-primary m-0">Shortcuts</h2>
					<Button
						variant="ghost"
						size="sm"
						icon={<Plus size={14} />}
						onClick={() => {
							onShortcutsChange((current) => {
								const nextLabel = getNextShortcutLabel(current, "Run");
								setPendingScrollIndex(current.length);
								return [
									...current,
									{
										label: nextLabel,
										command: "",
										icon: "play",
									},
								];
							});
						}}
						disabled={controlsDisabled}
					>
						Add
					</Button>
				</div>
				<p className="text-[12px] text-text-secondary m-0">
					Project-level script shortcuts that appear on each task card.
				</p>
			</div>

			<SettingSection title="Script shortcuts">
				{shortcuts.length === 0 ? (
					<div className="px-4 py-6 text-center">
						<p className="text-text-tertiary text-[13px] m-0">No shortcuts configured.</p>
						<p className="text-text-tertiary text-[12px] mt-1 m-0">
							Add a shortcut to quickly run commands on tasks.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2 p-4">
						{shortcuts.map((shortcut, shortcutIndex) => (
							<div
								key={shortcutIndex}
								ref={(node) => {
									rowRefs.current[shortcutIndex] = node;
								}}
								className="grid gap-2"
								style={{ gridTemplateColumns: "max-content 1fr 2fr auto" }}
							>
								<ShortcutIconPicker
									value={shortcut.icon}
									onSelect={(icon) =>
										onShortcutsChange((current) =>
											current.map((item, i) => (i === shortcutIndex ? { ...item, icon } : item)),
										)
									}
								/>
								<input
									value={shortcut.label}
									onChange={(event) =>
										onShortcutsChange((current) =>
											current.map((item, i) =>
												i === shortcutIndex ? { ...item, label: event.target.value } : item,
											),
										)
									}
									placeholder="Label"
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<input
									value={shortcut.command}
									onChange={(event) =>
										onShortcutsChange((current) =>
											current.map((item, i) =>
												i === shortcutIndex ? { ...item, command: event.target.value } : item,
											),
										)
									}
									placeholder="Command"
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<Button
									variant="ghost"
									size="sm"
									icon={<X size={14} />}
									aria-label={`Remove shortcut ${shortcut.label}`}
									onClick={() => onShortcutsChange((current) => current.filter((_, i) => i !== shortcutIndex))}
								/>
							</div>
						))}
					</div>
				)}
			</SettingSection>
		</div>
	);
}
