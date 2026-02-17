import { Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChatPermissionMessage, ChatPermissionOption } from "@/kanban/chat/types";

function PermissionButton({
	option,
	onClick,
}: {
	option: ChatPermissionOption;
	onClick: () => void;
}): React.ReactElement {
	const isAllow = option.kind === "allow_once" || option.kind === "allow_always";

	return (
		<Button
			variant={isAllow ? "outline" : "destructive"}
			size="xs"
			onClick={onClick}
			className={
				isAllow
					? "border-green-600/30 bg-green-600/20 text-green-400 hover:bg-green-600/30 hover:text-green-400"
					: "border-red-600/30 bg-red-600/20 text-red-400 hover:bg-red-600/30 hover:text-red-400"
			}
		>
			{option.name}
		</Button>
	);
}

export function PermissionRequestBlock({
	message,
	onRespond,
}: {
	message: ChatPermissionMessage;
	onRespond: (messageId: string, optionId: string) => void;
}): React.ReactElement {
	const { request, resolved, selectedOptionId } = message;
	const selectedOption = resolved
		? request.options.find((o) => o.optionId === selectedOptionId)
		: null;

	return (
		<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2">
				<Shield className="size-4 text-amber-400" />
				<span className="text-sm text-amber-400">Permission Required</span>
			</div>
			<p className="mt-1 text-sm text-zinc-300">"{request.toolCallTitle}"</p>

			{resolved ? (
				<p className="mt-2 text-xs italic text-zinc-500">
					{selectedOption ? selectedOption.name : "Resolved"}
				</p>
			) : (
				<div className="mt-3 flex gap-2">
					{request.options.map((option) => (
						<PermissionButton
							key={option.optionId}
							option={option}
							onClick={() => onRespond(message.id, option.optionId)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
