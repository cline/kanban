import type {
	RuntimePushSubscribeRequest,
	RuntimePushSubscribeResponse,
	RuntimePushUnsubscribeRequest,
	RuntimePushUnsubscribeResponse,
	RuntimePushVapidPublicKeyResponse,
} from "../core/api-contract";
import type { PushNotificationService } from "../server/push-notification-service";

export interface PushApiDependencies {
	pushService: PushNotificationService;
}

export interface PushApi {
	getVapidPublicKey: () => RuntimePushVapidPublicKeyResponse;
	subscribe: (input: RuntimePushSubscribeRequest) => Promise<RuntimePushSubscribeResponse>;
	unsubscribe: (input: RuntimePushUnsubscribeRequest) => Promise<RuntimePushUnsubscribeResponse>;
}

export function createPushApi(deps: PushApiDependencies): PushApi {
	return {
		getVapidPublicKey: () => ({
			publicKey: deps.pushService.getVapidPublicKey(),
		}),
		subscribe: async (input) => {
			await deps.pushService.subscribe(input);
			return { ok: true };
		},
		unsubscribe: async (input) => {
			await deps.pushService.unsubscribe(input.endpoint);
			return { ok: true };
		},
	};
}
