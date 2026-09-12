import type { LlmConfig } from "../types";
import {
  buildDefaultLlmSettings,
  needsProxySettingsBackfill,
  normalizeLlmSettings,
} from "./llmConfig";

const STORAGE_KEY = "vesti_llm_settings";

function getStorage() {
  if (!chrome?.storage?.local) {
    throw new Error("STORAGE_UNAVAILABLE");
  }
  return chrome.storage.local;
}

export async function getLlmSettings(): Promise<LlmConfig | null> {
  const storage = getStorage();
  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result: Record<string, unknown>) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }

      const raw = (result[STORAGE_KEY] as LlmConfig | undefined) ?? null;
      if (!raw) {
        resolve(buildDefaultLlmSettings());
        return;
      }

      const normalized = normalizeLlmSettings(raw);
      if (
        needsProxySettingsBackfill(raw) ||
        raw.maxTokens !== normalized.maxTokens ||
        raw.maxTokensMode !== normalized.maxTokensMode
      ) {
        storage.set({ [STORAGE_KEY]: normalized }, () => {
          void chrome.runtime?.lastError;
        });
      }
      resolve(normalized);
    });
  });
}

export async function setLlmSettings(settings: LlmConfig): Promise<void> {
  const storage = getStorage();
  const normalized = normalizeLlmSettings(settings);
  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: normalized }, () => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}
