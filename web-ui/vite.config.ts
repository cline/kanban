import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), react()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 4173,
		strictPort: true,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8484",
				changeOrigin: true,
			},
		},
	},
});
