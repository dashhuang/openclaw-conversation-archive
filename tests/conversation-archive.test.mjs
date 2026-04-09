import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.join(__dirname, "..", "index.js");
const pluginSource = await readFile(pluginPath, "utf8");
const pluginModule = await import(`data:text/javascript;base64,${Buffer.from(pluginSource, "utf8").toString("base64")}`);
const {
  buildBaseEntry,
  buildSearchableText,
  dedupeArchiveResults,
  formatLocalTimestamp,
  isBluebubblesGroupLike,
  normalizeTimestampMs,
  default: registerConversationArchivePlugin,
  resolveEventArchiveRoot,
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
    conversationId: "telegram:direct:451740013",
    metadata: { senderId: "451740013" },
    role: "user",
    speakerName: "Dash",
    speakerId: "451740013",
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

test("formatLocalTimestamp keeps date and time fields aligned", () => {
  const date = new Date("2026-03-14T01:43:00.000Z");
  const localTimestamp = formatLocalTimestamp(date);

  assert.match(localTimestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("isBluebubblesGroupLike recognizes raw chat identifiers and chat_guid groups", () => {
  assert.equal(isBluebubblesGroupLike("chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("chat_guid:iMessage;+;chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("Family Chat id:iMessage;+;chat240698944142298252"), true);
  assert.equal(isBluebubblesGroupLike("+64210766404"), false);
});

test("buildBaseEntry keeps BlueBubbles chat identifiers in group archives", () => {
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
          text: "AI CINEMA 3-29 13:20",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const results = await searchArchive(tempDir, {
      query: "AI CINEMA",
      limit: 5,
    });

    assert.equal(results.length, 1);
    assert.match(results[0].text, /AI CINEMA/);
    assert.equal(results[0].source, "message-preprocessed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("register wires internal archive enrichment through registerHook", () => {
  const registered = [];
  registerConversationArchivePlugin({
    config: {
      hooks: { internal: { enabled: true } },
      agents: { defaults: { workspace: "workspace" }, list: [] },
    },
    runtime: {},
    pluginConfig: {},
    registerTool() {},
    registerHook(events, _handler, opts) {
      registered.push({ events, name: opts?.name });
    },
    on() {},
    logger: { warn() {}, info() {}, error() {} },
  });

  assert.deepEqual(
    registered.map((entry) => entry.events),
    ["message:preprocessed", "message:sent"],
  );
});

test("register avoids appending the same preprocessed entry more than once", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-dedupe-"));
  const registeredHooks = new Map();

  try {
    registerConversationArchivePlugin({
      config: {
        hooks: { internal: { enabled: true } },
        agents: { defaults: { workspace: tempDir }, list: [] },
      },
      runtime: {},
      pluginConfig: {},
      registerTool() {},
      registerHook(eventName, handler) {
        registeredHooks.set(eventName, handler);
      },
      on() {},
      logger: { warn() {}, info() {}, error() {} },
    });

    const preprocessedHook = registeredHooks.get("message:preprocessed");
    assert.equal(typeof preprocessedHook, "function");

    const event = {
      sessionKey: "agent:main:telegram:451740013",
      timestamp: new Date("2026-03-29T01:00:00.000Z"),
      context: {
        channelId: "telegram",
        conversationId: "451740013",
        senderId: "451740013",
        senderName: "Dash",
        messageId: "dup-1",
        body: "这是一条重复测试消息",
        bodyForAgent: "这是一条重复测试消息",
      },
    };

    await preprocessedHook(event);
    await preprocessedHook(event);

    const archiveFile = path.join(
      tempDir,
      "logs",
      "message-archive-raw",
      "telegram",
      "direct",
      "451740013",
      "2026-03-29.jsonl",
    );
    const lines = (await readFile(archiveFile, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const matches = lines.filter((line) => JSON.parse(line).message_id === "dup-1");
    assert.equal(matches.length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dedupeArchiveResults prefers mention-skip for the same inbound user message", () => {
  const results = dedupeArchiveResults([
    {
      channel: "telegram",
      chat_type: "group",
      peer_id: "-100123",
      role: "user",
      message_id: "same-1",
      source: "message-hook",
      text: "原始文本",
    },
    {
      channel: "telegram",
      chat_type: "group",
      peer_id: "-100123",
      role: "user",
      message_id: "same-1",
      source: "message-preprocessed",
      text: "规范化文本",
    },
    {
      channel: "telegram",
      chat_type: "group",
      peer_id: "-100123",
      role: "user",
      message_id: "same-1",
      source: "mention-skip",
      text: "真实群消息",
    },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].source, "mention-skip");
});

test("dedupeArchiveResults prefers message-sent-internal for assistant messages", () => {
  const results = dedupeArchiveResults([
    {
      channel: "telegram",
      chat_type: "group",
      peer_id: "-100123",
      role: "assistant",
      message_id: "same-2",
      source: "message-hook",
      text: "已发送回复",
    },
    {
      channel: "telegram",
      chat_type: "group",
      peer_id: "-100123",
      role: "assistant",
      message_id: "same-2",
      source: "message-sent-internal",
      text: "已发送回复",
    },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].source, "message-sent-internal");
});

test("register routes gateway-stage records into event logs when internal hooks are enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "conversation-archive-routing-"));
  const gatewayHooks = new Map();
  const internalHooks = new Map();

  try {
    registerConversationArchivePlugin({
      config: {
        hooks: { internal: { enabled: true } },
        agents: { defaults: { workspace: tempDir }, list: [] },
      },
      runtime: {},
      pluginConfig: {},
      registerTool() {},
      registerHook(eventName, handler) {
        internalHooks.set(eventName, handler);
      },
      on(eventName, handler) {
        gatewayHooks.set(eventName, handler);
      },
      logger: { warn() {}, info() {}, error() {} },
    });

    const messageReceived = gatewayHooks.get("message_received");
    const messagePreprocessed = internalHooks.get("message:preprocessed");
    const messageSent = gatewayHooks.get("message_sent");
    const internalSent = internalHooks.get("message:sent");

    assert.equal(typeof messageReceived, "function");
    assert.equal(typeof messagePreprocessed, "function");
    assert.equal(typeof messageSent, "function");
    assert.equal(typeof internalSent, "function");

    await messageReceived(
      {
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
        content: "@cindya 你现在存了多少条聊天记录了",
        from: "451740013",
        metadata: {
          senderName: "Dash",
          senderId: "451740013",
          messageId: "mid-user-1",
        },
      },
      {
        channelId: "telegram",
        conversationId: "-1003778432310",
      },
    );

    await messagePreprocessed({
      sessionKey: "agent:food-group:telegram:-1003778432310",
      timestamp: new Date("2026-04-08T10:00:01.000Z"),
      context: {
        channelId: "telegram",
        conversationId: "-1003778432310",
        senderName: "Dash",
        senderId: "451740013",
        messageId: "mid-user-1",
        body: "@cindya 你现在存了多少条聊天记录了",
        bodyForAgent: "@cindya 你现在存了多少条聊天记录了",
        isGroup: true,
      },
    });

    await messageSent(
      {
        success: true,
        content: "我查一下。",
      },
      {
        channelId: "telegram",
        conversationId: "-1003778432310",
        messageId: "mid-assistant-1",
      },
    );

    await internalSent({
      sessionKey: "agent:food-group:telegram:-1003778432310",
      timestamp: new Date("2026-04-08T10:00:03.000Z"),
      context: {
        channelId: "telegram",
        conversationId: "-1003778432310",
        messageId: "mid-assistant-1",
        content: "我查一下。",
        success: true,
        isGroup: true,
      },
    });

    const archiveRoot = path.join(tempDir, "logs", "message-archive-raw");
    const eventRoot = resolveEventArchiveRoot(tempDir, {});

    const archiveHits = await searchArchive(archiveRoot, { limit: 10, json: true });
    const eventHits = await searchArchive(eventRoot, { limit: 10, json: true });

    assert.equal(archiveHits.length, 2);
    assert.deepEqual(
      archiveHits.map((entry) => entry.source).sort(),
      ["message-preprocessed", "message-sent-internal"],
    );
    assert.equal(eventHits.length, 2);
    assert.deepEqual(
      eventHits.map((entry) => entry.source).sort(),
      ["message-hook", "message-hook"],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
