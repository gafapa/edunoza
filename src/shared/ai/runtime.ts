import { getBrowserStorage } from "../storage/browserStorage";
import { proxyMessage, type ProxyResponse } from "../backup/nextcloud";

export type AiProviderId = "openrouter" | "openai" | "anthropic" | "ollama" | "lmstudio";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiAttachment = {
  name: string;
  mimeType?: string;
  text?: string;
  data?: ArrayBuffer | Uint8Array;
};

export type AiChatOptions = {
  signal?: AbortSignal;
  provider?: AiProviderId;
  model?: string;
  temperature?: number;
  ollamaThink?: boolean | "low";
  maxOutputTokens?: number;
  responseFormat?: "text" | "json";
  attachments?: AiAttachment[];
  onDelta?: (delta: string) => void;
};

export type AiChatResult = {
  truncated?: boolean;
  text: string;
  provider: AiProviderId;
  model: string;
};

export type AiCredentialPersistence = "none" | "session" | "device";

export type AiConfiguration = {
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  credentialPersistence: AiCredentialPersistence;
};

export type AiConfigurationInput = {
  provider: AiProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  rememberApiKey: boolean;
};

export type AiProviderDefinition = {
  id: AiProviderId;
  label: string;
  location: "cloud" | "local";
  requiresApiKey: boolean;
  defaultModel: string;
  defaultBaseUrl?: string;
  credentialUrl?: string;
};

export type AiModelInfo = {
  id: string;
  name?: string;
  description?: string;
  owner?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  format?: string;
  createdAt?: string;
  modifiedAt?: string;
  capabilities?: string[];
};

export const AI_PROVIDER_DEFINITIONS: readonly AiProviderDefinition[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    location: "cloud",
    requiresApiKey: true,
    defaultModel: "openai/gpt-4o-mini",
    credentialUrl: "https://openrouter.ai/settings/keys"
  },
  {
    id: "openai",
    label: "OpenAI",
    location: "cloud",
    requiresApiKey: true,
    defaultModel: "gpt-4o-mini",
    credentialUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    location: "cloud",
    requiresApiKey: true,
    defaultModel: "claude-sonnet-4-6",
    credentialUrl: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "ollama",
    label: "Ollama",
    location: "local",
    requiresApiKey: false,
    defaultModel: "",
    defaultBaseUrl: "http://localhost:11434"
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    location: "local",
    requiresApiKey: false,
    defaultModel: "",
    defaultBaseUrl: "http://localhost:1234/v1"
  }
] as const;

export type AiRuntimeErrorCode =
  | "CONFIG_MISSING"
  | "API_KEY_MISSING"
  | "MODEL_MISSING"
  | "LOCAL_URL_INVALID"
  | "ATTACHMENTS_UNSUPPORTED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "NETWORK_FAILED"
  | "TIMED_OUT"
  | "INVALID_RESPONSE"
  | "PROXY_FAILED"
  | "OUTPUT_EXHAUSTED";

export class AiRuntimeError extends Error {
  constructor(
    readonly code: AiRuntimeErrorCode,
    message: string,
    readonly provider?: AiProviderId,
    readonly status?: number
  ) {
    super(message);
    this.name = "AiRuntimeError";
  }
}

type StoredAiConfiguration = {
  version: 1;
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
};

type StoredCredentials = Partial<Record<AiProviderId, string>>;

type ResolvedProviderConfiguration = {
  provider: AiProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string;
};

const CONFIGURATION_STORAGE_KEY = "edunoza_ai_configuration_v2";
const LEGACY_CONFIGURATION_STORAGE_KEY = "edunoza_ai_configuration_v1";
const SESSION_CREDENTIALS_STORAGE_KEY = "edunoza_ai_session_credentials_v1";
const DEVICE_CREDENTIALS_STORAGE_KEY = "edunoza_ai_device_credentials_v1";
const CHAT_TIMEOUT_MS = 180_000;
const INSPECTION_TIMEOUT_MS = 15_000;
const MAX_MODEL_LENGTH = 300;
const MAX_BASE_URL_LENGTH = 500;
const MAX_MODELS = 1_000;

let memoryConfiguration: StoredAiConfiguration = { version: 1 };
let memorySessionCredentials: StoredCredentials = {};
let memoryDeviceCredentials: StoredCredentials = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDER_DEFINITIONS.some((provider) => provider.id === value);
}

export function getAiProviderDefinition(provider: AiProviderId): AiProviderDefinition {
  const definition = AI_PROVIDER_DEFINITIONS.find((item) => item.id === provider);
  if (!definition) throw new AiRuntimeError("CONFIG_MISSING", "Unknown AI provider.");
  return definition;
}

function normalizeModel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_MODEL_LENGTH) : "";
}

export function normalizeLocalBaseUrl(value: unknown, provider: AiProviderId): string {
  const definition = getAiProviderDefinition(provider);
  if (definition.location !== "local") return "";
  const candidate = typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_BASE_URL_LENGTH)
    : definition.defaultBaseUrl ?? "";

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLocaleLowerCase("en");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1"].includes(hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("Unsupported local URL.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new AiRuntimeError(
      "LOCAL_URL_INVALID",
      "Local provider URLs must use localhost or 127.0.0.1.",
      provider
    );
  }
}

export function normalizeAiConfiguration(value: unknown): StoredAiConfiguration {
  if (!isRecord(value) || !isAiProviderId(value.provider)) return { version: 1 };
  const provider = value.provider;
  const definition = getAiProviderDefinition(provider);
  const model = normalizeModel(value.model);
  let baseUrl: string | undefined;
  if (definition.location === "local") {
    try {
      baseUrl = normalizeLocalBaseUrl(value.baseUrl, provider);
    } catch {
      baseUrl = definition.defaultBaseUrl;
    }
  }
  return {
    version: 1,
    provider,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function readJsonStorage(storage: Storage | undefined, key: string): unknown {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function normalizeStoredCredentials(value: unknown): StoredCredentials {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([provider, credential]) =>
      isAiProviderId(provider) && typeof credential === "string" && credential.trim()
        ? [[provider, credential.trim().slice(0, 2_000)]]
        : []
    )
  );
}

function readStoredConfiguration(): StoredAiConfiguration {
  if (typeof window === "undefined") return memoryConfiguration;
  const current = readJsonStorage(getBrowserStorage("local"), CONFIGURATION_STORAGE_KEY);
  if (current) return normalizeAiConfiguration(current);
  const legacy = readJsonStorage(getBrowserStorage("local"), LEGACY_CONFIGURATION_STORAGE_KEY);
  return legacy ? normalizeAiConfiguration(legacy) : memoryConfiguration;
}

function writeStoredConfiguration(configuration: StoredAiConfiguration): void {
  memoryConfiguration = configuration;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONFIGURATION_STORAGE_KEY, JSON.stringify(configuration));
    window.localStorage.removeItem(LEGACY_CONFIGURATION_STORAGE_KEY);
  } catch {
    // The in-memory configuration remains usable until the page is closed.
  }
}

function readCredentials(storageKind: "session" | "device"): StoredCredentials {
  const fallback = storageKind === "session" ? memorySessionCredentials : memoryDeviceCredentials;
  if (typeof window === "undefined") return fallback;
  const storage = getBrowserStorage(storageKind === "session" ? "session" : "local");
  const key = storageKind === "session"
    ? SESSION_CREDENTIALS_STORAGE_KEY
    : DEVICE_CREDENTIALS_STORAGE_KEY;
  return { ...fallback, ...normalizeStoredCredentials(readJsonStorage(storage, key)) };
}

function writeCredentials(storageKind: "session" | "device", credentials: StoredCredentials): boolean {
  if (storageKind === "session") memorySessionCredentials = credentials;
  else memoryDeviceCredentials = credentials;
  if (typeof window === "undefined") return false;
  const storage = getBrowserStorage(storageKind === "session" ? "session" : "local");
  const key = storageKind === "session"
    ? SESSION_CREDENTIALS_STORAGE_KEY
    : DEVICE_CREDENTIALS_STORAGE_KEY;
  try {
    if (!storage) return false;
    if (Object.keys(credentials).length > 0) storage.setItem(key, JSON.stringify(credentials));
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function getStoredCredential(provider: AiProviderId): {
  apiKey?: string;
  persistence: AiCredentialPersistence;
} {
  const deviceCredential = readCredentials("device")[provider];
  if (deviceCredential) return { apiKey: deviceCredential, persistence: "device" };
  const sessionCredential = readCredentials("session")[provider];
  if (sessionCredential) return { apiKey: sessionCredential, persistence: "session" };
  return { persistence: "none" };
}

export function getAiCredentialPersistence(provider: AiProviderId): AiCredentialPersistence {
  return getStoredCredential(provider).persistence;
}

function removeCredentialFromStorage(provider: AiProviderId, storageKind: "session" | "device"): void {
  const credentials = readCredentials(storageKind);
  delete credentials[provider];
  writeCredentials(storageKind, credentials);
}

function storeCredential(
  provider: AiProviderId,
  apiKey: string,
  rememberApiKey: boolean
): AiCredentialPersistence {
  const target = rememberApiKey ? "device" : "session";
  const other = rememberApiKey ? "session" : "device";
  const credentials = readCredentials(target);
  credentials[provider] = apiKey.trim().slice(0, 2_000);
  removeCredentialFromStorage(provider, other);
  const persisted = writeCredentials(target, credentials);
  if (persisted || target === "session") return target;

  removeCredentialFromStorage(provider, "device");
  const sessionCredentials = readCredentials("session");
  sessionCredentials[provider] = apiKey.trim().slice(0, 2_000);
  writeCredentials("session", sessionCredentials);
  return "session";
}

export function clearAiCredential(provider: AiProviderId): void {
  removeCredentialFromStorage(provider, "session");
  removeCredentialFromStorage(provider, "device");
}

export function loadAiConfiguration(): AiConfiguration {
  const stored = readStoredConfiguration();
  if (!stored.provider) return { credentialPersistence: "none" };
  return {
    provider: stored.provider,
    ...(stored.model ? { model: stored.model } : {}),
    ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
    credentialPersistence: getStoredCredential(stored.provider).persistence
  };
}

function validateConfigurationInput(input: AiConfigurationInput): StoredAiConfiguration {
  const definition = getAiProviderDefinition(input.provider);
  const model = normalizeModel(input.model) || definition.defaultModel;
  if (!model) {
    throw new AiRuntimeError("MODEL_MISSING", "An AI model must be selected.", input.provider);
  }
  const baseUrl = definition.location === "local"
    ? normalizeLocalBaseUrl(input.baseUrl, input.provider)
    : undefined;
  return {
    version: 1,
    provider: input.provider,
    model,
    ...(baseUrl ? { baseUrl } : {})
  };
}

export function saveAiConfiguration(input: AiConfigurationInput): AiConfiguration {
  const configuration = validateConfigurationInput(input);
  const definition = getAiProviderDefinition(input.provider);
  let credentialPersistence: AiCredentialPersistence = "none";

  if (definition.requiresApiKey) {
    const suppliedCredential = input.apiKey?.trim();
    const existingCredential = getStoredCredential(input.provider).apiKey;
    const credential = suppliedCredential || existingCredential;
    if (!credential) {
      throw new AiRuntimeError("API_KEY_MISSING", "An API key is required.", input.provider);
    }
    credentialPersistence = storeCredential(input.provider, credential, input.rememberApiKey);
  }

  writeStoredConfiguration(configuration);
  return { ...configuration, credentialPersistence };
}

function resolveProviderConfiguration(
  providerOverride?: AiProviderId,
  modelOverride?: string
): ResolvedProviderConfiguration {
  const stored = readStoredConfiguration();
  const provider = providerOverride ?? stored.provider;
  if (!provider) {
    throw new AiRuntimeError("CONFIG_MISSING", "AI is not configured.");
  }
  const definition = getAiProviderDefinition(provider);
  const model = normalizeModel(modelOverride) || (provider === stored.provider ? stored.model ?? "" : "") || definition.defaultModel;
  if (!model) {
    throw new AiRuntimeError("MODEL_MISSING", "An AI model must be selected.", provider);
  }
  const credential = getStoredCredential(provider).apiKey;
  if (definition.requiresApiKey && !credential) {
    throw new AiRuntimeError("API_KEY_MISSING", "An API key is required.", provider);
  }
  const baseUrl = definition.location === "local"
    ? normalizeLocalBaseUrl(provider === stored.provider ? stored.baseUrl : undefined, provider)
    : undefined;
  return {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(credential ? { apiKey: credential } : {})
  };
}

function normalizeMessages(messages: AiMessage[]): AiMessage[] {
  return messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0);
}

function optionalString(value: unknown, maxLength = 1_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const normalized = optionalNumber(value);
  return normalized !== undefined && normalized > 0 ? normalized : undefined;
}

function optionalDate(value: unknown, unixSeconds = false): string | undefined {
  const date = unixSeconds && typeof value === "number"
    ? new Date(value * 1_000)
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : undefined;
}

function supportedCapabilities(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([capability, details]) =>
    isRecord(details) && details.supported === true ? [capability] : []
  );
}

function normalizedCapabilities(values: unknown[]): string[] | undefined {
  const capabilities = Array.from(new Set(values.flatMap((value) => optionalString(value, 100) ?? [])));
  return capabilities.length > 0 ? capabilities : undefined;
}

function modelInfoFromOpenAi(item: Record<string, unknown>): AiModelInfo | null {
  const id = normalizeModel(item.id);
  if (!id) return null;
  const owner = optionalString(item.owned_by, 200);
  const createdAt = optionalDate(item.created, true);
  return { id, ...(owner ? { owner } : {}), ...(createdAt ? { createdAt } : {}) };
}

function modelInfoFromOpenRouter(item: Record<string, unknown>): AiModelInfo | null {
  const id = normalizeModel(item.id);
  if (!id) return null;
  const architecture = isRecord(item.architecture) ? item.architecture : {};
  const topProvider = isRecord(item.top_provider) ? item.top_provider : {};
  const pricing = isRecord(item.pricing) ? item.pricing : {};
  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.flatMap((modality) => {
      const name = optionalString(modality, 50);
      return name ? [`${name}_input`] : [];
    })
    : [];
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.flatMap((modality) => {
      const name = optionalString(modality, 50);
      return name ? [`${name}_output`] : [];
    })
    : [];
  const supportedParameters = Array.isArray(item.supported_parameters)
    ? item.supported_parameters.flatMap((parameter) => {
      if (parameter === "tools" || parameter === "tool_choice") return ["tool_use"];
      if (parameter === "response_format" || parameter === "structured_outputs") return ["structured_outputs"];
      if (parameter === "reasoning") return ["reasoning"];
      return [];
    })
    : [];
  const inputPrice = optionalNumber(pricing.prompt);
  const outputPrice = optionalNumber(pricing.completion);
  const name = optionalString(item.name, 300);
  const description = optionalString(item.description, 2_000);
  const contextWindow = optionalPositiveNumber(item.context_length);
  const maxOutputTokens = optionalPositiveNumber(topProvider.max_completion_tokens);
  const createdAt = optionalDate(item.created, true);
  const capabilities = normalizedCapabilities([
    ...inputModalities,
    ...outputModalities,
    ...supportedParameters
  ]);
  return {
    id,
    ...(name && name !== id ? { name } : {}),
    ...(description ? { description } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(inputPrice !== undefined ? { inputPricePerMillionUsd: inputPrice * 1_000_000 } : {}),
    ...(outputPrice !== undefined ? { outputPricePerMillionUsd: outputPrice * 1_000_000 } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(capabilities ? { capabilities } : {})
  };
}

function modelInfoFromAnthropic(item: Record<string, unknown>): AiModelInfo | null {
  const id = normalizeModel(item.id);
  if (!id) return null;
  const name = optionalString(item.display_name, 300);
  const createdAt = optionalDate(item.created_at);
  const contextWindow = optionalPositiveNumber(item.max_input_tokens);
  const maxOutputTokens = optionalPositiveNumber(item.max_tokens);
  const capabilities = normalizedCapabilities(supportedCapabilities(item.capabilities));
  return {
    id,
    ...(name && name !== id ? { name } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(capabilities ? { capabilities } : {})
  };
}

function modelInfoFromOllama(item: Record<string, unknown>): AiModelInfo | null {
  const id = normalizeModel(item.name ?? item.model);
  if (!id) return null;
  const details = isRecord(item.details) ? item.details : {};
  const modifiedAt = optionalDate(item.modified_at);
  const sizeBytes = optionalPositiveNumber(item.size);
  const family = optionalString(details.family, 200);
  const parameterSize = optionalString(details.parameter_size, 100);
  const quantization = optionalString(details.quantization_level, 100);
  const format = optionalString(details.format, 100);
  return {
    id,
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(family ? { family } : {}),
    ...(parameterSize ? { parameterSize } : {}),
    ...(quantization ? { quantization } : {}),
    ...(format ? { format } : {})
  };
}

function modelInfoFromLmStudio(item: Record<string, unknown>): AiModelInfo | null {
  if (item.type === "embedding" || item.type === "embeddings") return null;
  const id = normalizeModel(item.key ?? item.id);
  if (!id) return null;
  const quantizationDetails = isRecord(item.quantization) ? item.quantization : {};
  const capabilitiesDetails = isRecord(item.capabilities) ? item.capabilities : {};
  const name = optionalString(item.display_name, 300);
  const description = optionalString(item.description, 2_000);
  const owner = optionalString(item.publisher ?? item.owned_by, 200);
  const contextWindow = optionalPositiveNumber(item.max_context_length);
  const sizeBytes = optionalPositiveNumber(item.size_bytes);
  const parameterSize = optionalString(item.params_string, 100);
  const quantization = optionalString(quantizationDetails.name ?? item.quantization, 100);
  const family = optionalString(item.architecture ?? item.arch, 200);
  const format = optionalString(item.format ?? item.compatibility_type, 100);
  const capabilities = normalizedCapabilities([
    capabilitiesDetails.vision === true ? "image_input" : undefined,
    capabilitiesDetails.trained_for_tool_use === true ? "tool_use" : undefined,
    isRecord(capabilitiesDetails.reasoning) ? "reasoning" : undefined
  ]);
  return {
    id,
    ...(name && name !== id ? { name } : {}),
    ...(description ? { description } : {}),
    ...(owner ? { owner } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(parameterSize ? { parameterSize } : {}),
    ...(quantization ? { quantization } : {}),
    ...(family ? { family } : {}),
    ...(format ? { format } : {}),
    ...(capabilities ? { capabilities } : {})
  };
}

function uniqueModelDetails(models: Array<AiModelInfo | null>): AiModelInfo[] {
  const uniqueModels = new Map<string, AiModelInfo>();
  for (const model of models) {
    if (model && !uniqueModels.has(model.id)) uniqueModels.set(model.id, model);
  }
  return Array.from(uniqueModels.values())
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .slice(0, MAX_MODELS);
}

export function normalizeAiModelCatalog(
  provider: AiProviderId,
  payload: Record<string, unknown>
): AiModelInfo[] {
  const rawModels = provider === "ollama" || provider === "lmstudio"
    ? Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : []
    : Array.isArray(payload.data) ? payload.data : [];
  const parser = provider === "openrouter"
    ? modelInfoFromOpenRouter
    : provider === "anthropic"
      ? modelInfoFromAnthropic
      : provider === "ollama"
        ? modelInfoFromOllama
        : provider === "lmstudio"
          ? modelInfoFromLmStudio
          : modelInfoFromOpenAi;
  return uniqueModelDetails(rawModels.map((item) => isRecord(item) ? parser(item) : null));
}

function errorForHttpStatus(provider: AiProviderId, response: Response): AiRuntimeError {
  if (response.status === 401 || response.status === 403) {
    return new AiRuntimeError("AUTH_FAILED", "The provider rejected the credentials.", provider, response.status);
  }
  if (response.status === 404) {
    return new AiRuntimeError("MODEL_UNAVAILABLE", "The provider or model was not found.", provider, response.status);
  }
  if (response.status === 429) {
    return new AiRuntimeError("RATE_LIMITED", "The provider rate limit was reached.", provider, response.status);
  }
  return new AiRuntimeError(
    "PROVIDER_UNAVAILABLE",
    `The provider returned HTTP ${response.status}.`,
    provider,
    response.status
  );
}

async function fetchProviderJson(
  provider: AiProviderId,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    if (provider === "ollama") {
      normalizeLocalBaseUrl(url, provider);
      let result: Partial<ProxyResponse> | null;
      try {
        await proxyMessage("bridge-ping", undefined, controller.signal);
        result = await proxyMessage("bridge-request", {
          url,
          method: init.method ?? "GET",
          headers: Object.fromEntries(new Headers(init.headers).entries()),
          ...(typeof init.body === "string" ? { body: init.body } : {}),
          responseType: "text",
          allowPrivateNetwork: true
        }, controller.signal) as Partial<ProxyResponse> | null;
      } catch {
        if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
        throw new AiRuntimeError("PROXY_FAILED", "Ollama proxy request failed.", provider);
      }
      if (!result || !Number.isInteger(result.status) || result.status! < 200 || result.status! > 599 ||
        typeof result.bodyText !== "string" || result.finalUrl !== url ||
        new TextEncoder().encode(result.bodyText).length > 10 * 1024 * 1024) {
        throw new AiRuntimeError("PROXY_FAILED", "Invalid proxy response or redirected request.", provider);
      }
      response = new Response(result.bodyText, { status: result.status });
    } else {
      response = await fetch(url, { ...init, signal: controller.signal });
    }
    if (!response.ok) throw errorForHttpStatus(provider, response);
    const payload: unknown = await response.json();
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    if (!isRecord(payload)) {
      throw new AiRuntimeError("INVALID_RESPONSE", "The provider returned invalid JSON.", provider);
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    if (error instanceof AiRuntimeError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiRuntimeError("TIMED_OUT", "The AI request timed out.", provider);
    }
    throw new AiRuntimeError("NETWORK_FAILED", "The AI provider could not be reached.", provider);
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

function cloudHeaders(provider: AiProviderId, apiKey: string): HeadersInit {
  if (provider === "anthropic") {
    return {
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": apiKey
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function extractOpenAiText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return "";
  const content = firstChoice.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : [])
    .join("");
}

function toAnthropicPayload(messages: AiMessage[]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversationalMessages = messages
    .filter((message): message is AiMessage & { role: "user" | "assistant" } => message.role !== "system")
    .reduce<Array<{ role: "user" | "assistant"; content: string }>>((result, message) => {
      const previous = result[result.length - 1];
      if (previous?.role === message.role) previous.content += `\n\n${message.content}`;
      else result.push({ role: message.role, content: message.content });
      return result;
    }, []);
  if (conversationalMessages.length === 0) {
    conversationalMessages.push({ role: "user", content: system || "Continue." });
  }
  return { ...(system ? { system } : {}), messages: conversationalMessages };
}

function extractAnthropicText(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
    .join("");
}

async function callProvider(
  configuration: ResolvedProviderConfiguration,
  messages: AiMessage[],
  options: AiChatOptions
): Promise<AiChatResult> {
  const { provider, model, baseUrl, apiKey } = configuration;
  const temperature = options.temperature ?? 0.2;
  const maxOutputTokens = options.maxOutputTokens ?? 1_500;
  let payload: Record<string, unknown>;
  let text = "";
  let responseModel = model;

  if (provider === "openai" || provider === "openrouter") {
    const endpoint = provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
    payload = await fetchProviderJson(provider, endpoint, {
      method: "POST",
      headers: cloudHeaders(provider, apiKey ?? ""),
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(provider === "openai"
          ? { max_completion_tokens: maxOutputTokens }
          : { max_tokens: maxOutputTokens }),
        ...(options.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {})
      })
    }, CHAT_TIMEOUT_MS, options.signal);
    text = extractOpenAiText(payload);
    if (typeof payload.model === "string" && payload.model.trim()) responseModel = payload.model.trim();
  } else if (provider === "anthropic") {
    const anthropicMessages = toAnthropicPayload(messages);
    payload = await fetchProviderJson(provider, "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: cloudHeaders(provider, apiKey ?? ""),
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        temperature,
        ...anthropicMessages
      })
    }, CHAT_TIMEOUT_MS, options.signal);
    text = extractAnthropicText(payload);
    if (typeof payload.model === "string" && payload.model.trim()) responseModel = payload.model.trim();
  } else if (provider === "ollama") {
    // Reasoning models (e.g. gpt-oss) burn the token budget on hidden thinking
    // unless told otherwise; apply the same default to every caller, not just
    // the connection test, so real generation doesn't hit OUTPUT_EXHAUSTED.
    const ollamaThink = options.ollamaThink !== undefined
      ? options.ollamaThink
      : model.toLowerCase().includes("gpt-oss") ? "low" as const : undefined;
    payload = await fetchProviderJson(provider, `${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(ollamaThink !== undefined ? { think: ollamaThink } : {}),
        ...(options.responseFormat === "json" ? { format: "json" } : {}),
        options: { temperature, num_predict: maxOutputTokens }
      })
    }, CHAT_TIMEOUT_MS, options.signal);
    text = isRecord(payload.message) && typeof payload.message.content === "string"
      ? payload.message.content
      : typeof payload.response === "string"
        ? payload.response
        : "";
    if (typeof payload.model === "string" && payload.model.trim()) responseModel = payload.model.trim();
  } else {
    payload = await fetchProviderJson(provider, `${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        ...(options.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {})
      })
    }, CHAT_TIMEOUT_MS, options.signal);
    text = extractOpenAiText(payload);
    if (typeof payload.model === "string" && payload.model.trim()) responseModel = payload.model.trim();
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  const truncated = (isRecord(firstChoice) && firstChoice.finish_reason === "length") || payload.stop_reason === "max_tokens" || payload.done_reason === "length";

  if (!text.trim()) {
    if (truncated) {
      throw new AiRuntimeError("OUTPUT_EXHAUSTED", "Token budget exhausted before final output.", provider);
    }
    throw new AiRuntimeError("INVALID_RESPONSE", "The provider returned an empty response.", provider);
  }
  options.onDelta?.(text);
  return { text, provider, model: responseModel, ...(truncated ? { truncated: true } : {}) };
}

export async function generateAiText(
  messages: AiMessage[],
  options: AiChatOptions = {}
): Promise<AiChatResult> {
  const normalizedMessages = normalizeMessages(messages);
  if (normalizedMessages.length === 0) {
    throw new AiRuntimeError("CONFIG_MISSING", "The AI prompt is empty.");
  }
  if (options.attachments?.length) {
    throw new AiRuntimeError(
      "ATTACHMENTS_UNSUPPORTED",
      "Direct AI attachments are not available yet.",
      options.provider
    );
  }
  return callProvider(
    resolveProviderConfiguration(options.provider, options.model),
    normalizedMessages,
    options
  );
}

export async function testAiConnection(): Promise<AiChatResult> {
  const configuration = resolveProviderConfiguration();
  return callProvider(configuration, [
    { role: "system", content: "Responde de forma breve y sin explicación adicional." },
    { role: "user", content: "Responde únicamente con la palabra: Conectado" }
  ], {
    temperature: 0,
    maxOutputTokens: 1024,
    ...(configuration.provider === "ollama"
      ? { ollamaThink: configuration.model.toLowerCase().includes("gpt-oss") ? "low" as const : false }
      : {})
  });
}

export async function listAiModelDetails(input: {
  provider: AiProviderId;
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiModelInfo[]> {
  const definition = getAiProviderDefinition(input.provider);
  const storedCredential = getStoredCredential(input.provider).apiKey;
  const apiKey = input.apiKey?.trim() || storedCredential;
  if (definition.requiresApiKey && !apiKey) {
    throw new AiRuntimeError("API_KEY_MISSING", "An API key is required.", input.provider);
  }
  let payload: Record<string, unknown>;

  if (input.provider === "openai") {
    payload = await fetchProviderJson(input.provider, "https://api.openai.com/v1/models", {
      headers: cloudHeaders(input.provider, apiKey ?? "")
    }, INSPECTION_TIMEOUT_MS);
    return normalizeAiModelCatalog(input.provider, payload);
  }
  if (input.provider === "openrouter") {
    payload = await fetchProviderJson(input.provider, "https://openrouter.ai/api/v1/models", {
      headers: cloudHeaders(input.provider, apiKey ?? "")
    }, INSPECTION_TIMEOUT_MS);
    return normalizeAiModelCatalog(input.provider, payload);
  }
  if (input.provider === "anthropic") {
    payload = await fetchProviderJson(input.provider, "https://api.anthropic.com/v1/models?limit=1000", {
      headers: cloudHeaders(input.provider, apiKey ?? "")
    }, INSPECTION_TIMEOUT_MS);
    return normalizeAiModelCatalog(input.provider, payload);
  }
  const baseUrl = normalizeLocalBaseUrl(input.baseUrl, input.provider);
  if (input.provider === "ollama") {
    payload = await fetchProviderJson(input.provider, `${baseUrl}/api/tags`, {}, INSPECTION_TIMEOUT_MS);
    return normalizeAiModelCatalog(input.provider, payload);
  }
  const nativeModelsUrl = `${new URL(baseUrl).origin}/api/v1/models`;
  try {
    payload = await fetchProviderJson(input.provider, nativeModelsUrl, {}, INSPECTION_TIMEOUT_MS);
  } catch (error) {
    if (!(error instanceof AiRuntimeError) || !["MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE"].includes(error.code)) {
      throw error;
    }
    payload = await fetchProviderJson(input.provider, `${baseUrl}/models`, {}, INSPECTION_TIMEOUT_MS);
  }
  return normalizeAiModelCatalog(input.provider, payload);
}

export async function listAiModels(input: {
  provider: AiProviderId;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  return (await listAiModelDetails(input)).map((model) => model.id);
}

export function getAiErrorMessage(error: unknown): string {
  if (!(error instanceof AiRuntimeError)) {
    return "No se pudo completar la operación de IA. Revisa la configuración y vuelve a intentarlo.";
  }
  switch (error.code) {
    case "CONFIG_MISSING":
      return "Configura primero un proveedor de IA en Configuración → Inteligencia artificial.";
    case "API_KEY_MISSING":
      return "Introduce una clave API para el proveedor seleccionado.";
    case "MODEL_MISSING":
      return "Escribe o selecciona el modelo que debe utilizar Edunoza.";
    case "LOCAL_URL_INVALID":
      return "La dirección local debe usar localhost o 127.0.0.1, sin usuario, contraseña ni parámetros.";
    case "ATTACHMENTS_UNSUPPORTED":
      return "Esta función todavía no admite adjuntos enviados directamente al proveedor.";
    case "AUTH_FAILED":
      return "El proveedor rechazó la clave API. Comprueba que sea válida y tenga permisos.";
    case "RATE_LIMITED":
      return "El proveedor ha limitado temporalmente las solicitudes. Espera unos minutos y vuelve a probar.";
    case "MODEL_UNAVAILABLE":
      return "El proveedor o el modelo no están disponibles. Revisa el nombre del modelo.";
    case "NETWORK_FAILED":
      return error.provider === "ollama" || error.provider === "lmstudio"
        ? error.provider === "ollama"
          ? "No se pudo conectar con Ollama. Comprueba que esté iniciado y abre la ayuda de configuración que aparece junto a la dirección local."
          : "No se pudo conectar con el servidor local. Comprueba que esté iniciado y permita el acceso desde edunoza.com."
        : "No se pudo conectar con el proveedor. Comprueba la conexión, la política de red y vuelve a intentarlo.";
    case "TIMED_OUT":
      return "El proveedor tardó demasiado en responder. Vuelve a intentarlo o elige otro modelo.";
    case "INVALID_RESPONSE":
      return "El proveedor respondió sin un texto válido. Prueba otro modelo o revisa su compatibilidad.";
    case "OUTPUT_EXHAUSTED":
      return "El modelo agotó el límite de generación antes de producir una respuesta final. Prueba un modelo con menos razonamiento.";
    case "PROXY_FAILED":
      return "No se pudo conectar con Ollama mediante Proxy. Abre la ayuda de configuración: instala o actualiza Proxy, autoriza edunoza.com, activa el acceso a la red local y permite GET y POST. Comprueba que Ollama esté iniciado. Si tarda demasiado, aumenta el tiempo de espera de Proxy hasta 120 segundos o usa un modelo más pequeño.";
    default:
      return error.status
        ? `El proveedor no pudo completar la solicitud (HTTP ${error.status}).`
        : "El proveedor de IA no está disponible en este momento.";
  }
}
