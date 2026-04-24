#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEV_BASE_URL = 'https://dynamic-lapwing-647.convex.site';
const DEFAULT_BASE_URL = 'https://fastidious-elephant-379.convex.site';
const DEV_API_KEY_PREFIX = 'po_test_org_';
const KNOWN_BASE_URLS = [DEFAULT_BASE_URL, DEV_BASE_URL];
const SKILL_SCRIPT_PATH = '<skill-path>/scripts/po-once.cjs';
const RELATIVE_SCRIPT_PATH_NOTE = './scripts/po-once.cjs (relative to the skill directory)';
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_FIELD_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authcode',
  'authorization',
  'authorizationcode',
  'bearertoken',
  'clientsecret',
  'idtoken',
  'oauthaccesstoken',
  'oauthrefreshtoken',
  'password',
  'refreshtoken',
  'secret',
  'sessiontoken',
]);
const CONFIG_DIR = path.join(os.homedir(), '.config', 'po-once');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOCAL_CONFIG = path.join(process.cwd(), '.po-once', 'config.json');
const META_ANALYTICS_PROVIDERS = new Set(['facebook', 'instagram', 'threads']);
const THREADS_PROVIDER = 'threads';
const TIKTOK_PROVIDER = 'tiktok';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return null;
  return baseUrl.replace(/\/+$/, '');
}

function inferBaseUrlFromApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) return DEFAULT_BASE_URL;
  if (apiKey.startsWith(DEV_API_KEY_PREFIX)) return DEV_BASE_URL;
  return DEFAULT_BASE_URL;
}

function buildBaseUrlCandidates(baseUrl, apiKey) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl) {
    return {
      baseUrl: normalizedBaseUrl,
      baseUrlCandidates: [normalizedBaseUrl],
      baseUrlSource: 'explicit',
    };
  }

  const inferredBaseUrl = inferBaseUrlFromApiKey(apiKey);
  return {
    baseUrl: inferredBaseUrl,
    baseUrlCandidates: [inferredBaseUrl, ...KNOWN_BASE_URLS.filter((candidate) => candidate !== inferredBaseUrl)],
    baseUrlSource: 'inferred',
  };
}

function resolveSavedBaseUrl(config) {
  if (!config || !config.apiKey) return null;

  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  if (!normalizedBaseUrl) {
    return buildBaseUrlCandidates(null, config.apiKey);
  }

  return {
    baseUrl: normalizedBaseUrl,
    baseUrlCandidates: [normalizedBaseUrl],
    baseUrlSource: config.baseUrlSource || 'saved',
  };
}

function createConfig({ apiKey, baseUrl, baseUrlCandidates, source, baseUrlSource, configPath }) {
  return {
    apiKey,
    baseUrl,
    baseUrlCandidates: baseUrlCandidates || [baseUrl],
    source,
    baseUrlSource,
    configPath,
  };
}

function getRuntimeParsedArgs() {
  return parseArgs(process.argv.slice(3));
}

function getExplicitConfigPath(parsed = getRuntimeParsedArgs()) {
  const explicitPath = parsed.config || process.env.PO_ONCE_CONFIG_PATH;
  return explicitPath ? path.resolve(explicitPath) : null;
}

function findNearestLocalConfig(startDir = process.cwd()) {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, '.po-once', 'config.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadSavedConfig(filePath, source) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const saved = readJson(filePath);
  if (!saved || !saved.apiKey) return null;

  const resolved = resolveSavedBaseUrl(saved);
  return {
    ...createConfig({
      apiKey: saved.apiKey,
      baseUrl: resolved.baseUrl,
      baseUrlCandidates: resolved.baseUrlCandidates,
      source,
      baseUrlSource: resolved.baseUrlSource,
      configPath: filePath,
    }),
  };
}

function loadExplicitConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Explicit config file not found: ${filePath}`);
  }

  const config = loadSavedConfig(filePath, 'explicit');
  if (!config) {
    throw new Error(`Explicit config file must be valid JSON with an apiKey: ${filePath}`);
  }

  return config;
}

function getConfig(parsed = getRuntimeParsedArgs()) {
  if (process.env.PO_ONCE_AGENT_API_KEY) {
    const resolved = buildBaseUrlCandidates(process.env.PO_ONCE_BASE_URL, process.env.PO_ONCE_AGENT_API_KEY);
    return createConfig({
      apiKey: process.env.PO_ONCE_AGENT_API_KEY,
      baseUrl: resolved.baseUrl,
      baseUrlCandidates: resolved.baseUrlCandidates,
        source: 'env',
        baseUrlSource: resolved.baseUrlSource,
      });
  }

  const explicitConfigPath = getExplicitConfigPath(parsed);
  if (explicitConfigPath) {
    return loadExplicitConfig(explicitConfigPath);
  }

  const localConfig = loadSavedConfig(findNearestLocalConfig(), 'local');
  if (localConfig) return localConfig;

  const globalConfig = loadSavedConfig(CONFIG_FILE, 'global');
  if (globalConfig) return globalConfig;

  return null;
}

function saveConfig(nextConfig, global = true, parsed = getRuntimeParsedArgs()) {
  const filePath = getExplicitConfigPath(parsed) || (global ? CONFIG_FILE : LOCAL_CONFIG);
  const existing = readJson(filePath) || {};
  const apiKey = nextConfig.apiKey || existing.apiKey;
  const baseUrl = normalizeBaseUrl(nextConfig.baseUrl || existing.baseUrl || inferBaseUrlFromApiKey(apiKey));
  const merged = {
    ...existing,
    ...nextConfig,
    baseUrl,
    baseUrlSource: nextConfig.baseUrlSource || existing.baseUrlSource || 'saved',
  };
  writeJson(filePath, merged);
  return filePath;
}

function redactApiKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;
}

function normalizeFieldName(fieldName) {
  return String(fieldName).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveFieldName(fieldName) {
  const normalizedFieldName = normalizeFieldName(fieldName);
  return SENSITIVE_FIELD_NAMES.has(normalizedFieldName)
    || normalizedFieldName.endsWith('token')
    || normalizedFieldName.endsWith('secret')
    || normalizedFieldName.endsWith('password');
}

function redactSensitiveData(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== 'object') return value;

  const entries = Object.entries(value).map(([key, entryValue]) => {
    if (isSensitiveFieldName(key)) return [key, REDACTED_VALUE];
    return [key, redactSensitiveData(entryValue)];
  });

  return Object.fromEntries(entries);
}

function output(data) {
  console.log(JSON.stringify(redactSensitiveData(data), null, 2));
}

function error(message) {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

function info(message) {
  console.error(`\x1b[36mInfo:\x1b[0m ${message}`);
}

function usage(command) {
  return `${SKILL_SCRIPT_PATH} ${command}`;
}

function formatApiError(data) {
  if (data && data.error) return `${data.error.code}: ${data.error.message}`;
  return JSON.stringify(redactSensitiveData(data));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function parseCommaList(value) {
  if (!value || typeof value !== 'string') return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function pickDefinedFields(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function extractAccountsCollection(data) {
  if (Array.isArray(data)) return { key: null, accounts: data };
  if (!data || typeof data !== 'object') return null;

  for (const key of ['accounts', 'items', 'results']) {
    if (Array.isArray(data[key])) return { key, accounts: data[key] };
  }

  return null;
}

function matchesAccountProvider(account, provider) {
  if (!provider) return true;

  const normalizedProvider = provider.toLowerCase();
  const candidates = [account.provider, account.platform, account.network, account.type]
    .filter((value) => typeof value === 'string')
    .map((value) => value.toLowerCase());
  return candidates.some((value) => value === normalizedProvider);
}

function normalizeProviderName(value) {
  if (typeof value !== 'string') return null;
  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function getAccountProvider(account) {
  if (!account || typeof account !== 'object') return null;

  for (const fieldName of ['provider', 'platform', 'network', 'type']) {
    const normalizedValue = normalizeProviderName(account[fieldName]);
    if (normalizedValue) return normalizedValue;
  }

  return null;
}

function getAccountsArray(data) {
  const collection = extractAccountsCollection(data);
  if (!collection) return [];
  return collection.accounts.filter((account) => account && typeof account === 'object');
}

function findAccountByProfileId(data, profileId) {
  return getAccountsArray(data).find((account) => account.id === profileId || account.socialProfileId === profileId);
}

function findAccountByLinkedAccountId(data, linkedAccountId) {
  return getAccountsArray(data).find((account) => account.linkedAccountId === linkedAccountId);
}

function matchesAccountQuery(account, query) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  const visibleFields = [
    account.provider,
    account.platform,
    account.network,
    account.type,
    account.displayName,
    account.username,
    account.handle,
    account.name,
    account.avatarUrl,
  ];
  return visibleFields
    .filter((value) => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function applyAccountFilters(data, parsed) {
  const collection = extractAccountsCollection(data);
  if (!collection) return data;
  if (!parsed.provider && !parsed.match) return data;

  const filteredAccounts = collection.accounts.filter((account) => {
    if (!account || typeof account !== 'object') return false;
    return matchesAccountProvider(account, parsed.provider) && matchesAccountQuery(account, parsed.match);
  });

  if (!collection.key) return filteredAccounts;

  return {
    ...data,
    [collection.key]: filteredAccounts,
    filteredCount: filteredAccounts.length,
  };
}

function extractPostStatusEntries(post) {
  if (!post || typeof post !== 'object') return undefined;

  for (const key of ['accounts', 'profileStatuses', 'results', 'items', 'deliveries']) {
    const value = post[key];
    if (!Array.isArray(value)) continue;

    const entries = value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => pickDefinedFields({
        id: entry.id || entry.accountId || entry.profileId,
        profileId: entry.profileId,
        provider: entry.provider || entry.platform || entry.network,
        username: entry.username || entry.handle || entry.name,
        status: entry.status,
        subStatus: entry.subStatus,
        error: entry.errorMessage || entry.message || (entry.error && entry.error.message),
      }))
      .filter((entry) => Object.keys(entry).length > 0);

    if (entries.length > 0) return entries;
  }

  return undefined;
}

function summarizePostStatus(post, fallbackId) {
  if (!post || typeof post !== 'object') return { id: fallbackId };

  return pickDefinedFields({
    id: post.id || post.postId || fallbackId,
    contentId: post.contentId,
    status: post.status,
    mode: post.mode,
    scheduledTime: post.scheduledTime || post.scheduledAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    error: post.errorMessage || (post.error && post.error.message),
    accounts: extractPostStatusEntries(post),
  });
}

function summarizeDeleteEligibility(post, fallbackId) {
  if (!post || typeof post !== 'object') return { id: fallbackId };

  return pickDefinedFields({
    id: post.id || post.postId || fallbackId,
    type: post.type,
    status: post.status,
  });
}

function assertPostDeleteEligible(post, fallbackId) {
  if (!post || typeof post !== 'object') {
    throw new Error('Unable to confirm post state. Only scheduled posts that are still in scheduled status can be deleted.');
  }

  if (post.type === 'scheduled' && post.status === 'scheduled') return;

  const summary = summarizeDeleteEligibility(post, fallbackId);
  throw new Error(
    `Refusing to delete post ${summary.id || fallbackId}. Only scheduled posts that are still in scheduled status can be deleted.${summary.type || summary.status ? ` Current state: ${JSON.stringify(summary)}.` : ''}`,
  );
}

function parseInteger(value, fieldName) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Field "${fieldName}" must be a valid number.`);
  }
  return number;
}

function parseBoolean(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === false) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Field "${fieldName}" must be true or false.`);
}

function parseJsonValue(value, fieldName) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Field "${fieldName}" must be valid JSON.`);
  }
}

function parseScheduledTime(value) {
  if (value === undefined) return undefined;
  if (/^\d+$/.test(String(value))) return Number(value);
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new Error('Field "schedule" must be Unix milliseconds or an ISO timestamp.');
  }
  return timestamp;
}

function buildAnalyticsRequest(parsed, provider) {
  const profileId = parsed['profile-id'];
  if (!profileId) {
    throw new Error(`Usage: ${usage('analytics:profile --profile-id <social_profile_id> [--days 28 | --period day | --since 2026-04-01 --until 2026-04-28 | --cursor <cursor> --max-count 20]')}`);
  }

  const normalizedProvider = normalizeProviderName(provider);
  const hasDays = parsed.days !== undefined;
  const hasPeriod = parsed.period !== undefined;
  const hasSince = parsed.since !== undefined;
  const hasUntil = parsed.until !== undefined;
  const hasCursor = parsed.cursor !== undefined;
  const hasMaxCount = parsed['max-count'] !== undefined;
  const searchParams = new URLSearchParams();

  if (hasDays && (hasPeriod || hasSince || hasUntil)) {
    throw new Error('Do not combine --days with --period, --since, or --until.');
  }

  if (hasPeriod && (hasSince || hasUntil)) {
    throw new Error('Do not combine --period with --since or --until.');
  }

  if (normalizedProvider === TIKTOK_PROVIDER) {
    if (hasDays || hasPeriod || hasSince || hasUntil) {
      throw new Error('TikTok analytics only supports --cursor and --max-count.');
    }
  } else {
    if (!META_ANALYTICS_PROVIDERS.has(normalizedProvider)) {
      throw new Error(`Analytics is currently supported for Meta providers and TikTok. Matched provider: ${provider || 'unknown'}.`);
    }

    if (hasCursor || hasMaxCount) {
      throw new Error('Do not send --cursor or --max-count for non-TikTok analytics requests.');
    }
  }

  if (hasDays) searchParams.set('days', String(parsed.days));
  if (hasPeriod) searchParams.set('period', String(parsed.period));
  if (hasSince) searchParams.set('since', String(parsed.since));
  if (hasUntil) searchParams.set('until', String(parsed.until));
  if (hasCursor) searchParams.set('cursor', String(parsed.cursor));
  if (hasMaxCount) searchParams.set('maxCount', String(parseInteger(parsed['max-count'], 'max-count')));

  if (searchParams.size === 0 && normalizedProvider !== TIKTOK_PROVIDER) {
    searchParams.set('days', '28');
  }

  return {
    profileId,
    suffix: searchParams.size > 0 ? `?${searchParams.toString()}` : '',
  };
}

function buildKeywordSearchPayload(parsed) {
  if (!parsed['linked-account-id']) {
    throw new Error(`Usage: ${usage('keyword-search --linked-account-id <threads_linked_account_id> --keyword "launch tips" [--search-type TOP|RECENT]')}`);
  }

  if (!parsed.keyword) {
    throw new Error('Missing --keyword.');
  }

  const searchType = parsed['search-type'] === undefined
    ? undefined
    : String(parsed['search-type']).trim().toUpperCase();

  if (searchType !== undefined && searchType !== 'TOP' && searchType !== 'RECENT') {
    throw new Error('Field "search-type" must be TOP or RECENT.');
  }

  return pickDefinedFields({
    linkedAccountId: parsed['linked-account-id'],
    keyword: parsed.keyword,
    searchType,
  });
}

function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
  }[extension];
  if (!mimeType) throw new Error(`Unsupported file type for ${filePath}.`);
  return mimeType;
}

function inferPostType(filePaths) {
  const mimeTypes = filePaths.map(inferMimeType);
  if (mimeTypes.every((mimeType) => mimeType.startsWith('image/'))) return 'image';
  if (mimeTypes.length === 1 && mimeTypes[0].startsWith('video/')) return 'video';
  throw new Error('Unable to infer a valid postType from files. Use a single video or one or more images.');
}

async function request(method, endpoint, body) {
  const config = getConfig();
  if (!config || !config.baseUrl || !config.apiKey) {
    error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
    process.exit(1);
  }

  const result = await requestWithConfig(config, method, endpoint, body);
  return result.data;
}

async function requestWithBaseUrl(baseUrl, apiKey, method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { response, data };
}

async function requestWithConfig(config, method, endpoint, body, options = {}) {
  const baseUrlCandidates = config.baseUrlCandidates || [config.baseUrl];
  const fallbackStatuses = new Set(options.fallbackStatuses || []);
  let lastError = null;

  for (let index = 0; index < baseUrlCandidates.length; index += 1) {
    const baseUrl = baseUrlCandidates[index];

    try {
      const { response, data } = await requestWithBaseUrl(baseUrl, config.apiKey, method, endpoint, body);

      if (response.ok) {
        return { data, baseUrl, baseUrlSource: config.baseUrlSource };
      }

      lastError = new Error(`API error (${response.status}) at ${baseUrl}: ${formatApiError(data)}`);
      lastError.isApiError = true;
      const canFallback = index < baseUrlCandidates.length - 1 && fallbackStatuses.has(response.status);
      if (canFallback) continue;
      throw lastError;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const canFallback = index < baseUrlCandidates.length - 1
        && options.retryOnNetworkError === true
        && lastError.isApiError !== true;
      if (canFallback) continue;
      throw lastError;
    }
  }

  throw lastError || new Error('Request failed.');
}

async function uploadFile(filePath) {
  const config = getConfig();
  if (!config || !config.baseUrl || !config.apiKey) {
    error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`File not found: ${absolutePath}`);

  const stats = fs.statSync(absolutePath);
  const mimeType = inferMimeType(absolutePath);
  const createUpload = await request('POST', '/api/agent/v1/media/create-upload-url', {
    filename: path.basename(absolutePath),
    contentType: mimeType,
  });

  const uploadResponse = await fetch(createUpload.uploadUrl, {
    method: createUpload.method || 'PUT',
    headers: { 'Content-Type': mimeType },
    body: fs.readFileSync(absolutePath),
  });

  if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status}).`);

  return {
    file: absolutePath,
    mimeType,
    sizeBytes: stats.size,
    storageKey: createUpload.key,
    uploadMethod: createUpload.method || 'PUT',
  };
}

async function verifyConfig(config) {
  return requestWithConfig(config, 'GET', '/api/agent/v1/accounts', undefined, {
    fallbackStatuses: config.baseUrlSource === 'inferred' ? [404] : [],
    retryOnNetworkError: config.baseUrlSource === 'inferred',
  });
}

async function requestAccounts(config = getConfig()) {
  if (!config || !config.baseUrl || !config.apiKey) {
    error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
    process.exit(1);
  }

  const result = await requestWithConfig(config, 'GET', '/api/agent/v1/accounts', undefined, {
    fallbackStatuses: config.baseUrlSource === 'inferred' ? [404] : [],
    retryOnNetworkError: config.baseUrlSource === 'inferred',
  });
  return result.data;
}

async function buildHealthReport(config = getConfig()) {
  if (!config || !config.baseUrl || !config.apiKey) {
    return {
      configured: false,
      accountsReachable: false,
      setupHint: usage('setup --api-key <api_key>'),
    };
  }

  const baseReport = {
    configured: true,
    source: config.source,
    configPath: config.configPath,
    savedBaseUrl: config.baseUrl,
    baseUrlSource: config.baseUrlSource,
    apiKey: redactApiKey(config.apiKey),
  };

  try {
    const result = await requestWithConfig(config, 'GET', '/api/agent/v1/accounts', undefined, {
      fallbackStatuses: config.baseUrlSource === 'inferred' ? [404] : [],
      retryOnNetworkError: config.baseUrlSource === 'inferred',
    });
    const collection = extractAccountsCollection(result.data);
    return {
      ...baseReport,
      accountsReachable: true,
      activeBaseUrl: result.baseUrl,
      accountCount: collection ? collection.accounts.length : undefined,
    };
  } catch (err) {
    return {
      ...baseReport,
      accountsReachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildPostPayload(parsed) {
  const mode = parsed.mode === 'scheduled' || parsed.schedule ? 'scheduled' : 'direct';
  const socialProfileIds = parseCommaList(parsed.accounts);
  const payload = {
    contentId: parsed['content-id'],
    socialProfileIds,
    mode,
  };

  if (!payload.contentId) throw new Error('Missing --content-id.');
  if (!payload.socialProfileIds || payload.socialProfileIds.length === 0) {
    throw new Error('Missing --accounts. Use comma-separated id/socialProfileId values from accounts.');
  }

  const scheduledTime = parseScheduledTime(parsed.schedule);
  if (mode === 'scheduled') {
    if (scheduledTime === undefined) throw new Error('Scheduled posts require --schedule.');
    payload.scheduledTime = scheduledTime;
    payload.scheduledTimezone = parsed.timezone || 'UTC';
  }

  const optionalFields = {
    captionOverride: parsed['caption-override'],
    titleOverride: parsed['title-override'],
    youtubePrivacyStatus: parsed['youtube-privacy-status'],
    tiktokPrivacyLevel: parsed['tiktok-privacy-level'],
    tiktokAllowComment: parseBoolean(parsed['tiktok-allow-comment'], 'tiktok-allow-comment'),
    tiktokAllowDuet: parseBoolean(parsed['tiktok-allow-duet'], 'tiktok-allow-duet'),
    tiktokAllowStitch: parseBoolean(parsed['tiktok-allow-stitch'], 'tiktok-allow-stitch'),
    tiktokBrandContentToggle: parseBoolean(parsed['tiktok-brand-content-toggle'], 'tiktok-brand-content-toggle'),
    tiktokBrandOrganicToggle: parseBoolean(parsed['tiktok-brand-organic-toggle'], 'tiktok-brand-organic-toggle'),
    tiktokDraftMode: parseBoolean(parsed['tiktok-draft-mode'], 'tiktok-draft-mode'),
    instagramCollaborators: parseCommaList(parsed['instagram-collaborators']),
    instagramUserTags: parseJsonValue(parsed['instagram-user-tags'], 'instagram-user-tags'),
    videoThumbnailOffsetMs: parseInteger(parsed['video-thumbnail-offset-ms'], 'video-thumbnail-offset-ms'),
    customThumbnailStorageKey: parsed['custom-thumbnail-storage-key'],
    facebookLocationId: parsed['facebook-location-id'],
    facebookLocationName: parsed['facebook-location-name'],
    instagramLocationId: parsed['instagram-location-id'],
    instagramLocationName: parsed['instagram-location-name'],
    mediaOrderOverride: parseCommaList(parsed['media-order-override']),
  };

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) payload[key] = value;
  }

  const extraJson = parseJsonValue(parsed.json, 'json');
  if (extraJson !== undefined) {
    if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) {
      throw new Error('Field "json" must be a JSON object.');
    }
    Object.assign(payload, extraJson);
  }

  return payload;
}

const COMMANDS = {
  setup: async (args) => {
    const parsed = parseArgs(args);
    const apiKey = parsed['api-key'];
    if (!apiKey) {
      throw new Error(`Usage: ${usage(`setup --api-key <api_key> [--base-url ${DEFAULT_BASE_URL}]`)}`);
    }

    const resolved = buildBaseUrlCandidates(parsed['base-url'], apiKey);
    const config = createConfig({
      apiKey,
      baseUrl: resolved.baseUrl,
      baseUrlCandidates: resolved.baseUrlCandidates,
      source: 'setup',
      baseUrlSource: resolved.baseUrlSource,
    });
    const global = !parsed.local;

    let verifiedBaseUrl = config.baseUrl;
    if (!parsed['no-verify']) {
      const verification = await verifyConfig(config);
      verifiedBaseUrl = verification.baseUrl;
      if (verification.baseUrl !== config.baseUrl) {
        info(`Setup verification succeeded against ${verification.baseUrl} after ${config.baseUrl} failed. Saving the verified base URL.`);
      } else {
        info(`Setup verification succeeded against ${verification.baseUrl}.`);
      }
    }

    const savedBaseUrlSource = parsed['base-url']
      ? 'explicit'
      : verifiedBaseUrl === inferBaseUrlFromApiKey(apiKey)
        ? 'inferred'
        : 'fallback';

    const filePath = saveConfig({ baseUrl: verifiedBaseUrl, apiKey, baseUrlSource: savedBaseUrlSource }, global, parsed);
    const location = getExplicitConfigPath(parsed) ? 'explicit' : global ? 'global' : 'local';
    info(`Config saved ${location === 'explicit' ? 'to explicit path' : location} at ${filePath}.`);
    output({
      status: 'configured',
      location,
      configPath: filePath,
      baseUrl: verifiedBaseUrl,
      baseUrlSource: savedBaseUrlSource,
      verified: !parsed['no-verify'],
      apiKey: redactApiKey(apiKey),
    });
  },
  config: async (args) => {
    const config = getConfig(parseArgs(args));
    output(config ? {
      configured: true,
      source: config.source,
      configPath: config.configPath,
      baseUrl: config.baseUrl,
      baseUrlSource: config.baseUrlSource,
      apiKey: redactApiKey(config.apiKey),
    } : { configured: false });
  },
  accounts: async (args) => output(applyAccountFilters(await requestAccounts(), parseArgs(args))),
  'analytics:profile': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed['profile-id']) {
      buildAnalyticsRequest(parsed);
    }
    const accounts = await requestAccounts();
    const profileId = parsed['profile-id'];
    const account = findAccountByProfileId(accounts, profileId);
    if (!account) {
      throw new Error('Profile not found in accounts. Run accounts and use the returned id/socialProfileId value.');
    }

    const analyticsRequest = buildAnalyticsRequest(parsed, getAccountProvider(account));
    output(await request('GET', `/api/agent/v1/analytics/profiles/${encodeURIComponent(analyticsRequest.profileId)}${analyticsRequest.suffix}`));
  },
  health: async () => output(await buildHealthReport()),
  whoami: async () => output(await buildHealthReport()),
  'keyword-search': async (args) => {
    const parsed = parseArgs(args);
    const payload = buildKeywordSearchPayload(parsed);
    const accounts = await requestAccounts();
    const account = findAccountByLinkedAccountId(accounts, payload.linkedAccountId);
    if (!account) {
      throw new Error('Linked account not found in accounts. Run accounts and use the returned linkedAccountId for a Threads account.');
    }

    const provider = getAccountProvider(account);
    if (provider !== THREADS_PROVIDER) {
      throw new Error(`Keyword search only supports Threads linked accounts. Matched provider: ${provider || 'unknown'}.`);
    }

    output(await request('POST', '/api/agent/v1/keyword-search', payload));
  },
  upload: async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.file) throw new Error(`Usage: ${usage('upload --file ./clip.mp4')}`);
    output(await uploadFile(parsed.file));
  },
  'content:create': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.caption) throw new Error('Missing --caption.');
    const mediaItems = parsed['media-items']
      ? parseJsonValue(parsed['media-items'], 'media-items')
      : parsed['storage-key']
        ? [{ storageKey: parsed['storage-key'], ...(parsed['size-bytes'] !== undefined ? { sizeBytes: parseInteger(parsed['size-bytes'], 'size-bytes') } : {}) }]
        : [];
    const postType = parsed['post-type'] || (mediaItems.length > 0 ? 'image' : 'text');
    output(await request('POST', '/api/agent/v1/contents', {
      title: parsed.title,
      caption: parsed.caption,
      postType,
      mediaItems,
      isAI: parseBoolean(parsed['is-ai'], 'is-ai'),
    }));
  },
  post: async (args) => output(await request('POST', '/api/agent/v1/posts', buildPostPayload(parseArgs(args)))) ,
  publish: async (args) => {
    const parsed = parseArgs(args);
    const files = parseCommaList(parsed.file || parsed.files);
    if (!parsed.caption) throw new Error('Missing --caption.');
    if (!files || files.length === 0) throw new Error('Missing --file or --files.');
    if (!parsed.accounts) throw new Error('Missing --accounts. Use comma-separated id/socialProfileId values from accounts.');
    const uploads = [];
    for (const filePath of files) uploads.push(await uploadFile(filePath));
    const postType = parsed['post-type'] || inferPostType(files);
    const content = await request('POST', '/api/agent/v1/contents', {
      title: parsed.title,
      caption: parsed.caption,
      postType,
      mediaItems: uploads.map((upload) => ({ storageKey: upload.storageKey, sizeBytes: upload.sizeBytes })),
      isAI: parseBoolean(parsed['is-ai'], 'is-ai'),
    });
    const post = await request('POST', '/api/agent/v1/posts', buildPostPayload({ ...parsed, 'content-id': content.contentId }));
    output({ uploads, content, post });
  },
  posts: async (args) => {
    const parsed = parseArgs(args);
    const searchParams = new URLSearchParams();
    if (parsed.limit !== undefined) searchParams.set('limit', String(parsed.limit));
    if (parsed.cursor) searchParams.set('cursor', parsed.cursor);
    if (parsed.status) searchParams.set('status', parsed.status);
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
    output(await request('GET', `/api/agent/v1/posts${suffix}`));
  },
  'posts:get': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) throw new Error(`Usage: ${usage('posts:get --id <post_id>')}`);
    const post = await request('GET', `/api/agent/v1/posts/${parsed.id}`);
    output(parsed['status-only'] ? summarizePostStatus(post, parsed.id) : post);
  },
  'posts:delete': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) throw new Error(`Usage: ${usage('posts:delete --id <post_id>')}`);
    const post = await request('GET', `/api/agent/v1/posts/${parsed.id}`);
    assertPostDeleteEligible(post, parsed.id);
    output(await request('DELETE', `/api/agent/v1/posts/${parsed.id}`));
  },
  help: async () => output({
    name: 'Po Once Agent API Skill',
    scriptPath: SKILL_SCRIPT_PATH,
    relativeScriptPath: RELATIVE_SCRIPT_PATH_NOTE,
    commands: Object.keys(COMMANDS).filter((command) => command !== 'help'),
    commandHelp: {
      'analytics:profile': {
        summary: 'Fetch provider-specific profile analytics after resolving the account through accounts.',
        usage: [
          `${usage('analytics:profile --profile-id <social_profile_id> --days 28')}`,
          `${usage('analytics:profile --profile-id <social_profile_id> --cursor <cursor> --max-count 20')}`,
        ],
        notes: [
          'Meta profiles support --days, --period, --since, and --until.',
          'TikTok profiles support --cursor and --max-count.',
          'Do not combine --days with --period, --since, or --until.',
        ],
      },
      'keyword-search': {
        summary: 'Run ad-hoc Threads keyword discovery using a Threads linkedAccountId from accounts.',
        usage: [
          `${usage('keyword-search --linked-account-id <threads_linked_account_id> --keyword "launch tips"')}`,
          `${usage('keyword-search --linked-account-id <threads_linked_account_id> --keyword "launch tips" --search-type RECENT')}`,
        ],
        notes: [
          '--search-type defaults to TOP.',
          'Only Threads linked accounts are valid for keyword search.',
        ],
      },
    },
    defaultBaseUrl: DEFAULT_BASE_URL,
    testBaseUrl: DEV_BASE_URL,
    testKeyPrefix: DEV_API_KEY_PREFIX,
    env: ['PO_ONCE_BASE_URL', 'PO_ONCE_AGENT_API_KEY', 'PO_ONCE_CONFIG_PATH'],
  }),
};

async function main() {
  const command = process.argv[2] || 'help';
  const args = process.argv.slice(3);
  if (!COMMANDS[command]) {
    error(`Unknown command: ${command}`);
    error(`Available commands: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }
  try {
    await COMMANDS[command](args);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
