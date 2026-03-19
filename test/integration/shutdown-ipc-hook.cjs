process.on("message", (message) => {
	if (!message || typeof message !== "object") {
		return;
	}

	if (message.type !== "kanban.shutdown") {
		return;
	}

	process.emit("SIGINT");
});
