import * as RadixPopover from "@radix-ui/react-popover";
import { Check, Languages } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useI18n } from "@/i18n/i18n-context";
import { APP_LANGUAGES, type AppLanguage, getLanguageOptionKey } from "@/i18n/translations";

export function LanguageSwitcher({ className }: { className?: string }): ReactElement {
	const { language, setLanguage, t } = useI18n();
	const [open, setOpen] = useState(false);
	const currentLanguage = APP_LANGUAGES.find((item) => item.id === language) ?? APP_LANGUAGES[0];
	const currentLanguageLabel = t(getLanguageOptionKey(currentLanguage.id));

	const handleSelect = (nextLanguage: AppLanguage) => {
		setLanguage(nextLanguage);
		setOpen(false);
	};

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<Button
					variant="ghost"
					size="sm"
					icon={<Languages size={16} />}
					aria-label={t("language.switcher.label")}
					title={t("language.current", { language: currentLanguageLabel })}
					className={className}
				>
					<span className="text-[11px] text-text-tertiary">{currentLanguage.shortLabel}</span>
				</Button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 min-w-[132px] rounded-lg border border-border bg-surface-2 p-1 shadow-xl"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
					sideOffset={5}
					align="end"
				>
					{APP_LANGUAGES.map((item) => (
						<button
							type="button"
							key={item.id}
							className={cn(
								"flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-3",
								item.id === language && "bg-surface-3",
							)}
							onClick={() => handleSelect(item.id)}
						>
							<span className="flex-1">{t(getLanguageOptionKey(item.id))}</span>
							{item.id === language ? <Check size={14} className="text-text-secondary" /> : null}
						</button>
					))}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
