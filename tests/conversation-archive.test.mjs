import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.join(__dirname, "..", "index.js");
const pluginSource = await readFile(pluginPath, "utf8");
const pluginModule = await import(
  `data:text/javascript;base64,${Buffer.from(pluginSource, "utf8").toString("base64")}`
);
const {
  buildBaseEntry,
  buildSearchableText,
  createConversationArchiveTools,
  formatLocalTimestamp,
  inspectArchiveHealth,
  isBluebubblesGroupLike,
  normalizeTimestampMs,
  resolveArchiveRoot,
  resolveWorkspaceDir,
  searchArchive,
  resolveWorkspaceFromSessionKey,
  resolveWorkspaceMap,
} = pluginModule;

test("resolveWorkspaceFromSessionKey extracts agentId from sessionKey and returns workspace", () => {
  const config = {
    agents: {
      defaults: { workspace: "workspace" },
      list: [
        { id: "main", workspace: "workspace" },
        { id: "food-group", workspace: "workspace-food-group" },
      ],
    },
  };

  const workspaceMap = resolveWorkspaceMap(config);
  const result = resolveWorkspaceFromSessionKey(
    workspaceMap,
    "agent:food-group:feishu:direct:ou_user_123",
  );

  assert.equal(result.workspace, "workspace-food-group");
  assert.equal(result.agentId, "food-group");
});

test("resolveWorkspaceFromSessionKey returns null when sessionKey is missing", () => {
  const config = {
    agents: {
      defaults: { workspace: "workspace" },
      list: [{ id: "main", workspace: "workspace" }],
    },
  };

  const workspaceMap = resolveWorkspaceMap(config);

  assert.equal(resolveWorkspaceFromSessionKey(workspaceMap, null), null);
  assert.equal(resolveWorkspaceFromSessionKey(workspaceMap, ""), null);
  assert.equal(resolveWorkspaceFromSessionKey(workspaceMap, undefined), null);
});

test("resolveWorkspaceFromSessionKey returns null when agentId has no workspace", () => {
  const config = {
    agents: {
      defaults: { workspace: "workspace" },
      list: [{ id: "main", workspace: "workspace" }],
    },
  };

  const workspaceMap = resolveWorkspaceMap(config);
  const result = resolveWorkspaceFromSessionKey(
    workspaceMap,
    "agent:unknown-agent:feishu:direct:ou_user_123",
  );

  assert.equal(result, null);
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
  assert.equal(isBluebubblesGroupLike("chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("chat_guid:iMessage;+;chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("Family Chat id:iMessage;+;chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("+64210766404"), false);

  const entry = buildBaseEntry({
    channelId: "bluebubbles",
    conversationId: "chat240698944142298252",
    metadata: {},
    role: "assistant",
    speakerName: "Assistant",
    speakerId: null,
    messageId: "bb-out-1",
    text: "记住了，周日 13:20 去 AI CINEMA",
    workspaceDir: "workspace-wife",
    agentId: "wife",
    timestampMs: 1774742400000,
  });

  assert.equal(entry.chat_type, "group");
  assert.equal(entry.conversation_slug, "chat240698944142298252");
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

test("buildSearchableText falls back to a plain media placeholder for image-only messages", async () => {
  const text = await buildSearchableText({
    preferredText: "[User sent media without caption]",
    mediaType: "image/png",
    mediaPath: "/tmp/ticket.png",
    role: "user",
  });

  assert.equal(text, "[User sent image: ticket.png image/png]");
});

test("buildSearchableText keeps user caption for image messages", async () => {
  const text = await buildSearchableText({
    preferredText: "这是一张电影票",
    mediaType: "image/png",
    mediaPath: "/tmp/ticket.png",
    role: "user",
  });

  assert.equal(text, "这是一张电影票");
});

test("resolveArchiveRoot honors plugin config overrides", () => {
  assert.equal(resolveWorkspaceDir("."), path.join(process.env.HOME, ".openclaw", "workspace"));
  assert.equal(resolveWorkspaceDir("workspace-food-group"), path.join(process.env.HOME, ".openclaw", "workspace-food-group"));
  assert.equal(resolveArchiveRoot("workspace"), path.join(process.env.HOME, ".openclaw", "workspace", "logs", "message-archive-raw"));
  assert.equal(
    resolveArchiveRoot("workspace", { archiveRoot: "logs/custom-history" }),
    path.join(process.env.HOME, ".openclaw", "workspace", "logs", "custom-history"),
  );
  assert.equal(
    resolveArchiveRoot("/tmp/workspace", { archiveRoot: "/tmp/archive-root" }),
    "/tmp/archive-root",
  );
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

test("searchArchive prefers enriched entries when the same message id is archived twice", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-"));
  try {
    const archiveFile = path.join(
      tempDir,
      "telegram",
      "group",
      "telegram-100123",
      "2026-03-29.jsonl",
    );
    await mkdir(path.dirname(archiveFile), { recursive: true });
    await writeFile(
      archiveFile,
      [
        JSON.stringify({
          timestamp_utc: "2026-03-29T00:00:01.000Z",
          timestamp_local: "2026-03-29T08:00:01+08:00",
          local_date: "2026-03-29",
          local_time: "08:00:01",
          channel: "telegram",
          chat_type: "group",
          peer_id: "-100123",
          conversation_label: "telegram:group:-100123",
          conversation_slug: "telegram-100123",
          message_id: "m-1",
          role: "user",
          speaker_name: "Dash",
          source: "message-hook",
          text: "[User sent media without caption]",
        }),
        JSON.stringify({
          timestamp_utc: "2026-03-29T00:00:01.000Z",
          timestamp_local: "2026-03-29T08:00:01+08:00",
          local_date: "2026-03-29",
          local_time: "08:00:01",
          channel: "telegram",
          chat_type: "group",
          peer_id: "-100123",
          conversation_label: "telegram:group:-100123",
          conversation_slug: "telegram-100123",
          message_id: "m-1",
          role: "user",
          speaker_name: "Dash",
          source: "message-preprocessed",
          text: "[Image OCR]\nAI CINEMA\n3-29 13:20",
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const results = await searchArchive(tempDir, {
      query: "AI CINEMA",
      limit: 10,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].source, "message-preprocessed");
    assert.match(results[0].text, /AI CINEMA/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

test("resolveWorkspaceFromSessionKey routes different agents to different workspaces", () => {
  const config = {
    agents: {
      defaults: { workspace: "workspace" },
      list: [
        { id: "main", workspace: "workspace" },
        { id: "social", workspace: "workspace-social" },
        { id: "vip", workspace: "workspace-vip" },
      ],
    },
  };

  const workspaceMap = resolveWorkspaceMap(config);

  const socialResult = resolveWorkspaceFromSessionKey(
    workspaceMap,
    "agent:social:bluebubbles:direct:+8618621185125",
  );
  assert.equal(socialResult.workspace, "workspace-social");
  assert.equal(socialResult.agentId, "social");

  const vipResult = resolveWorkspaceFromSessionKey(
    workspaceMap,
    "agent:vip:bluebubbles:direct:+8618621185125",
  );
  assert.equal(vipResult.workspace, "workspace-vip");
  assert.equal(vipResult.agentId, "vip");

  const mainResult = resolveWorkspaceFromSessionKey(
    workspaceMap,
    "agent:main:telegram:direct:451740013",
  );
  assert.equal(mainResult.workspace, "workspace");
  assert.equal(mainResult.agentId, "main");
});
