#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEV_BASE_URL = 'https://dynamic-lapwing-647.convex.site';
const DEFAULT_BASE_URL = 'https://fastidious-elephant-379.convex.site';
const DEV_API_KEY_PREFIX = 'po_test_org_';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'po-once');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOCAL_CONFIG = path.join(process.cwd(), '.po-once', 'config.json');

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

function resolveBaseUrl(baseUrl, apiKey) {
  return normalizeBaseUrl(baseUrl || inferBaseUrlFromApiKey(apiKey));
}

function getConfig() {
  if (process.env.PO_ONCE_AGENT_API_KEY) {
    return {
      baseUrl: resolveBaseUrl(process.env.PO_ONCE_BASE_URL, process.env.PO_ONCE_AGENT_API_KEY),
      apiKey: process.env.PO_ONCE_AGENT_API_KEY,
      source: 'env',
    };
  }

  if (fs.existsSync(LOCAL_CONFIG)) {
    const local = readJson(LOCAL_CONFIG);
    if (local && local.apiKey) {
      return {
        baseUrl: resolveBaseUrl(local.baseUrl, local.apiKey),
        apiKey: local.apiKey,
        source: 'local',
      };
    }
  }

  if (fs.existsSync(CONFIG_FILE)) {
    const global = readJson(CONFIG_FILE);
    if (global && global.apiKey) {
      return {
        baseUrl: resolveBaseUrl(global.baseUrl, global.apiKey),
        apiKey: global.apiKey,
        source: 'global',
      };
    }
  }

  return null;
}

function saveConfig(nextConfig, global = true) {
  const filePath = global ? CONFIG_FILE : LOCAL_CONFIG;
  const existing = readJson(filePath) || {};
  const apiKey = nextConfig.apiKey || existing.apiKey;
  const merged = {
    ...existing,
    ...nextConfig,
    baseUrl: resolveBaseUrl(nextConfig.baseUrl || existing.baseUrl, apiKey),
  };
  writeJson(filePath, merged);
  return filePath;
}

function redactApiKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function error(message) {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

function info(message) {
  console.error(`\x1b[36mInfo:\x1b[0m ${message}`);
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
    error('Missing Po Once credentials. Run: ./scripts/po-once.cjs setup --api-key <api_key>');
    process.exit(1);
  }

  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
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

  if (!response.ok) {
    const message = data && data.error ? `${data.error.code}: ${data.error.message}` : JSON.stringify(data);
    throw new Error(`API error (${response.status}): ${message}`);
  }

  return data;
}

async function uploadFile(filePath) {
  const config = getConfig();
  if (!config || !config.baseUrl || !config.apiKey) {
    error('Missing Po Once credentials. Run: ./scripts/po-once.cjs setup --api-key <api_key>');
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

function buildPostPayload(parsed) {
  const mode = parsed.mode === 'scheduled' || parsed.schedule ? 'scheduled' : 'direct';
  const payload = {
    contentId: parsed['content-id'],
    profileIds: parseCommaList(parsed.accounts),
    mode,
  };

  if (!payload.contentId) throw new Error('Missing --content-id.');
  if (!payload.profileIds || payload.profileIds.length === 0) {
    throw new Error('Missing --accounts. Use comma-separated profile IDs.');
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
      throw new Error(`Usage: ./scripts/po-once.cjs setup --api-key <api_key> [--base-url ${DEFAULT_BASE_URL}]`);
    }
    const baseUrl = resolveBaseUrl(parsed['base-url'], apiKey);
    const global = !parsed.local;
    const filePath = saveConfig({ baseUrl, apiKey }, global);
    info(`Config saved ${global ? 'globally' : 'locally'} at ${filePath}.`);
    output({ status: 'configured', location: global ? 'global' : 'local', baseUrl, apiKey: redactApiKey(apiKey) });
  },
  config: async () => {
    const config = getConfig();
    output(config ? { configured: true, source: config.source, baseUrl: config.baseUrl, apiKey: redactApiKey(config.apiKey) } : { configured: false });
  },
  accounts: async () => output(await request('GET', '/api/agent/v1/accounts')),
  upload: async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.file) throw new Error('Usage: ./scripts/po-once.cjs upload --file ./clip.mp4');
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
    if (!parsed.accounts) throw new Error('Missing --accounts. Use comma-separated profile IDs.');
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
    if (!parsed.id) throw new Error('Usage: ./scripts/po-once.cjs posts:get --id <post_id>');
    output(await request('GET', `/api/agent/v1/posts/${parsed.id}`));
  },
  'posts:delete': async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) throw new Error('Usage: ./scripts/po-once.cjs posts:delete --id <post_id>');
    output(await request('DELETE', `/api/agent/v1/posts/${parsed.id}`));
  },
  help: async () => output({
    name: 'Po Once Agent API Skill',
    commands: Object.keys(COMMANDS).filter((command) => command !== 'help'),
    defaultBaseUrl: DEFAULT_BASE_URL,
    env: ['PO_ONCE_BASE_URL', 'PO_ONCE_AGENT_API_KEY'],
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
