/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	readonly POSTHOG_KEY?: string;
	readonly POSTHOG_HOST?: string;
	readonly VITE_FORCE_SHOW_ONBOARDING_DIALOG?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
