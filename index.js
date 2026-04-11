import fs from "node:fs/promises";
import path from "node:path";

const ASSISTANT_NAME = "Assistant";
const DEFAULT_ARCHIVE_ROOT = path.join("logs", "message-archive-raw");
const DEFAULT_EVENT_ARCHIVE_ROOT = path.join("logs", "message-archive-events");
const DEFAULT_STATE_DIR = path.join(process.env.HOME || "", ".openclaw");
const SUPPORTED_CHANNELS = new Set([
  "telegram",
  "bluebubbles",
  "feishu",
  "whatsapp",
  "discord",
  "signal",
  "imessage",
  "webchat",
  "slack",
  "line",
]);

const NON_ALNUM_RE = /[^a-z0-9._+-]+/g;
const BLUEBUBBLES_GROUP_GUID_RE =
  /(?:^|:)(?:chat_guid:)?(?:imessage|sms|auto);\+;[a-z0-9._-]+$/i;
const BLUEBUBBLES_CHAT_IDENTIFIER_RE = /(?:^|:)(?:chat_identifier:)?chat[a-z0-9._-]{6,}$/i;
const MEDIA_PLACEHOLDER_LINE_RE =
  /^\[media attached(?:(?: \d+\/\d+)|: \d+ files)?(?:[:\]])|^<media:[^>]+>$/i;
const warnedUnsupportedChannels = new Set();
const recentArchiveWriteCache = new Map();
const RECENT_ARCHIVE_WRITE_TTL_MS = 10 * 60 * 1000;
const SEARCH_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    sender: { type: "string" },
    channel: { type: "string" },
    chat_type: {
      type: "string",
      enum: ["direct", "group", "channel"],
    },
    peer: { type: "string" },
    date: { type: "string" },
    from_date: { type: "string" },
    to_date: { type: "string" },
    role: {
      type: "string",
      enum: ["user", "assistant"],
    },
    limit: {
      type: "number",
      minimum: 1,
      maximum: 100,
    },
  },
};
const HEALTH_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hours: {
      type: "number",
      minimum: 1,
      maximum: 24 * 365,
    },
  },
};
const REQUIRED_ARCHIVE_FIELDS = [
  "timestamp_utc",
  "timestamp_local",
  "local_date",
  "local_time",
  "channel",
  "chat_type",
  "role",
  "text",
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function normalizeTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric < 1e11 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}

export function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatLocalTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatLocalTimestamp(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffsetMinutes / 60);
  const offsetRemainder = absOffsetMinutes % 60;
  return `${formatLocalDate(date)}T${formatLocalTime(date)}${sign}${pad2(offsetHours)}:${pad2(offsetRemainder)}`;
}

function sanitizeSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(NON_ALNUM_RE, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

function normalizeOptionalString(value) {
  const raw = String(value || "").trim();
  return raw || undefined;
}

function stripChannelPrefix(value, channelId) {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    return undefined;
  }
  const genericPrefixes = ["channel:", "chat:", "user:"];
  for (const prefix of genericPrefixes) {
    if (raw.startsWith(prefix)) {
      return raw.slice(prefix.length).trim() || undefined;
    }
  }
  const channel = String(channelId || "").trim().toLowerCase();
  const channelPrefix = channel ? `${channel}:` : "";
  if (channelPrefix && raw.toLowerCase().startsWith(channelPrefix)) {
    return raw.slice(channelPrefix.length).trim() || undefined;
  }
  return raw;
}

function stripTelegramInternalPrefixes(value) {
  let trimmed = String(value || "").trim();
  let strippedTelegramPrefix = false;
  while (true) {
    const next = (() => {
      if (/^(telegram|tg):/i.test(trimmed)) {
        strippedTelegramPrefix = true;
        return trimmed.replace(/^(telegram|tg):/i, "").trim();
      }
      if (strippedTelegramPrefix && /^group:/i.test(trimmed)) {
        return trimmed.replace(/^group:/i, "").trim();
      }
      return trimmed;
    })();
    if (next === trimmed) {
      return trimmed;
    }
    trimmed = next;
  }
}

function parseTelegramTarget(value) {
  const normalized = stripTelegramInternalPrefixes(value);
  const topicMatch = /^(.+?):topic:(\d+)$/i.exec(normalized);
  if (topicMatch) {
    return { chatId: topicMatch[1], threadId: topicMatch[2] };
  }
  const colonMatch = /^(.+):(\d+)$/i.exec(normalized);
  if (colonMatch) {
    return { chatId: colonMatch[1], threadId: colonMatch[2] };
  }
  return { chatId: normalized };
}

function buildTelegramTopicConversationId(chatId, topicId) {
  const normalizedChatId = String(chatId || "").trim();
  const normalizedTopicId = String(topicId || "").trim();
  if (!/^-?\d+$/.test(normalizedChatId) || !/^\d+$/.test(normalizedTopicId)) {
    return null;
  }
  return `${normalizedChatId}:topic:${normalizedTopicId}`;
}

function normalizeTelegramConversationId(value, threadId) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = parseTelegramTarget(raw);
  const chatId = normalizeOptionalString(parsed.chatId);
  if (!chatId) {
    return raw;
  }
  const resolvedThread = normalizeOptionalString(parsed.threadId) ?? normalizeOptionalString(threadId);
  if (resolvedThread) {
    return buildTelegramTopicConversationId(chatId, resolvedThread) || chatId;
  }
  return chatId;
}

function normalizeBluebubblesArchiveId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/^bluebubbles:/i, "").trim();
}

function resolveArchiveConversationId(channelId, conversationId, metadata) {
  const channel = String(channelId || "").toLowerCase();
  if (channel === "telegram") {
    return normalizeTelegramConversationId(
      metadata?.to || metadata?.conversationId || conversationId || "",
      metadata?.threadId,
    );
  }
  if (channel === "bluebubbles" || channel === "imessage") {
    return normalizeBluebubblesArchiveId(
      conversationId || metadata?.conversationId || metadata?.to || metadata?.groupId || "",
    );
  }
  return (
    stripChannelPrefix(
      conversationId || metadata?.conversationId || metadata?.to || metadata?.groupId || "",
      channel,
    ) || ""
  );
}

function parseThreadSessionSuffix(sessionKey) {
  const raw = normalizeOptionalString(sessionKey);
  if (!raw) {
    return { baseSessionKey: undefined, threadId: undefined };
  }
  const lowerRaw = raw.toLowerCase();
  const threadMarker = ':thread:';
  const threadIndex = lowerRaw.lastIndexOf(threadMarker);
  const baseSessionKey = threadIndex === -1 ? raw : raw.slice(0, threadIndex);
  const threadIdRaw = threadIndex === -1 ? undefined : raw.slice(threadIndex + threadMarker.length);
  return {
    baseSessionKey,
    threadId: normalizeOptionalString(threadIdRaw),
  };
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

function normalizePathForLookup(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("file://")) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function isLikelyPlaceholderText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }
  if (normalized === "[User sent media without caption]") {
    return true;
  }
  if (/^<media:[^>]+>(?:\s*\(\d+ images?\))?$/i.test(normalized)) {
    return true;
  }
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return true;
  }
  return lines.every((line) => MEDIA_PLACEHOLDER_LINE_RE.test(line));
}

function buildMediaFallbackText({ mediaType, mediaPath, role }) {
  const normalizedType = String(mediaType || "").trim().toLowerCase();
  const normalizedPath = normalizePathForLookup(mediaPath);
  const fileHint = normalizedPath ? path.basename(normalizedPath) : "";
  const roleLabel = role === "assistant" ? "Assistant" : "User";
  const kind = normalizedType.startsWith("image/")
    ? "image"
    : normalizedType.startsWith("audio/")
      ? "audio"
      : normalizedType.startsWith("video/")
        ? "video"
        : "media";
  const detail = [fileHint, normalizedType].filter(Boolean).join(" ");
  return detail ? `[${roleLabel} sent ${kind}: ${detail}]` : `[${roleLabel} sent ${kind}]`;
}

function dedupeTextBlocks(blocks) {
  const seen = new Set();
  const out = [];
  for (const block of blocks) {
    const normalized = normalizeText(block);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function pruneRecentArchiveWriteCache(nowMs = Date.now()) {
  for (const [key, expiresAt] of recentArchiveWriteCache.entries()) {
    if (expiresAt <= nowMs) {
      recentArchiveWriteCache.delete(key);
    }
  }
}

function buildArchiveLine(entry) {
  return `${JSON.stringify(entry)}\n`;
}

function buildArchiveWriteCacheKey(rawPath, line) {
  return `${rawPath}|${line}`;
}

async function archiveFileHasRecentDuplicate(rawPath, line) {
  try {
    const stat = await fs.stat(rawPath);
    if (!stat.isFile() || stat.size <= 0) {
      return false;
    }
    const bytesToRead = Math.min(stat.size, 64 * 1024);
    const handle = await fs.open(rawPath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, stat.size - bytesToRead);
      const recentLines = buffer
        .toString("utf8")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(-12);
      const normalizedLine = line.trim();
      return recentLines.includes(normalizedLine);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export async function buildSearchableText(params, deps = {}) {
  const preferredText = normalizeText(params?.preferredText);
  const fallbackText = normalizeText(params?.fallbackText);
  const transcript = normalizeText(params?.transcript);
  const mediaType = String(params?.mediaType || "").trim().toLowerCase();
  const mediaPath = normalizePathForLookup(params?.mediaPath);
  const role = params?.role === "assistant" ? "assistant" : "user";
  const blocks = [];

  if (preferredText && !isLikelyPlaceholderText(preferredText)) {
    blocks.push(preferredText);
  } else if (fallbackText && !isLikelyPlaceholderText(fallbackText)) {
    blocks.push(fallbackText);
  }

  if (transcript && !blocks.some((block) => block.includes(transcript))) {
    blocks.push(`[Transcript]\n${transcript}`);
  }

  const dedupedBlocks = dedupeTextBlocks(blocks);
  if (dedupedBlocks.length > 0) {
    return dedupedBlocks.join("\n\n");
  }

  return buildMediaFallbackText({ mediaType, mediaPath, role });
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function resolvePluginConfig(api) {
  return api.pluginConfig ?? api.entryConfig ?? api.options ?? {};
}

export function resolveWorkspaceMap(config) {
  const out = new Map();
  const list = config?.agents?.list || [];
  for (const agent of list) {
    if (agent?.id && agent?.workspace) {
      out.set(String(agent.id), String(agent.workspace));
    }
  }
  const defaultWorkspace = config?.agents?.defaults?.workspace;
  if (defaultWorkspace && !out.has("main")) {
    out.set("main", String(defaultWorkspace));
  }
  return out;
}

function extractTelegramGroupId(...values) {
  for (const value of values) {
    const raw = String(value || "");
    const match = raw.match(/-100\d+/);
    if (match) {
      return match[0];
    }
  }
  return null;
}

export function isBluebubblesGroupLike(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return false;
  }
  if (raw.startsWith("group:")) {
    return true;
  }
  return BLUEBUBBLES_GROUP_GUID_RE.test(raw) || BLUEBUBBLES_CHAT_IDENTIFIER_RE.test(raw);
}

export function buildBindingCandidates(channelId, conversationId, metadata) {
  const candidates = new Set();
  const channel = String(channelId || "").toLowerCase();
  const push = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return;
    }
    candidates.add(raw);
    const normalized = resolveArchiveConversationId(channelId, raw, metadata);
    if (normalized) {
      candidates.add(normalized);
    }
    if (channel === "telegram") {
      const stripped = stripChannelPrefix(raw, channel);
      if (stripped) {
        candidates.add(stripped);
      }
    }
    const tgGroupId = extractTelegramGroupId(raw);
    if (tgGroupId) {
      candidates.add(tgGroupId);
    }
  };
  push(conversationId);
  push(metadata?.to);
  push(metadata?.groupId);
  push(metadata?.conversationId);
  push(metadata?.senderId);
  push(metadata?.threadId);
  const normalizedConversation = resolveArchiveConversationId(channelId, conversationId, metadata);
  if (normalizedConversation) {
    candidates.add(normalizedConversation);
  }
  if (channel === "telegram") {
    push(extractTelegramGroupId(conversationId, metadata?.to, metadata?.groupId));
  }
  return candidates;
}

export function resolveBoundWorkspace(config, workspaceMap, channelId, conversationId, metadata) {
  const candidates = buildBindingCandidates(channelId, conversationId, metadata);
  if (candidates.size === 0) {
    return null;
  }
  const bindings = config?.bindings || [];
  for (const binding of bindings) {
    if (String(binding?.match?.channel || "").toLowerCase() !== String(channelId || "").toLowerCase()) {
      continue;
    }
    const peer = binding?.match?.peer || {};
    const peerId = String(peer.id || "").trim();
    if (!peerId) {
      continue;
    }
    if (candidates.has(peerId)) {
      const workspace = workspaceMap.get(String(binding.agentId));
      if (workspace) {
        return { workspace, agentId: String(binding.agentId), peerId };
      }
    }
  }
  return null;
}

export function deriveChatType(channelId, conversationId, metadata, speakerName = "") {
  const channel = String(channelId || "").toLowerCase();
  const conv = String(conversationId || "");
  const to = String(metadata?.to || "");
  if (metadata?.isGroup === true) {
    return "group";
  }
  if (metadata?.guildId || metadata?.channelName) {
    return "channel";
  }
  if (channel === "telegram") {
    if (conv.includes(":channel:") || to.includes(":channel:")) {
      return "channel";
    }
    if (/-100\d+/.test(conv) || /-100\d+/.test(to) || conv.includes(":group:") || to.includes(":group:")) {
      return "group";
    }
    return "direct";
  }
  if (channel === "discord" || channel === "slack") {
    return metadata?.guildId || metadata?.channelName ? "channel" : "direct";
  }
  if (channel === "line") {
    if (metadata?.groupId || metadata?.roomId) {
      return "group";
    }
  }
  if (channel === "bluebubbles" || channel === "imessage") {
    if (
      metadata?.groupId ||
      metadata?.roomId ||
      isBluebubblesGroupLike(conv) ||
      isBluebubblesGroupLike(to) ||
      isBluebubblesGroupLike(metadata?.conversationId) ||
      isBluebubblesGroupLike(metadata?.peerId) ||
      isBluebubblesGroupLike(speakerName)
    ) {
      return "group";
    }
  }
  return "direct";
}

export function deriveConversationLabel(channelId, conversationId, metadata, fallback) {
  if (metadata?.channelName) {
    return String(metadata.channelName);
  }
  if (metadata?.guildId) {
    return `${metadata.guildId}:${metadata.channelName || "channel"}`;
  }
  const normalizedConversation = resolveArchiveConversationId(channelId, conversationId, metadata);
  if (normalizedConversation) {
    return normalizedConversation;
  }
  if (conversationId) {
    return String(conversationId);
  }
  return String(fallback || channelId || "conversation");
}

export function derivePeerId(chatType, channelId, conversationId, metadata, fallback) {
  if (chatType === "group" || chatType === "channel") {
    const raw = String(conversationId || metadata?.to || metadata?.groupId || "");
    const match = raw.match(/-100\d+/);
    if (match) {
      return match[0];
    }
  }
  const normalizedChannelId = String(channelId || metadata?.channelId || metadata?.channel || "");
  const normalizedConversation = resolveArchiveConversationId(
    normalizedChannelId,
    conversationId,
    metadata,
  );
  if (normalizedConversation) {
    return normalizedConversation;
  }
  return String(
    conversationId ||
      metadata?.groupId ||
      metadata?.roomId ||
      fallback ||
      metadata?.senderId ||
      metadata?.to ||
      "unknown",
  );
}

export function resolveWorkspaceForEvent(config, workspaceMap, channelId, conversationId, metadata) {
  const boundWorkspace = resolveBoundWorkspace(
    config,
    workspaceMap,
    channelId,
    conversationId,
    metadata,
  );
  if (boundWorkspace) {
    return boundWorkspace;
  }
  const mainWorkspace = workspaceMap.get("main");
  return {
    workspace: mainWorkspace || String(config?.agents?.defaults?.workspace || "."),
    agentId: "main",
    peerId: null,
  };
}

export function resolveWorkspaceDir(workspaceDir) {
  const raw = String(workspaceDir || "").trim();
  if (!raw || raw === ".") {
    return path.join(DEFAULT_STATE_DIR, "workspace");
  }
  return path.isAbsolute(raw) ? raw : path.join(DEFAULT_STATE_DIR, raw);
}

export function resolveArchiveRoot(workspaceDir, pluginConfig = {}) {
  const configuredRoot = String(pluginConfig.archiveRoot || DEFAULT_ARCHIVE_ROOT).trim();
  const workspaceRoot = resolveWorkspaceDir(workspaceDir);
  const archiveRoot = configuredRoot || DEFAULT_ARCHIVE_ROOT;
  return path.isAbsolute(archiveRoot) ? archiveRoot : path.join(workspaceRoot, archiveRoot);
}

export function resolveEventArchiveRoot(workspaceDir, pluginConfig = {}) {
  const configuredRoot = String(pluginConfig.eventArchiveRoot || DEFAULT_EVENT_ARCHIVE_ROOT).trim();
  const workspaceRoot = resolveWorkspaceDir(workspaceDir);
  const archiveRoot = configuredRoot || DEFAULT_EVENT_ARCHIVE_ROOT;
  return path.isAbsolute(archiveRoot) ? archiveRoot : path.join(workspaceRoot, archiveRoot);
}

export async function* iterArchiveEntries(archiveRoot) {
  let channelDirs = [];
  try {
    channelDirs = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const channelDir of channelDirs) {
    if (!channelDir.isDirectory()) {
      continue;
    }
    const channelPath = path.join(archiveRoot, channelDir.name);
    let chatTypeDirs = [];
    try {
      chatTypeDirs = await fs.readdir(channelPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const chatTypeDir of chatTypeDirs) {
      if (!chatTypeDir.isDirectory()) {
        continue;
      }
      const chatTypePath = path.join(channelPath, chatTypeDir.name);
      let conversationDirs = [];
      try {
        conversationDirs = await fs.readdir(chatTypePath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const conversationDir of conversationDirs) {
        if (!conversationDir.isDirectory()) {
          continue;
        }
        const conversationPath = path.join(chatTypePath, conversationDir.name);
        let archiveFiles = [];
        try {
          archiveFiles = await fs.readdir(conversationPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const archiveFile of archiveFiles) {
          if (!archiveFile.isFile() || !archiveFile.name.endsWith(".jsonl")) {
            continue;
          }
          const filePath = path.join(conversationPath, archiveFile.name);
          let content = "";
          try {
            content = await fs.readFile(filePath, "utf8");
          } catch {
            continue;
          }
          for (const rawLine of content.split("\n")) {
            const line = rawLine.trim();
            if (!line) {
              continue;
            }
            try {
              const entry = JSON.parse(line);
              entry._path = filePath;
              yield entry;
            } catch {
              continue;
            }
          }
        }
      }
    }
  }
}

export async function listArchiveFiles(archiveRoot) {
  const out = [];
  let channelDirs = [];
  try {
    channelDirs = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const channelDir of channelDirs) {
    if (!channelDir.isDirectory()) {
      continue;
    }
    const channelPath = path.join(archiveRoot, channelDir.name);
    let chatTypeDirs = [];
    try {
      chatTypeDirs = await fs.readdir(channelPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const chatTypeDir of chatTypeDirs) {
      if (!chatTypeDir.isDirectory()) {
        continue;
      }
      const chatTypePath = path.join(channelPath, chatTypeDir.name);
      let conversationDirs = [];
      try {
        conversationDirs = await fs.readdir(chatTypePath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const conversationDir of conversationDirs) {
        if (!conversationDir.isDirectory()) {
          continue;
        }
        const conversationPath = path.join(chatTypePath, conversationDir.name);
        let archiveFiles = [];
        try {
          archiveFiles = await fs.readdir(conversationPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const archiveFile of archiveFiles) {
          if (archiveFile.isFile() && archiveFile.name.endsWith(".jsonl")) {
            out.push(path.join(conversationPath, archiveFile.name));
          }
        }
      }
    }
  }

  return out;
}

export function matchesArchiveEntry(entry, params) {
  if (params.role && entry.role !== params.role) {
    return false;
  }
  if (params.channel && String(entry.channel || "").toLowerCase() !== params.channel.toLowerCase()) {
    return false;
  }
  if (params.chat_type && entry.chat_type !== params.chat_type) {
    return false;
  }

  const localDate = entry.local_date || "";
  if (params.date && localDate !== params.date) {
    return false;
  }
  if (params.from_date && localDate < params.from_date) {
    return false;
  }
  if (params.to_date && localDate > params.to_date) {
    return false;
  }

  if (params.sender) {
    const speaker = String(entry.speaker_name || "").toLowerCase();
    if (!speaker.includes(params.sender.toLowerCase())) {
      return false;
    }
  }

  if (params.peer) {
    const peerText = [
      entry.peer_id,
      entry.conversation_label,
      entry.conversation_slug,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!peerText.includes(params.peer.toLowerCase())) {
      return false;
    }
  }

  if (params.query) {
    const text = String(entry.text || "").toLowerCase();
    if (!text.includes(params.query.toLowerCase())) {
      return false;
    }
  }

  return true;
}

export function dedupeArchiveResults(results) {
  const seen = new Map();
  const deduped = [];
  for (const entry of results) {
    const stableId = buildArchiveStableId(entry);
    const key = [entry.channel, entry.chat_type, entry.peer_id, entry.role, stableId].join("|");
    const existingIndex = seen.get(key);
    if (existingIndex == null) {
      seen.set(key, deduped.length);
      deduped.push(entry);
      continue;
    }
    const existing = deduped[existingIndex];
    const existingScore = scoreArchiveEntry(existing);
    const nextScore = scoreArchiveEntry(entry);
    if (nextScore >= existingScore) {
      deduped[existingIndex] = entry;
    }
  }
  return deduped;
}

export function sortArchiveResults(results) {
  return results.toSorted((a, b) => {
    const keyA = `${a.timestamp_utc || a.timestamp_local || ""}|${a.session_id || ""}|${a.event_id || ""}`;
    const keyB = `${b.timestamp_utc || b.timestamp_local || ""}|${b.session_id || ""}|${b.event_id || ""}`;
    return keyA.localeCompare(keyB);
  });
}

export async function searchArchive(archiveRoot, params = {}) {
  const results = [];
  for await (const entry of iterArchiveEntries(archiveRoot)) {
    if (matchesArchiveEntry(entry, params)) {
      results.push(entry);
    }
  }
  const sorted = sortArchiveResults(results);
  const deduped = dedupeArchiveResults(sorted);
  const limit = Math.max(1, Math.min(Number(params.limit) || 8, 100));
  return deduped.slice(-limit);
}

export async function inspectArchiveHealth(archiveRoot, params = {}) {
  const hours = Math.max(1, Number(params.hours) || 24);
  let archiveExists = false;
  try {
    const stat = await fs.stat(archiveRoot);
    archiveExists = stat.isDirectory();
  } catch {
    archiveExists = false;
  }

  if (!archiveExists) {
    return {
      status: "error",
      archiveRoot,
      hours,
      reason: "missing_archive_root",
    };
  }

  const files = await listArchiveFiles(archiveRoot);
  if (files.length === 0) {
    return {
      status: "error",
      archiveRoot,
      hours,
      reason: "no_archive_files",
      fileCount: 0,
    };
  }

  let latestFile = null;
  let latestMtimeMs = -1;
  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > latestMtimeMs) {
        latestMtimeMs = stat.mtimeMs;
        latestFile = filePath;
      }
    } catch {
      continue;
    }
  }

  if (!latestFile || latestMtimeMs < 0) {
    return {
      status: "error",
      archiveRoot,
      hours,
      reason: "no_readable_archive_files",
      fileCount: files.length,
    };
  }

  let sample = null;
  let sampleError = null;
  try {
    const content = await fs.readFile(latestFile, "utf8");
    let lastNonEmpty = "";
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (line) {
        lastNonEmpty = line;
      }
    }
    if (!lastNonEmpty) {
      sampleError = "latest archive file is empty";
    } else {
      sample = JSON.parse(lastNonEmpty);
    }
  } catch (error) {
    sampleError = error instanceof Error ? error.message : String(error);
  }

  const missingFields = sample
    ? REQUIRED_ARCHIVE_FIELDS.filter((field) => !(field in sample))
    : [];
  const ageSeconds = Math.floor((Date.now() - latestMtimeMs) / 1000);
  const warnings = [];

  if (ageSeconds > hours * 3600) {
    warnings.push(`freshness-exceeded:${hours}h`);
  }
  if (missingFields.length > 0) {
    warnings.push(`missing-fields:${missingFields.join(",")}`);
  }
  if (sampleError) {
    warnings.push(`sample-error:${sampleError}`);
  }

  return {
    status: warnings.length > 0 ? "warn" : "ok",
    archiveRoot,
    hours,
    fileCount: files.length,
    latestFile,
    ageSeconds,
    sampleError,
    missingFields,
    warnings,
  };
}

export function createConversationArchiveTools(api, ctx) {
  if (!ctx.workspaceDir) {
    return null;
  }

  const pluginConfig = resolvePluginConfig(api);
  return [
    {
      name: "conversation_archive_search",
      label: "Conversation Archive Search",
      description:
        "Search workspace-local raw chat history when exact wording, chronology, speaker attribution, or missing historical context matters.",
      parameters: SEARCH_TOOL_SCHEMA,
      execute: async (_toolCallId, rawParams) => {
        try {
          const archiveRoot = resolveArchiveRoot(ctx.workspaceDir, pluginConfig);
          const results = await searchArchive(archiveRoot, rawParams || {});
          return jsonResult({
            archiveRoot,
            mode: pluginConfig.mode || "standard",
            count: results.length,
            results,
          });
        } catch (error) {
          return jsonResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    {
      name: "conversation_archive_health",
      label: "Conversation Archive Health",
      description:
        "Inspect archive freshness and record shape for the current workspace conversation archive.",
      parameters: HEALTH_TOOL_SCHEMA,
      execute: async (_toolCallId, rawParams) => {
        try {
          const archiveRoot = resolveArchiveRoot(ctx.workspaceDir, pluginConfig);
          const health = await inspectArchiveHealth(archiveRoot, rawParams || {});
          return jsonResult({
            ...health,
            mode: pluginConfig.mode || "standard",
            note:
              (pluginConfig.mode || "standard") === "standard"
                ? "Standard mode coverage depends on official plugin hook visibility."
                : "Full-fidelity mode assumes extra channel patch coverage is installed.",
          });
        } catch (error) {
          return jsonResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  ];
}

function isInternalHooksEnabled(config) {
  return config?.hooks?.internal?.enabled === true;
}

function sourcePriority(entry) {
  const source = String(entry?.source || "");
  const role = String(entry?.role || "");
  if (role === "user") {
    if (source === "mention-skip") {
      return 40;
    }
    if (source === "message-preprocessed") {
      return 30;
    }
    if (source === "message-hook") {
      return 20;
    }
    if (source === "import") {
      return 10;
    }
    return 0;
  }
  if (role === "assistant") {
    if (source === "message-sent-internal") {
      return 30;
    }
    if (source === "message-hook") {
      return 20;
    }
    if (source === "import") {
      return 10;
    }
  }
  return 0;
}

function buildArchiveFallbackStableId(entry) {
  return [
    `peer:${entry.peer_id || entry.conversation_slug || entry.conversation_label || ""}`,
    `role:${entry.role || ""}`,
    `speaker:${entry.speaker_id || entry.speaker_name || ""}`,
    `date:${entry.local_date || ""}`,
    `time:${entry.local_time || ""}`,
    `text:${entry.text || ""}`,
  ].join("|");
}

export function buildArchiveStableId(entry) {
  if (entry?.role === "user" && entry?.source_message_id) {
    return `smid:${entry.source_message_id}`;
  }
  if (entry?.message_id) {
    return `mid:${entry.message_id}`;
  }
  return `fallback:${buildArchiveFallbackStableId(entry)}`;
}

export function scoreArchiveEntry(entry) {
  const hasMeaningfulText = isLikelyPlaceholderText(entry?.text) ? 0 : 10;
  return hasMeaningfulText + sourcePriority(entry);
}

async function appendArchive(entry, workspaceDir, archiveRootResolver, pluginConfig) {
  const localDate = entry.local_date;
  const conversationParts = [
    entry.channel,
    entry.chat_type,
    entry.conversation_slug,
  ];
  let archiveRoot = archiveRootResolver(workspaceDir, pluginConfig);
  if (!path.isAbsolute(archiveRoot)) {
    archiveRoot = archiveRootResolver(entry.workspace || workspaceDir, pluginConfig);
  }
  if (!path.isAbsolute(archiveRoot)) {
    archiveRoot = archiveRootResolver(entry.workspace || workspaceDir, pluginConfig);
  }
  const baseDirRaw = path.join(archiveRoot, ...conversationParts);
  await fs.mkdir(baseDirRaw, { recursive: true });

  const rawPath = path.join(baseDirRaw, `${localDate}.jsonl`);
  const line = buildArchiveLine(entry);
  const cacheKey = buildArchiveWriteCacheKey(rawPath, line);
  const nowMs = Date.now();
  pruneRecentArchiveWriteCache(nowMs);
  if (recentArchiveWriteCache.has(cacheKey)) {
    return;
  }
  if (await archiveFileHasRecentDuplicate(rawPath, line)) {
    recentArchiveWriteCache.set(cacheKey, nowMs + RECENT_ARCHIVE_WRITE_TTL_MS);
    return;
  }
  await fs.appendFile(rawPath, line, "utf8");
  recentArchiveWriteCache.set(cacheKey, nowMs + RECENT_ARCHIVE_WRITE_TTL_MS);
}

async function appendMessageArchive(entry, workspaceDir, pluginConfig) {
  return appendArchive(entry, workspaceDir, resolveArchiveRoot, pluginConfig);
}

async function appendEventArchive(entry, workspaceDir, pluginConfig) {
  return appendArchive(entry, workspaceDir, resolveEventArchiveRoot, pluginConfig);
}

export function buildBaseEntry({
  channelId,
  conversationId,
  metadata,
  source = "message-hook",
  role,
  speakerName,
  speakerId,
  messageId,
  text,
  workspaceDir,
  agentId,
  timestampMs,
}) {
  const effectiveTimestampMs = normalizeTimestampMs(timestampMs) ?? Date.now();
  const now = new Date(effectiveTimestampMs);
  const localDate = formatLocalDate(now);
  const localTime = formatLocalTime(now);
  const chatType = deriveChatType(channelId, conversationId, metadata, speakerName);
  const peerId = derivePeerId(chatType, channelId, conversationId, metadata, speakerId);
  const conversationLabel = deriveConversationLabel(channelId, conversationId, metadata, peerId);
  return {
    source,
    timestamp_utc: now.toISOString(),
    timestamp_local: formatLocalTimestamp(now),
    local_date: localDate,
    local_time: localTime,
    workspace: workspaceDir,
    agent_id: agentId,
    channel: String(channelId || "unknown").toLowerCase(),
    chat_type: chatType,
    peer_id: peerId,
    conversation_label: conversationLabel,
    conversation_slug: sanitizeSlug(peerId || conversationLabel),
    message_id: messageId || null,
    source_message_id: metadata?.sourceMessageId || null,
    role,
    speaker_name: speakerName || (role === "assistant" ? ASSISTANT_NAME : "User"),
    speaker_id: speakerId || null,
    text: normalizeText(text),
  };
}

function extractAgentIdFromSessionKey(sessionKey) {
  const raw = String(sessionKey || "").trim();
  const match = raw.match(/^agent:([^:]+):/);
  return match ? match[1] : null;
}

function resolveWorkspaceForInternalEvent(
  config,
  workspaceMap,
  sessionKey,
  channelId,
  conversationId,
  metadata,
) {
  const agentId = extractAgentIdFromSessionKey(sessionKey);
  if (agentId) {
    const workspace = workspaceMap.get(agentId);
    if (workspace) {
      return { workspace, agentId, peerId: metadata?.groupId ?? null };
    }
  }
  return resolveWorkspaceForEvent(config, workspaceMap, channelId, conversationId, metadata);
}

export default function register(api) {
  const workspaceMap = resolveWorkspaceMap(api.config);
  const pluginConfig = resolvePluginConfig(api);
  const warnOnUnsupportedChannels = pluginConfig.warnOnUnsupportedChannels !== false;
  const routeGatewayHooksToEventLog = isInternalHooksEnabled(api.config);

  api.registerTool((ctx) => createConversationArchiveTools(api, ctx), {
    names: ["conversation_archive_search", "conversation_archive_health"],
  });

  const warnUnsupportedChannel = (channelId) => {
    const normalized = String(channelId || "").toLowerCase();
    if (!warnOnUnsupportedChannels || !normalized || warnedUnsupportedChannels.has(normalized)) {
      return;
    }
    warnedUnsupportedChannels.add(normalized);
    api.logger.warn(
      `[conversation-archive] skipping unsupported channel '${normalized}' (not yet mapped into message-archive-raw)`,
    );
  };

  api.on(
    "message_received",
    async (event, ctx) => {
      const channelId = String(ctx?.channelId || "").toLowerCase();
      if (!SUPPORTED_CHANNELS.has(channelId)) {
        warnUnsupportedChannel(channelId);
        return;
      }
      const workspaceInfo = resolveWorkspaceForEvent(
        api.config,
        workspaceMap,
        channelId,
        ctx?.conversationId,
        event?.metadata || {},
      );
      const entry = buildBaseEntry({
        channelId,
        conversationId: ctx?.conversationId,
        metadata: event?.metadata || {},
        source: "message-hook",
        role: "user",
        speakerName: event?.metadata?.senderName || event?.from,
        speakerId: event?.metadata?.senderId || event?.from,
        messageId: event?.metadata?.messageId,
        text: await buildSearchableText({
          preferredText: event?.content || "",
          role: "user",
        }),
        workspaceDir: workspaceInfo.workspace,
        agentId: workspaceInfo.agentId,
        timestampMs: event?.timestamp,
      });
      const append = routeGatewayHooksToEventLog ? appendEventArchive : appendMessageArchive;
      await append(entry, workspaceInfo.workspace, pluginConfig);
    },
    { priority: 0 },
  );

  api.on(
    "message_sent",
    async (event, ctx) => {
      const channelId = String(ctx?.channelId || "").toLowerCase();
      if (!SUPPORTED_CHANNELS.has(channelId)) {
        warnUnsupportedChannel(channelId);
        return;
      }
      if (event?.success !== true) {
        return;
      }
      const workspaceInfo = resolveWorkspaceForEvent(
        api.config,
        workspaceMap,
        channelId,
        ctx?.conversationId || event?.to,
        { to: event?.to, conversationId: ctx?.conversationId },
      );
      const entry = buildBaseEntry({
        channelId,
        conversationId: ctx?.conversationId || event?.to,
        metadata: {
          to: event?.to,
          conversationId: ctx?.conversationId,
        },
        source: "message-hook",
        role: "assistant",
        speakerName: ASSISTANT_NAME,
        speakerId: null,
        messageId: ctx?.messageId,
        text: await buildSearchableText({
          preferredText: event?.content || "",
          role: "assistant",
        }),
        workspaceDir: workspaceInfo.workspace,
        agentId: workspaceInfo.agentId,
        timestampMs: Date.now(),
      });
      const append = routeGatewayHooksToEventLog ? appendEventArchive : appendMessageArchive;
      await append(entry, workspaceInfo.workspace, pluginConfig);
    },
    { priority: 0 },
  );

  api.registerHook(
    "message:preprocessed",
    async (event) => {
      const context = event?.context || {};
      const channelId = String(context.channelId || "").toLowerCase();
      if (!SUPPORTED_CHANNELS.has(channelId)) {
        warnUnsupportedChannel(channelId);
        return;
      }
      const sessionThreadIn = parseThreadSessionSuffix(event?.sessionKey);
      const inboundMetadata = {
        to: context.to,
        groupId: context.groupId,
        isGroup: context.isGroup,
        threadId: context.threadId ?? sessionThreadIn.threadId,
        conversationId: context.conversationId,
      };
      const workspaceInfo = resolveWorkspaceForInternalEvent(
        api.config,
        workspaceMap,
        event?.sessionKey,
        channelId,
        context.conversationId,
        inboundMetadata,
      );
      const entry = buildBaseEntry({
        channelId,
        conversationId: context.conversationId,
        metadata: inboundMetadata,
        source: "message-preprocessed",
        role: "user",
        speakerName: context.senderName || context.senderId || context.from,
        speakerId: context.senderId || context.from,
        messageId: context.messageId,
        text: await buildSearchableText({
          preferredText: context.bodyForAgent ?? context.body ?? "",
          fallbackText: context.body ?? "",
          transcript: context.transcript,
          mediaPath: context.mediaPath,
          mediaType: context.mediaType,
          role: "user",
        }),
        workspaceDir: workspaceInfo.workspace,
        agentId: workspaceInfo.agentId,
        timestampMs: event?.timestamp?.getTime?.() ?? Date.now(),
      });
      await appendMessageArchive(entry, workspaceInfo.workspace, pluginConfig);
    },
    {
      name: "conversation-archive-preprocessed",
      description: "Mirror preprocessed inbound message context into raw archive entries.",
    },
  );

  api.registerHook(
    "message:sent",
    async (event) => {
      const context = event?.context || {};
      const channelId = String(context.channelId || "").toLowerCase();
      if (!SUPPORTED_CHANNELS.has(channelId)) {
        warnUnsupportedChannel(channelId);
        return;
      }
      if (context.success !== true) {
        return;
      }
      const sessionThreadOut = parseThreadSessionSuffix(event?.sessionKey);
      const outboundMetadata = {
        to: context.to,
        groupId: context.groupId,
        isGroup: context.isGroup,
        threadId: sessionThreadOut.threadId,
        conversationId: context.conversationId,
      };
      const workspaceInfo = resolveWorkspaceForInternalEvent(
        api.config,
        workspaceMap,
        event?.sessionKey,
        channelId,
        context.conversationId || context.to,
        outboundMetadata,
      );
      const entry = buildBaseEntry({
        channelId,
        conversationId: context.conversationId || context.to,
        metadata: outboundMetadata,
        source: "message-sent-internal",
        role: "assistant",
        speakerName: ASSISTANT_NAME,
        speakerId: null,
        messageId: context.messageId,
        text: await buildSearchableText({
          preferredText: context.content || "",
          role: "assistant",
        }),
        workspaceDir: workspaceInfo.workspace,
        agentId: workspaceInfo.agentId,
        timestampMs: event?.timestamp?.getTime?.() ?? Date.now(),
      });
      await appendMessageArchive(entry, workspaceInfo.workspace, pluginConfig);
    },
    {
      name: "conversation-archive-sent",
      description: "Mirror internal sent-message context into raw archive entries.",
    },
  );
}
