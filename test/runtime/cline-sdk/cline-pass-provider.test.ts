import { describe, expect, it } from "vitest";
import {
	CLINE_PASS_DEFAULT_MODEL_ID,
	CLINE_PASS_PROVIDER_ID,
	isClineAccountProviderId,
	isClinePassProviderId,
	resolveSdkRuntimeProviderId,
} from "../../../src/cline-sdk/cline-pass-provider";

describe("isClinePassProviderId", () => {
	it("matches the ClinePass provider id regardless of casing and padding", () => {
		expect(isClinePassProviderId("cline-pass")).toBe(true);
		expect(isClinePassProviderId(" Cline-Pass ")).toBe(true);
	});

	it("does not match other providers or missing ids", () => {
		expect(isClinePassProviderId("cline")).toBe(false);
		expect(isClinePassProviderId("clinepass")).toBe(false);
		expect(isClinePassProviderId(null)).toBe(false);
		expect(isClinePassProviderId(undefined)).toBe(false);
	});
});

describe("isClineAccountProviderId", () => {
	it("accepts both providers that authenticate with a Cline account", () => {
		expect(isClineAccountProviderId("cline")).toBe(true);
		expect(isClineAccountProviderId("cline-pass")).toBe(true);
	});

	it("rejects providers that use their own credentials", () => {
		expect(isClineAccountProviderId("anthropic")).toBe(false);
		expect(isClineAccountProviderId("openai-codex")).toBe(false);
		expect(isClineAccountProviderId("oca")).toBe(false);
		expect(isClineAccountProviderId(null)).toBe(false);
	});
});

describe("resolveSdkRuntimeProviderId", () => {
	it("routes ClinePass through the provider the bundled SDK registers", () => {
		expect(resolveSdkRuntimeProviderId(CLINE_PASS_PROVIDER_ID)).toBe("cline");
	});

	it("leaves every other provider id untouched", () => {
		expect(resolveSdkRuntimeProviderId("cline")).toBe("cline");
		expect(resolveSdkRuntimeProviderId("anthropic")).toBe("anthropic");
		expect(resolveSdkRuntimeProviderId("my-custom-provider")).toBe("my-custom-provider");
	});
});

describe("ClinePass model ids", () => {
	it("keeps the ClinePass namespace on the default model, which is what routes billing", () => {
		expect(CLINE_PASS_DEFAULT_MODEL_ID.startsWith(`${CLINE_PASS_PROVIDER_ID}/`)).toBe(true);
	});
});
