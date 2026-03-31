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
}

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
}

// A host-created local account that logs in with email + password.
export interface RemoteLocalUser {
	email: string;
	// crypto.scrypt hash, stored as "salt:hash" both hex-encoded.
	passwordHash: string;
	createdAt: number;
}
