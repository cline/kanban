// Remote access configuration.
// Persisted at ~/.cline/kanban/remote-config.json via config-store.ts.

export interface RemoteConfig {
	// Which login methods are accepted for remote clients.
	authMode: "workos" | "password" | "both";
	// Shared password for password-mode login. Empty string = disabled.
	password: string;
	// WorkOS email allowlist. Empty = any authenticated WorkOS user is allowed.
	allowedEmails: string[];
	// WorkOS domain allowlist (e.g. ["cline.bot"]). Empty = no domain restriction.
	allowedEmailDomains: string[];
	// Host-created local user accounts (email + hashed password).
	localUsers: RemoteLocalUser[];
	// Public base URL for the server-side OAuth relay (Option B).
	// Required for GET /auth/start to work. Empty = OAuth relay disabled.
	publicBaseUrl: string;
	// Admin-configured provider overrides. When an entry has enforced=true,
	// all task sessions use that provider/key instead of users' own settings.
	providerOverrides: RemoteProviderOverride[];
}

// Permission level for a remote user.
// Localhost users are always treated as "admin" regardless of stored role.
// New remote users default to "viewer" until an admin promotes them.
export type RemoteUserRole = "viewer" | "editor" | "admin";

// The resolved identity of whoever is making a tRPC request.
// Present for both localhost (from stored WorkOS token) and remote (from session cookie).
// Null when no identity can be resolved (e.g. localhost with no Cline account logged in).
export interface CallerIdentity {
	// Stable UUID per email address — assigned once and stored in remote.db.
	uuid: string;
	email: string;
	// WorkOS displayName, or the pre-@ portion of email for local/password users.
	displayName: string;
	// True if the request came from 127.0.0.1 / ::1.
	isLocal: boolean;
	// Permission level. Localhost callers are always "admin".
	// Remote users default to "viewer" until promoted by an admin.
	role: RemoteUserRole;
}

// An admin-configured provider override that can be enforced globally.
// When enforced, all users' task sessions use this provider/key instead of their own.
export interface RemoteProviderOverride {
	// Provider ID matching the Cline SDK's provider string (e.g. "cline", "anthropic", "openai").
	providerId: string;
	// Optional model lock. Empty string = use the user's own model selection.
	modelId: string;
	// API key — stored AES-256-GCM encrypted in remote-config.json via encryptApiKey().
	// Never exposed to clients in plaintext; the list endpoint returns "***" for this field.
	apiKeyEncrypted: string;
	// Optional base URL override (for self-hosted / compatible providers).
	baseUrl: string;
	// When true, this key overrides all users' own provider settings for sessions.
	// When false, it is stored but not applied (allows pre-configuration before enabling).
	enforced: boolean;
	// Optional human-readable label shown in the UI (e.g. "Shared Anthropic Key").
	label: string;
	createdAt: number;
}

// A host-created local account that logs in with email + password.
export interface RemoteLocalUser {
	email: string;
	// crypto.scrypt hash, stored as "salt:hash" both hex-encoded.
	passwordHash: string;
	createdAt: number;
}
