import type { BoardData } from "@/kanban/types";

export const initialBoardData: BoardData = {
	columns: [
		{
			id: "backlog",
			title: "Backlog",
			cards: [
				{
					id: "b-1",
					title: "Collect agent requirements",
					body: "Gather functional requirements from stakeholders and document acceptance criteria for the orchestration system.",
				},
				{
					id: "b-2",
					title: "Define task intake schema",
					body: "Design the JSON schema for how tasks get submitted to the orchestrator.",
				},
			],
		},
		{
			id: "planning",
			title: "Planning",
			cards: [
				{
					id: "p-1",
					title: "Draft execution checklist",
					body: "Create step-by-step checklist for the agent execution pipeline.",
				},
				{
					id: "p-2",
					title: "Map service ownership",
					body: "Document which team owns each microservice and its deployment process.",
				},
			],
		},
		{
			id: "running",
			title: "Running",
			cards: [
				{
					id: "r-1",
					title: "Implement board shell",
					body: "Build the basic board layout with columns and card rendering.",
				},
				{
					id: "r-2",
					title: "Set up status webhooks",
					body: "Configure webhook endpoints to receive real-time status updates from agents.",
				},
			],
		},
		{
			id: "review",
			title: "Review",
			cards: [
				{
					id: "v-1",
					title: "QA board interactions",
					body: "Test all drag-and-drop interactions and verify state consistency.",
				},
			],
		},
		{
			id: "done",
			title: "Done",
			cards: [
				{
					id: "d-1",
					title: "Bootstrap web UI app",
					body: "Initial project setup with Vite, React, TypeScript, and Tailwind.",
				},
			],
		},
	],
};
