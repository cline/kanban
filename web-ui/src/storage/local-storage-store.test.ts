import { afterEach, describe, expect, it } from "vitest";

import {
	LocalStorageKey,
	readLocalStorageItem,
	writeLocalStorageItem,
} from "@/storage/local-storage-store";

function setWindowLocalStorage(storage: unknown): void {
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}

describe("local-storage-store", () => {
	const originalLocalStorage = window.localStorage;

	afterEach(() => {
		setWindowLocalStorage(originalLocalStorage);
	});

	it("reads and writes values when localStorage is usable", () => {
		writeLocalStorageItem(LocalStorageKey.TaskAutoReviewMode, "commit");
		expect(readLocalStorageItem(LocalStorageKey.TaskAutoReviewMode)).toBe("commit");
	});

	it("returns null when localStorage is incomplete", () => {
		setWindowLocalStorage({});
		expect(readLocalStorageItem(LocalStorageKey.TaskAutoReviewMode)).toBeNull();
	});

	it("ignores writes when localStorage is incomplete", () => {
		setWindowLocalStorage({ getItem: () => null });
		expect(() => writeLocalStorageItem(LocalStorageKey.TaskAutoReviewMode, "commit")).not.toThrow();
	});
});
