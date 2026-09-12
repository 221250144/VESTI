import { afterEach, describe, expect, it, vi } from "vitest"

import type { LlmConfig } from "../types"
import {
  buildDefaultLlmSettings,
  normalizeLlmSettings,
  sanitizeByokModelId
} from "./llmConfig"
import { callInference, callModelScope } from "./llmService"
import {
  PROXY_PRIMARY_ATTEMPT_TIMEOUT_MS,
  PROXY_TOTAL_TIMEOUT_MS
} from "./proxyRequest"

function legacySettings(changes: Partial<LlmConfig>): LlmConfig {
  const { maxTokensMode: _mode, ...defaults } = buildDefaultLlmSettings(1)
  return { ...defaults, ...changes }
}

describe("LLM proxy adaptation", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("defaults output tokens to Auto", () => {
    const settings = buildDefaultLlmSettings(1)

    expect(settings.maxTokens).toBeNull()
    expect(settings.maxTokensMode).toBe("auto")
  })

  it.each([800, 1600])(
    "migrates the old Demo built-in token value %s to Auto",
    (maxTokens) => {
      const normalized = normalizeLlmSettings(
        legacySettings({ mode: "demo_proxy", maxTokens })
      )

      expect(normalized.maxTokens).toBeNull()
      expect(normalized.maxTokensMode).toBe("auto")
    }
  )

  it("preserves explicit and non-legacy positive token budgets", () => {
    const manualLegacyValue = normalizeLlmSettings(
      legacySettings({
        mode: "demo_proxy",
        maxTokens: 1600,
        maxTokensMode: "manual"
      })
    )
    const oldCustomDemoValue = normalizeLlmSettings(
      legacySettings({ mode: "demo_proxy", maxTokens: 4096 })
    )
    const oldByokValue = normalizeLlmSettings(
      legacySettings({ mode: "custom_byok", maxTokens: 800 })
    )

    expect(manualLegacyValue.maxTokens).toBe(1600)
    expect(manualLegacyValue.maxTokensMode).toBe("manual")
    expect(oldCustomDemoValue.maxTokens).toBe(4096)
    expect(oldByokValue.maxTokens).toBe(800)
  })

  it("passes arbitrary non-empty model IDs through in Demo and BYOK modes", () => {
    const modelId = "vendor/new-model-2026"
    const demo = normalizeLlmSettings(
      legacySettings({ mode: "demo_proxy", modelId, maxTokens: null })
    )
    const byok = normalizeLlmSettings(
      legacySettings({
        mode: "custom_byok",
        modelId,
        customModelId: modelId,
        maxTokens: null
      })
    )

    expect(demo.modelId).toBe(modelId)
    expect(byok.modelId).toBe(modelId)
    expect(sanitizeByokModelId(modelId)).toBe(modelId)
  })

  it("omits max_tokens entirely when Auto is selected", async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const config = normalizeLlmSettings({
      ...buildDefaultLlmSettings(1),
      mode: "custom_byok",
      apiKey: "test-key",
      modelId: "vendor/new-model-2026",
      customModelId: "vendor/new-model-2026",
      maxTokens: null,
      maxTokensMode: "auto"
    })
    await callModelScope(config, "hello")

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestBody).toBeDefined()
    expect(requestBody).not.toHaveProperty("max_tokens")
    expect(requestBody?.model).toBe("vendor/new-model-2026")
  })

  it("keeps max_tokens omitted across the Demo proxy fallback", async () => {
    const urls: string[] = []
    const requestBodies: Array<Record<string, unknown>> = []
    let attempt = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input))
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        )
        attempt += 1
        if (attempt === 1) {
          return new Response("{}", { status: 503 })
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "fallback ok" } }] }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-proxy-model-used": "legacy/custom-model"
            }
          }
        )
      })
    )

    const config = normalizeLlmSettings({
      ...buildDefaultLlmSettings(1),
      mode: "demo_proxy",
      modelId: "vendor/new-model-2026",
      maxTokens: null,
      maxTokensMode: "auto"
    })
    const result = await callInference(config, "hello")

    expect(result.content).toBe("fallback ok")
    expect(urls).toEqual([
      "https://api.ccvg1218.online/api/chat",
      "https://vesti-gate.vercel.app/api/chat"
    ])
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[1]).toEqual(requestBodies[0])
    expect(requestBodies[0]).not.toHaveProperty("max_tokens")
    expect(requestBodies[0]?.model).toBe("vendor/new-model-2026")
  })

  it("keeps manual max_tokens in the request body", async () => {
    let requestBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
    )

    const config = normalizeLlmSettings({
      ...buildDefaultLlmSettings(1),
      mode: "custom_byok",
      apiKey: "test-key",
      maxTokens: 1600,
      maxTokensMode: "manual"
    })
    await callModelScope(config, "hello")

    expect(requestBody?.max_tokens).toBe(1600)
  })

  it("uses the extended proxy deadlines", () => {
    expect(PROXY_PRIMARY_ATTEMPT_TIMEOUT_MS).toBe(120_000)
    expect(PROXY_TOTAL_TIMEOUT_MS).toBe(180_000)
  })
})
