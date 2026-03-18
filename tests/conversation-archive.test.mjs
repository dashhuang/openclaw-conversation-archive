import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.join(__dirname, "..", "index.js");
const pluginSource = await readFile(pluginPath, "utf8");
const pluginModule = await import(
  `data:text/javascript;base64,${Buffer.from(pluginSource, "utf8").toString("base64")}`
);
const {
  buildBaseEntry,
  createConversationArchiveTools,
  formatLocalTimestamp,
  inspectArchiveHealth,
  isBluebubblesGroupLike,
  normalizeTimestampMs,
  resolveArchiveRoot,
  searchArchive,
  resolveWorkspaceForEvent,
  resolveWorkspaceMap,
} = pluginModule;

test("resolveWorkspaceForEvent maps non-Telegram bindings to the bound workspace", () => {
  const config = {
    agents: {
      defaults: { workspace: "workspace" },
      list: [
        { id: "main", workspace: "workspace" },
        { id: "food-group", workspace: "workspace-food-group" },
      ],
    },
    bindings: [
      {
        agentId: "food-group",
        match: {
          channel: "feishu",
          peer: { id: "ou_user_123" },
        },
      },
    ],
  };

  const workspaceMap = resolveWorkspaceMap(config);
  const workspaceInfo = resolveWorkspaceForEvent(
    config,
    workspaceMap,
    "feishu",
    "feishu:direct:ignored",
    { senderId: "ou_user_123" },
  );

  assert.equal(workspaceInfo.workspace, "workspace-food-group");
  assert.equal(workspaceInfo.agentId, "food-group");
});

test("buildBaseEntry prefers provider timestamps and emits a real local timestamp with offset", () => {
  const providerTimestampSeconds = 1700000000;
  const entry = buildBaseEntry({
    channelId: "telegram",
    conversationId: "telegram:direct:sample-user",
    metadata: { senderId: "sample-user" },
    role: "user",
    speakerName: "Dash",
    speakerId: "sample-user",
    messageId: "2045",
    text: "raw test 1",
    workspaceDir: "workspace",
    agentId: "main",
    timestampMs: providerTimestampSeconds,
  });

  assert.equal(normalizeTimestampMs(providerTimestampSeconds), providerTimestampSeconds * 1000);
  assert.equal(entry.timestamp_utc, new Date(providerTimestampSeconds * 1000).toISOString());
  assert.match(entry.timestamp_local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(entry.local_date, entry.timestamp_local.slice(0, 10));
  assert.equal(entry.local_time, entry.timestamp_local.slice(11, 19));
});

test("BlueBubbles shared chat GUIDs are classified as group chats", () => {
  assert.equal(isBluebubblesGroupLike("group:any;+;af3277e8de854e0bbee77be71a4e0765"), true);
  assert.equal(isBluebubblesGroupLike("bluebubbles:chat_guid:any;+;af3277e8de854e0bbee77be71a4e0765"), true);

  const entry = buildBaseEntry({
    channelId: "bluebubbles",
    conversationId: "bluebubbles:chat_guid:any;+;af3277e8de854e0bbee77be71a4e0765",
    metadata: { senderId: "sample-contact@example.com" },
    role: "user",
    speakerName: "group:any;+;af3277e8de854e0bbee77be71a4e0765",
    speakerId: "sample-contact@example.com",
    messageId: "AE8B393C-EDB7-43CF-B82B-0A5FC7E3A24C",
    text: "AA会员号是什么",
    workspaceDir: "workspace-wife",
    agentId: "wife",
    timestampMs: 1742241511585,
  });

  assert.equal(entry.chat_type, "group");
  assert.equal(entry.channel, "bluebubbles");
});

test("BlueBubbles direct chats remain direct", () => {
  const entry = buildBaseEntry({
    channelId: "bluebubbles",
    conversationId: "bluebubbles:sample-contact@example.com",
    metadata: { senderId: "sample-contact@example.com" },
    role: "user",
    speakerName: "Cherry",
    speakerId: "sample-contact@example.com",
    messageId: "m1",
    text: "hello",
    workspaceDir: "workspace-wife",
    agentId: "wife",
    timestampMs: 1742241511585,
  });

  assert.equal(entry.chat_type, "direct");
});

test("formatLocalTimestamp keeps date and time fields aligned", () => {
  const date = new Date("2026-03-14T01:43:00.000Z");
  const localTimestamp = formatLocalTimestamp(date);

  assert.match(localTimestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("resolveArchiveRoot honors plugin config overrides", () => {
  assert.equal(resolveArchiveRoot("workspace"), path.join("workspace", "logs", "message-archive-raw"));
  assert.equal(resolveArchiveRoot("workspace", { archiveRoot: "logs/custom-history" }), path.join("workspace", "logs", "custom-history"));
});

test("searchArchive returns matching raw archive entries", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-"));
  const archiveDir = path.join(
    tmpDir,
    "logs",
    "message-archive-raw",
    "telegram",
    "group",
    "100123",
  );
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    path.join(archiveDir, "2026-03-15.jsonl"),
    [
      JSON.stringify({
        timestamp_utc: "2026-03-15T00:00:01.000Z",
        timestamp_local: "2026-03-15T13:00:01+13:00",
        local_date: "2026-03-15",
        local_time: "13:00:01",
        channel: "telegram",
        chat_type: "group",
        peer_id: "100123",
        conversation_label: "group-a",
        conversation_slug: "100123",
        role: "user",
        speaker_name: "Dash",
        text: "hello archive world",
      }),
      JSON.stringify({
        timestamp_utc: "2026-03-15T00:00:02.000Z",
        timestamp_local: "2026-03-15T13:00:02+13:00",
        local_date: "2026-03-15",
        local_time: "13:00:02",
        channel: "telegram",
        chat_type: "group",
        peer_id: "100123",
        conversation_label: "group-a",
        conversation_slug: "100123",
        role: "assistant",
        speaker_name: "Assistant",
        text: "different message",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const results = await searchArchive(path.join(tmpDir, "logs", "message-archive-raw"), {
    query: "archive world",
    channel: "telegram",
    chat_type: "group",
    limit: 5,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].speaker_name, "Dash");
  assert.equal(results[0].text, "hello archive world");
});

test("createConversationArchiveTools exposes a search tool when workspaceDir exists", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-tool-"));
  const archiveDir = path.join(
    tmpDir,
    "logs",
    "message-archive-raw",
    "feishu",
    "direct",
    "ou_123",
  );
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    path.join(archiveDir, "2026-03-15.jsonl"),
    `${JSON.stringify({
      timestamp_utc: "2026-03-15T00:00:01.000Z",
      timestamp_local: "2026-03-15T13:00:01+13:00",
      local_date: "2026-03-15",
      local_time: "13:00:01",
      channel: "feishu",
      chat_type: "direct",
      peer_id: "ou_123",
      conversation_label: "ou_123",
      conversation_slug: "ou_123",
      role: "user",
      speaker_name: "Alice",
      text: "search me later",
    })}\n`,
    "utf8",
  );

  const api = {
    config: {},
    pluginConfig: {},
  };
  const tools = createConversationArchiveTools(api, {
    agentId: "main",
    workspaceDir: tmpDir,
  });

  assert.equal(Array.isArray(tools), true);
  assert.equal(tools.length, 2);
  assert.equal(tools.some((tool) => tool.name === "conversation_archive_search"), true);

  const searchTool = tools.find((tool) => tool.name === "conversation_archive_search");
  assert.ok(searchTool);

  const result = await searchTool.execute("tool-1", { query: "search me", limit: 5 });
  const details = result.details;
  assert.equal(details.count, 1);
  assert.equal(details.results[0].speaker_name, "Alice");
});

test("inspectArchiveHealth reports ok for a fresh archive with required fields", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-health-"));
  const archiveDir = path.join(
    tmpDir,
    "logs",
    "message-archive-raw",
    "telegram",
    "direct",
    "sample-user",
  );
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    path.join(archiveDir, "2026-03-15.jsonl"),
    `${JSON.stringify({
      timestamp_utc: new Date().toISOString(),
      timestamp_local: "2026-03-15T13:00:01+13:00",
      local_date: "2026-03-15",
      local_time: "13:00:01",
      channel: "telegram",
      chat_type: "direct",
      peer_id: "sample-user",
      conversation_label: "telegram:direct:sample-user",
      conversation_slug: "sample-user",
      role: "user",
      speaker_name: "Dash",
      text: "health ok",
    })}\n`,
    "utf8",
  );

  const health = await inspectArchiveHealth(path.join(tmpDir, "logs", "message-archive-raw"), {
    hours: 24,
  });

  assert.equal(health.status, "ok");
  assert.equal(health.fileCount, 1);
  assert.equal(Array.isArray(health.warnings), true);
  assert.equal(health.warnings.length, 0);
});

test("createConversationArchiveTools exposes a health tool when workspaceDir exists", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-health-tool-"));
  const archiveDir = path.join(
    tmpDir,
    "logs",
    "message-archive-raw",
    "telegram",
    "group",
    "100123",
  );
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    path.join(archiveDir, "2026-03-15.jsonl"),
    `${JSON.stringify({
      timestamp_utc: new Date().toISOString(),
      timestamp_local: "2026-03-15T13:00:01+13:00",
      local_date: "2026-03-15",
      local_time: "13:00:01",
      channel: "telegram",
      chat_type: "group",
      peer_id: "100123",
      conversation_label: "group-a",
      conversation_slug: "100123",
      role: "user",
      speaker_name: "Dash",
      text: "fresh health sample",
    })}\n`,
    "utf8",
  );

  const api = {
    config: {},
    pluginConfig: { mode: "standard" },
  };
  const tools = createConversationArchiveTools(api, {
    agentId: "main",
    workspaceDir: tmpDir,
  });

  const healthTool = tools.find((tool) => tool.name === "conversation_archive_health");
  assert.ok(healthTool);

  const result = await healthTool.execute("tool-2", { hours: 24 });
  assert.equal(result.details.status, "ok");
  assert.equal(result.details.mode, "standard");
  assert.equal(result.details.fileCount, 1);
});
