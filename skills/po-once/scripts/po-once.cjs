#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_BASE_URL = 'https://dynamic-lapwing-647.convex.site';
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
const JOBS_DIR = path.join(CONFIG_DIR, 'jobs');
const BACKGROUND_COMMANDS = new Set(['upload', 'publish']);
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_PROGRESS_INTERVAL_MS = 5000;
const UPLOAD_READ_CHUNK_BYTES = 1024 * 1024;
const JOB_WAIT_DEFAULT_SECONDS = 60;
const JOB_WAIT_MAX_SECONDS = 540;
const JOB_WAIT_POLL_MS = 2000;
let activeJob = null;
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

function buildBaseUrlCandidates() {
  return {
    baseUrl: DEFAULT_BASE_URL,
    baseUrlCandidates: [DEFAULT_BASE_URL],
    baseUrlSource: 'default',
  };
}

function resolveSavedBaseUrl(config) {
  if (!config || !config.apiKey) return null;
  return buildBaseUrlCandidates();
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
    const resolved = buildBaseUrlCandidates();
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
  const baseUrl = DEFAULT_BASE_URL;
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
  const redacted = redactSensitiveData(data);
  if (activeJob) {
    updateJobRecord(activeJob.id, { status: 'succeeded', result: redacted, finishedAt: new Date().toISOString() });
  }
  console.log(JSON.stringify(redacted, null, 2));
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
    throw new Error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUploadError(err) {
  if (!err) return false;
  if (err.statusCode === undefined) return true; // network / socket error
  return err.statusCode === 403 || err.statusCode === 408 || err.statusCode === 429 || err.statusCode >= 500;
}

// Streams the file from disk straight into the PUT request. Memory stays flat
// (about one read chunk) no matter how large the file is, which is what lets
// multi-GB videos upload on ordinary laptops.
function putFileToUrl(uploadUrl, absolutePath, sizeBytes, mimeType, onProgress) {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const transport = url.protocol === 'http:' ? http : https;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = transport.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': sizeBytes,
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 4096) body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          finish(resolve);
          return;
        }
        const err = new Error(`Upload failed (${res.statusCode})${body ? `: ${body.replace(/\s+/g, ' ').slice(0, 300)}` : ''}.`);
        err.statusCode = res.statusCode;
        finish(reject, err);
      });
      res.on('error', (err) => finish(reject, err));
    });

    req.on('error', (err) => finish(reject, err));

    const stream = fs.createReadStream(absolutePath, { highWaterMark: UPLOAD_READ_CHUNK_BYTES });
    let sent = 0;
    stream.on('data', (chunk) => {
      sent += chunk.length;
      onProgress(sent);
    });
    stream.on('error', (err) => {
      req.destroy(err);
      finish(reject, err);
    });
    stream.pipe(req);
  });
}

async function uploadFile(filePath, options = {}) {
  const config = getConfig();
  if (!config || !config.baseUrl || !config.apiKey) {
    throw new Error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`File not found: ${absolutePath}`);

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) throw new Error(`Not a file: ${absolutePath}`);
  if (stats.size === 0) throw new Error(`File is empty: ${absolutePath}`);

  const mimeType = inferMimeType(absolutePath);
  const sizeBytes = stats.size;
  const fileName = path.basename(absolutePath);
  const fileLabel = options.fileCount > 1 ? `${fileName} (${options.fileIndex}/${options.fileCount})` : fileName;

  let lastError = null;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    // Sending sizeBytes lets the API reject the upload up front when the
    // organization's storage quota would be exceeded, instead of after
    // transferring the whole file.
    const createUpload = await request('POST', '/api/agent/v1/media/create-upload-url', {
      filename: fileName,
      contentType: mimeType,
      sizeBytes,
    });

    const startedAt = Date.now();
    let lastReportAt = 0;
    const reportProgress = (sent, force) => {
      const now = Date.now();
      if (!force && now - lastReportAt < UPLOAD_PROGRESS_INTERVAL_MS) return;
      lastReportAt = now;
      const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
      const bytesPerSecond = sent / elapsedSeconds;
      const remainingSeconds = bytesPerSecond > 0 ? Math.round((sizeBytes - sent) / bytesPerSecond) : null;
      const percent = Math.floor((sent / sizeBytes) * 100);
      info(`Uploading ${fileLabel}: ${percent}% (${formatBytes(sent)} / ${formatBytes(sizeBytes)}, ${formatBytes(bytesPerSecond)}/s${remainingSeconds !== null && sent < sizeBytes ? `, ~${remainingSeconds}s left` : ''})`);
      if (activeJob) {
        updateJobRecord(activeJob.id, {
          progress: {
            file: fileName,
            fileIndex: options.fileIndex || 1,
            fileCount: options.fileCount || 1,
            attempt,
            sentBytes: sent,
            totalBytes: sizeBytes,
            percent,
            bytesPerSecond: Math.round(bytesPerSecond),
            remainingSeconds,
            updatedAt: new Date(now).toISOString(),
          },
        });
      }
    };

    info(`Uploading ${fileLabel}: ${formatBytes(sizeBytes)}${attempt > 1 ? ` (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS})` : ''}`);
    try {
      await putFileToUrl(createUpload.uploadUrl, absolutePath, sizeBytes, mimeType, (sent) => reportProgress(sent, false));
      reportProgress(sizeBytes, true);
      return {
        file: absolutePath,
        mimeType,
        sizeBytes,
        storageKey: createUpload.key,
        uploadMethod: createUpload.method || 'PUT',
        uploadSeconds: Math.round((Date.now() - startedAt) / 1000),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isRetryableUploadError(lastError) || attempt === UPLOAD_MAX_ATTEMPTS) break;
      info(`Upload attempt ${attempt} failed (${lastError.message}). Retrying with a fresh upload URL.`);
      await sleep(2000 * attempt);
    }
  }

  throw new Error(`${lastError ? lastError.message : 'Upload failed.'} File: ${fileLabel}, ${formatBytes(sizeBytes)}. The file was not modified; do not compress or re-encode it. Retry the same command (use --background for long uploads).`);
}

function jobFilePath(jobId) {
  if (!/^[a-z0-9-]+$/i.test(String(jobId))) throw new Error(`Invalid job id: ${jobId}`);
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function readJobRecord(jobId) {
  const record = readJson(jobFilePath(jobId));
  if (!record) throw new Error(`Unknown job id: ${jobId}. Run ${usage('jobs:list')} to see recent background jobs.`);
  return record;
}

function updateJobRecord(jobId, patch) {
  const filePath = jobFilePath(jobId);
  const existing = readJson(filePath) || {};
  writeJson(filePath, { ...existing, ...patch, updatedAt: new Date().toISOString() });
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function reconcileJobRecord(record) {
  if (record.status === 'running' && !isProcessAlive(record.pid)) {
    updateJobRecord(record.id, {
      status: 'failed',
      error: `Background process (pid ${record.pid}) exited before reporting a result. Check the log file for details.`,
      finishedAt: new Date().toISOString(),
    });
    return readJobRecord(record.id);
  }
  return record;
}

function summarizeJob(record) {
  return pickDefinedFields({
    jobId: record.id,
    command: record.command,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    progress: record.progress,
    result: record.result,
    error: record.error,
    logFile: record.logFile,
    statusCommand: record.status === 'running' ? usage(`jobs:status --id ${record.id}`) : undefined,
    waitCommand: record.status === 'running' ? usage(`jobs:wait --id ${record.id} --timeout ${JOB_WAIT_DEFAULT_SECONDS}`) : undefined,
  });
}

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === '1';
}

function stripBackgroundFlag(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--background') {
      const next = args[index + 1];
      if (next === 'true' || next === 'false' || next === '1' || next === '0') index += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}

function startBackgroundJob(command, args) {
  const jobId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const jobFile = jobFilePath(jobId);
  const logFile = path.join(JOBS_DIR, `${jobId}.log`);
  const childArgs = [...stripBackgroundFlag(args), '--job-id', jobId];

  writeJson(jobFile, {
    id: jobId,
    command,
    status: 'running',
    createdAt: new Date().toISOString(),
    logFile,
    cwd: process.cwd(),
  });

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [__filename, command, ...childArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    cwd: process.cwd(),
  });
  fs.closeSync(logFd);
  child.unref();
  updateJobRecord(jobId, { pid: child.pid });

  info(`Started background job ${jobId} (pid ${child.pid}). It keeps running after this command returns.`);
  console.log(JSON.stringify({
    jobId,
    command,
    status: 'running',
    pid: child.pid,
    logFile,
    statusCommand: usage(`jobs:status --id ${jobId}`),
    waitCommand: usage(`jobs:wait --id ${jobId} --timeout ${JOB_WAIT_DEFAULT_SECONDS}`),
    note: 'Poll jobs:wait until status is succeeded or failed. Do not re-run the command while the job is running.',
  }, null, 2));
}

async function waitForJob(jobId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let record = reconcileJobRecord(readJobRecord(jobId));
  while (record.status === 'running' && Date.now() < deadline) {
    await sleep(Math.min(JOB_WAIT_POLL_MS, Math.max(deadline - Date.now(), 0)));
    record = reconcileJobRecord(readJobRecord(jobId));
  }
  return record;
}

async function verifyConfig(config) {
  return requestWithConfig(config, 'GET', '/api/agent/v1/accounts');
}

async function requestAccounts(config = getConfig()) {
  if (!config || !config.baseUrl || !config.apiKey) {
    throw new Error(`Missing Po Once credentials. Run: ${usage('setup --api-key <api_key>')} or use ${RELATIVE_SCRIPT_PATH_NOTE}.`);
  }

  const result = await requestWithConfig(config, 'GET', '/api/agent/v1/accounts');
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
    const result = await requestWithConfig(config, 'GET', '/api/agent/v1/accounts');
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
      throw new Error(`Usage: ${usage('setup --api-key <api_key>')}`);
    }

    const resolved = buildBaseUrlCandidates();
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
      info(`Setup verification succeeded against ${verification.baseUrl}.`);
    }

    const savedBaseUrlSource = 'default';

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
    for (let index = 0; index < files.length; index += 1) {
      uploads.push(await uploadFile(files[index], { fileIndex: index + 1, fileCount: files.length }));
    }
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
  'jobs:status': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) throw new Error(`Usage: ${usage('jobs:status --id <job_id>')}`);
    output(summarizeJob(reconcileJobRecord(readJobRecord(parsed.id))));
  },
  'jobs:wait': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) throw new Error(`Usage: ${usage(`jobs:wait --id <job_id> --timeout ${JOB_WAIT_DEFAULT_SECONDS}`)}`);
    const requested = parsed.timeout === undefined ? JOB_WAIT_DEFAULT_SECONDS : parseInteger(parsed.timeout, 'timeout');
    const timeoutSeconds = Math.min(Math.max(requested, 1), JOB_WAIT_MAX_SECONDS);
    output(summarizeJob(await waitForJob(parsed.id, timeoutSeconds)));
  },
  'jobs:list': async () => {
    if (!fs.existsSync(JOBS_DIR)) {
      output({ jobs: [] });
      return;
    }
    const jobs = fs.readdirSync(JOBS_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(path.join(JOBS_DIR, name)))
      .filter((record) => record && record.id)
      .map(reconcileJobRecord)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map((record) => pickDefinedFields({
        jobId: record.id,
        command: record.command,
        status: record.status,
        createdAt: record.createdAt,
        finishedAt: record.finishedAt,
        percent: record.progress ? record.progress.percent : undefined,
        error: record.error,
      }));
    output({ jobs });
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
      upload: {
        summary: 'Upload one media file. Streams from disk, so file size is only limited by the destination platform; never compress or re-encode to make an upload "fit".',
        usage: [
          `${usage('upload --file ./clip.mp4')}`,
          `${usage('upload --file ./clip.mp4 --background')}`,
        ],
        notes: [
          'Progress lines are printed to stderr every few seconds.',
          'Use --background for large files or slow connections; the upload continues after the command returns. Poll with jobs:wait.',
          'Failed transfers are retried automatically with a fresh upload URL.',
        ],
      },
      publish: {
        summary: 'Upload, create content, and create a post in one step.',
        usage: [
          `${usage('publish --file ./clip.mp4 --caption "..." --accounts <id,id> --mode direct')}`,
          `${usage('publish --file ./clip.mp4 --caption "..." --accounts <id,id> --mode scheduled --schedule 2026-04-17T09:00:00Z --background')}`,
        ],
        notes: [
          'Supports --background exactly like upload; the final result (uploads, content, post) is stored on the job.',
        ],
      },
      'jobs:wait': {
        summary: 'Wait for a background job to finish (default 60s, max 540s) and print its status/result.',
        usage: [`${usage('jobs:wait --id <job_id> --timeout 60')}`],
        notes: ['Returns status running with progress if the job is still transferring; call again.'],
      },
      'jobs:status': {
        summary: 'Print a background job\'s current status, progress, result, or error without waiting.',
        usage: [`${usage('jobs:status --id <job_id>')}`],
      },
      'jobs:list': {
        summary: 'List the 20 most recent background jobs.',
        usage: [`${usage('jobs:list')}`],
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
    env: ['PO_ONCE_AGENT_API_KEY', 'PO_ONCE_CONFIG_PATH'],
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
  const parsed = parseArgs(args);
  if (isTruthyFlag(parsed.background)) {
    if (!BACKGROUND_COMMANDS.has(command)) {
      error(`--background is only supported for: ${Array.from(BACKGROUND_COMMANDS).join(', ')}.`);
      process.exit(1);
    }
    try {
      startBackgroundJob(command, args);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  if (parsed['job-id'] && BACKGROUND_COMMANDS.has(command)) {
    activeJob = { id: String(parsed['job-id']) };
    updateJobRecord(activeJob.id, { status: 'running', pid: process.pid, startedAt: new Date().toISOString() });
  }

  try {
    await COMMANDS[command](args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (activeJob) {
      updateJobRecord(activeJob.id, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
    }
    error(message);
    process.exit(1);
  }
}

main();
