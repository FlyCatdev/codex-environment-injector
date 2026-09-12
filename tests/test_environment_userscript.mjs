import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.values.delete(String(key));
  }
}

async function testSelector() {
  const studioStore = {
    version: "1",
    profiles: {
      agents: {
        id: "agents",
        name: "Agents Profile",
        model: "studio-model",
        modelProvider: "studio-provider",
        developerInstructions: "Instructions from AGENTS.md",
        baseInstructions: "Environment base instructions",
        memoryPolicy: { use: "off", generate: "on" },
        config: { model_reasoning_effort: "high" },
        updatedAt: Date.now(),
      },
      "override:file-profile": {
        id: "file-profile",
        targetProfileId: "file-profile",
        name: "Edited File Profile",
        model: "override-model",
        modelProvider: "file-provider",
        developerInstructions: "Edited file instructions",
        config: { model_reasoning_effort: "xhigh", features: { demo: true } },
        updatedAt: Date.now(),
      },
    },
  };
  const localStorage = new MemoryStorage({
    "codexpp.profileStudio.v1": JSON.stringify(studioStore),
    "codexpp.profileSelector.v1": JSON.stringify({
      version: "1",
      pendingProfileId: "studio:agents",
      promptOnNewThread: true,
      threadProfiles: {},
    }),
  });
  const window = {
    __CODEX_ENVIRONMENT_INJECTOR_TEST__: true,
    __codexSessionDeleteBridge: async (route) => {
      if (route === "/environment-injector/capabilities") return { status: "ok", diskWrite: true, bridge: true };
      if (route === "/environment-injector/agents/get") return { status: "ok", exists: true, content: "Use Chinese.", hash: "sha256:agents" };
      if (route === "/environment-injector/memory/get") return { status: "ok", summary: { content: "Summary" }, durable: { content: "Durable" }, correction: { content: "", hash: null } };
      return { status: "failed" };
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const document = { querySelector: () => null };
  const location = { href: "app://-/index.html" };
  const context = vm.createContext({
    window,
    document,
    location,
    localStorage,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto,
    TextEncoder,
    console,
  });
  const bundle = {
    schemaVersion: 2,
    generatedAt: "test",
    environment: {
      capabilities: { source: "test", diskRead: true, diskWrite: false, bridge: false },
      globalAgents: { exists: true, name: "AGENTS.md", content: "Use Chinese.", hash: "sha256:test" },
      memory: {
        settings: { enabled: true, use_memories: true, generate_memories: false },
        summary: { exists: true, content: "Stable memory summary" },
        durable: { exists: true, content: "Durable memory" },
        files: [{ path: "memory_summary.md", size: 10 }],
      },
    },
    profiles: [
      {
        id: "file-profile",
        name: "File Profile",
        source: "file",
        sourceFileName: "file-profile.config.toml",
        model: "file-model",
        modelProvider: "file-provider",
        config: {},
      },
    ],
  };
  const template = fs.readFileSync(
    path.join(root, "codexpp", "environment-injector.template.js"),
    "utf8",
  );
  assert.doesNotMatch(template, /if \(state\.pendingProfileId\) return;/);
  assert.match(template, /dialogCard\.className = "dialog"/);
  assert.match(template, /\.panel \{ position: fixed; inset: 0;/);
  assert.match(template, /place-items: center/);
  assert.match(template, /event\.target === panel/);
  assert.match(template, /currentTab\.textContent = "当前会话"/);
  assert.match(template, /currentRoot\.className = "current-view"/);
  assert.match(template, /memoryTab\.textContent = "Memories"/);
  assert.match(template, /agentsTab\.textContent = "AGENTS\.md"/);
  assert.match(template, /tutorialTab\.textContent = "教程"/);
  assert.match(template, /function renderTutorialView\(\)/);
  assert.match(template, /viewTutorial: openTutorialView/);
  assert.match(template, /applied=true、proof=acknowledged/);
  assert.match(template, /function createDisclosureSection\(/);
  assert.match(template, /current-section-trigger/);
  assert.match(template, /current-section-chevron/);
  assert.doesNotMatch(template, /document\.createElement\("details"\)/);
  assert.match(template, /panelExpandButton/);
  assert.match(template, /dialog\[data-expanded="true"\]/);
  assert.match(template, /\.dialog:not\(\[data-mode="select"\]\).*min\(920px/);
  assert.match(template, /\.current-view \{ grid-template-columns: repeat\(2/);
  assert.match(template, /\.current-meta \{ display: grid; grid-template-columns: repeat\(3/);
  assert.match(template, /app-server-request-client-prototype/);
  assert.doesNotMatch(template, /client\.sendRequest\s*=/);
  assert.match(template, /Developer Instructions/);
  assert.match(template, /Codex 最终合成的完整系统提示词/);
  const source = template.replace(
    "__CODEX_ENVIRONMENT_BUNDLE__",
    JSON.stringify(bundle),
  );
  vm.runInContext(source, context, { filename: "environment-injector.js" });

  const api = window.__codexEnvironmentInjectorTest;
  assert.ok(api, "environment injector test API is missing");
  const migratedStore = api.environmentStore();
  assert.equal(migratedStore.schemaVersion, 2);
  assert.equal(migratedStore.migration.completed, true);
  assert.deepEqual(
    Array.from(migratedStore.migration.sources).sort(),
    ["codexpp.profileSelector.v1", "codexpp.profileStudio.v1"],
  );
  assert.ok(localStorage.getItem("codexpp.profileSelector.v1"));
  assert.ok(localStorage.getItem("codexpp.profileStudio.v1"));
  assert.ok(localStorage.getItem("codexpp.environmentInjector.v2"));
  await api.refreshBridgeState();
  const bridgeState = api.bridgeState();
  assert.equal(bridgeState.bridgeCapabilities.diskWrite, true);
  assert.equal(bridgeState.bridgeAgents.hash, "sha256:agents");
  assert.equal(bridgeState.bridgeMemory.summary.content, "Summary");
  const adapterSnapshot = api.uiSnapshot();
  assert.equal(adapterSnapshot.status.version, "0.4.0");
  assert.ok(Array.isArray(adapterSnapshot.profiles));
  let adapterUpdates = 0;
  let adapterMode = "";
  const detachUi = api.attachUiAdapter({
    chooseProfile: async () => "file-profile",
    open: (mode) => { adapterMode = mode; },
    update: () => { adapterUpdates += 1; },
    showToast() {},
    contains: () => false,
    destroy() {},
  });
  assert.ok(adapterUpdates >= 1);
  assert.equal(await api.chooseProfile("React chooser"), "file-profile");
  await api.openEnvironmentView("current", null);
  assert.equal(adapterMode, "current");
  detachUi();
  assert.deepEqual(
    Array.from(api.profiles(), (profile) => profile.id),
    ["base", "file-profile", "studio:agents"],
  );
  const fileOverride = api.profileById("file-profile");
  assert.equal(fileOverride.model, "override-model");
  assert.equal(fileOverride.source, "studio-override");
  assert.equal(api.editableProfiles()[0].model, "file-model");
  assert.equal(api.editableProfiles()[0].sourceFileName, "file-profile.config.toml");

  const profile = api.profileById("studio:agents");
  const patched = JSON.parse(JSON.stringify(api.applyProfileToParams(
    { cwd: "C:/work", config: { existing: true } },
    profile,
  )));
  assert.equal(patched.model, "studio-model");
  assert.equal(patched.modelProvider, "studio-provider");
  assert.equal(patched.developerInstructions, "Instructions from AGENTS.md");
  assert.equal(patched.baseInstructions, "Environment base instructions");
  assert.equal(patched.config.existing, true);
  assert.equal(patched.config.model_reasoning_effort, "high");
  assert.equal(patched.config.memories.use_memories, false);
  assert.equal(patched.config.memories.generate_memories, true);
  const permissionsParams = api.applyProfileToParams(
    { permissions: "workspace-write" },
    profile,
  );
  assert.equal(Object.hasOwn(permissionsParams, "approvalPolicy"), false);
  assert.equal(Object.hasOwn(permissionsParams, "sandbox"), false);
  assert.deepEqual(
    Array.from(api.injectedFieldsFromParams({ permissions: "workspace-write" }, permissionsParams)).sort(),
    ["baseInstructions", "config", "developerInstructions", "model", "modelProvider"].sort(),
  );
  const markedParams = api.markInjectedParams(permissionsParams);
  assert.equal(api.prepareDispatcherRequest("mcp-request", {
    request: { method: "thread/start", params: markedParams },
  }), null);
  assert.equal(api.requestDescriptor("thread/start", patched).kind, "thread/start");
  api.bindThreadProfile("thread-unconfirmed", "studio:agents", { applied: false, source: "direct-rpc-turn-start" });
  const unconfirmedEntry = api.threadProfileEntry("thread-unconfirmed");
  assert.equal(unconfirmedEntry.profileId, "studio:agents");
  assert.equal(unconfirmedEntry.applied, false);
  assert.equal(api.currentBindingStatus(unconfirmedEntry, "thread-unconfirmed").kind, "unconfirmed");
  assert.equal(api.currentBindingStatus(null, "thread-base").kind, "base");
  assert.equal(api.currentBindingStatus(null, "").kind, "draft");
  assert.equal(api.turnStartThreadId("mcp-request", {
    request: { method: "turn/start", params: { threadId: "thread-direct" } },
  }), "thread-direct");

  class LegacyController {
    async sendRequest(method) { return method; }
  }
  const legacyController = new LegacyController();
  legacyController.sendRequest = LegacyController.prototype.sendRequest;
  assert.equal(Object.getOwnPropertyDescriptor(legacyController, "sendRequest").enumerable, true);
  assert.equal(api.healLegacySendRequestShadow(legacyController), true);
  assert.equal(Object.hasOwn(legacyController, "sendRequest"), false);
  assert.equal(legacyController.sendRequest, LegacyController.prototype.sendRequest);
  assert.equal(api.healLegacySendRequestShadow(legacyController), false);

  const directCalls = [];
  class DirectRequestClient {
    async sendRequest(method, params, options) {
      return this.enqueueRequest(method, params, options);
    }
    async enqueueRequest(method, params, options) {
      directCalls.push({ method, params, options });
      return { thread: { id: "thread-direct-rpc" } };
    }
    async prewarmThreadStart(request, options) {
      directCalls.push({ method: "thread/start", params: request, options, prewarm: true });
      return { thread: { id: "thread-prewarm" } };
    }
  }
  let discardedPrewarms = 0;
  class Mdn {
    constructor() {
      this.requestClient = new DirectRequestClient();
      this.threadCreation = {};
      this.prewarmedThreadManager = {
        discardAllPrewarmedThreads() { discardedPrewarms += 1; },
      };
    }
    async sendRequest(method, params, ...rest) {
      return this.requestClient.sendRequest(method, params, ...rest);
    }
  }
  const directTarget = new Mdn();
  const secondDirectTarget = new Mdn();
  const originalDirectDescriptor = Object.getOwnPropertyDescriptor(DirectRequestClient.prototype, "sendRequest");
  const originalPrewarmDescriptor = Object.getOwnPropertyDescriptor(DirectRequestClient.prototype, "prewarmThreadStart");
  api.setPendingProfile("studio:agents");
  assert.equal(Object.hasOwn(directTarget, "sendRequest"), false);
  assert.equal(Object.hasOwn(directTarget.requestClient, "sendRequest"), false);
  assert.equal(api.patchClient(directTarget), true);
  assert.equal(api.patchClient(secondDirectTarget), false);
  assert.equal(Object.hasOwn(directTarget, "sendRequest"), false);
  assert.equal(Object.hasOwn(directTarget.requestClient, "sendRequest"), false);
  assert.equal(Object.hasOwn(directTarget.requestClient, "prewarmThreadStart"), false);
  api.setPendingProfile("base");
  api.setPendingProfile("studio:agents");
  assert.ok(discardedPrewarms >= 2);
  const prewarmResult = await directTarget.requestClient.prewarmThreadStart(
    { cwd: "C:/prewarm", config: { existing: true } },
    { timeoutMs: 1000 },
  );
  assert.equal(prewarmResult.thread.id, "thread-prewarm");
  assert.equal(directCalls[0].prewarm, true);
  assert.equal(directCalls[0].params.model, "studio-model");
  assert.equal(directCalls[0].params.config.memories.use_memories, false);
  const prewarmStore = JSON.parse(localStorage.getItem("codexpp.environmentInjector.v2"));
  assert.equal(prewarmStore.bindingsByThread["thread-prewarm"].applied, true);
  assert.equal(prewarmStore.bindingsByThread["thread-prewarm"].source, "prewarm-thread-start-prototype");
  assert.equal(prewarmStore.proofByThread["thread-prewarm"].status, "acknowledged");
  assert.equal(prewarmStore.selection.pendingProfileId, "studio:agents");

  const directResult = await directTarget.sendRequest(
    "thread/start",
    { cwd: "C:/direct", config: { existing: true } },
    { signal: "keep" },
  );
  assert.equal(directResult.thread.id, "thread-direct-rpc");
  assert.equal(directCalls[1].params.model, "studio-model");
  assert.equal(directCalls[1].params.modelProvider, "studio-provider");
  assert.equal(directCalls[1].params.baseInstructions, "Environment base instructions");
  assert.equal(directCalls[1].params.config.memories.use_memories, false);
  assert.equal(directCalls[1].options.signal, "keep");
  const directStore = JSON.parse(localStorage.getItem("codexpp.environmentInjector.v2"));
  assert.equal(directStore.bindingsByThread["thread-direct-rpc"].applied, true);
  assert.equal(directStore.bindingsByThread["thread-direct-rpc"].source, "app-server-request-client-prototype");
  assert.equal(directStore.proofByThread["thread-direct-rpc"].status, "acknowledged");
  assert.equal(directStore.proofByThread["thread-direct-rpc"].transport, "app-server-request-client-prototype");
  assert.ok(directStore.proofByThread["thread-direct-rpc"].payloadDigest.startsWith("sha256:"));
  assert.ok(directStore.proofByThread["thread-direct-rpc"].fields.includes("developerInstructions"));

  const calls = [];
  const handlers = new Map();
  const dispatcher = {
    __codexServiceTierOriginalDispatchMessage() {},
    dispatchMessage(type, payload) {
      calls.push({ type, payload });
      return true;
    },
    subscribe(type, listener) {
      handlers.set(type, listener);
      return () => handlers.delete(type);
    },
  };
  const originalDispatchDescriptor = Object.getOwnPropertyDescriptor(dispatcher, "dispatchMessage");
  api.setPendingProfile("studio:agents");
  assert.equal(api.patchClient(dispatcher), true);
  assert.equal(api.patchClient(dispatcher), false);
  assert.equal(api.patchedClientCount(), 3);
  dispatcher.dispatchMessage("fetch", {
    url: "vscode://codex/send-cli-request-for-host",
    body: JSON.stringify({ method: "thread/start", params: { cwd: "C:/work", config: { existing: true } } }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "fetch");
  const forwardedBody = JSON.parse(calls[0].payload.body);
  assert.equal(forwardedBody.method, "thread/start");
  assert.equal(forwardedBody.params.model, "studio-model");
  assert.equal(forwardedBody.params.modelProvider, "studio-provider");
  assert.equal(forwardedBody.params.developerInstructions, "Instructions from AGENTS.md");
  assert.equal(forwardedBody.params.config.existing, true);
  assert.equal(forwardedBody.params.config.model_reasoning_effort, "high");
  handlers.get("thread/started")?.({ thread: { id: "thread-test" } });
  const selectorState = JSON.parse(localStorage.getItem("codexpp.environmentInjector.v2"));
  // An uncorrelated broadcast is not acknowledgment of our request.
  assert.equal(selectorState.selection.pendingProfileId, "studio:agents");
  assert.equal(selectorState.bindingsByThread["thread-test"], undefined);
  assert.equal(selectorState.proofByThread["thread-test"], undefined);
  const wrappedDescriptor = Object.getOwnPropertyDescriptor(dispatcher, "dispatchMessage");
  assert.equal(wrappedDescriptor.enumerable, originalDispatchDescriptor.enumerable);
  assert.equal(wrappedDescriptor.configurable, originalDispatchDescriptor.configurable);
  assert.equal(wrappedDescriptor.writable, originalDispatchDescriptor.writable);

  class RpcTarget {
    constructor() {
      this.__codexServiceTierOriginalDispatchMessage = () => {};
      this.dispatchMessage = () => true;
      this.subscribe = () => () => {};
    }
  }
  const rpcTarget = new RpcTarget();
  assert.equal(api.isRpcTargetLike(rpcTarget), true);
  assert.equal(api.patchClient(rpcTarget), false);

  class PrototypeClient {
    async sendRequest() { return { ok: true }; }
    sendNotification() {}
  }
  assert.equal(api.patchClient(new PrototypeClient()), false);

  const lockedClient = { sendNotification() {} };
  Object.defineProperty(lockedClient, "sendRequest", {
    value: async () => ({ ok: true }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
  assert.equal(api.patchClient(lockedClient), false);

  let poisonReads = 0;
  const poison = { sendNotification() {} };
  Object.defineProperty(poison, "sendRequest", {
    enumerable: true,
    get() {
      poisonReads += 1;
      throw new Error("getter must not run");
    },
  });
  assert.doesNotThrow(() => api.moduleCandidates({ poison }));
  assert.doesNotThrow(() => api.patchFromObjectGraph({ poison }));
  assert.equal(poisonReads, 0);

  let proxyReads = 0;
  const hostileProxy = new Proxy({ nested: {} }, {
    get(target, key, receiver) {
      proxyReads += 1;
      if (key === "sendRequest") throw new Error("private RPC property read");
      return Reflect.get(target, key, receiver);
    },
  });
  assert.doesNotThrow(() => api.moduleCandidates({ hostileProxy }));
  assert.doesNotThrow(() => api.patchFromObjectGraph(hostileProxy));
  assert.equal(proxyReads, 0);

  api.destroy();
  assert.deepEqual(Object.getOwnPropertyDescriptor(DirectRequestClient.prototype, "sendRequest"), originalDirectDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(DirectRequestClient.prototype, "prewarmThreadStart"), originalPrewarmDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(dispatcher, "dispatchMessage"), originalDispatchDescriptor);
  assert.equal(handlers.size, 0);
}

function testStudio() {
  const localStorage = new MemoryStorage();
  const window = {
    __CODEX_ENVIRONMENT_STUDIO_TEST__: true,
    __codexEnvironmentInjector: {
      editableProfiles: () => [{
        id: "file-profile",
        name: "File Profile",
        source: "file",
        sourceFileName: "file-profile.config.toml",
        model: "file-model",
        modelProvider: "file-provider",
        developerInstructions: "File instructions",
        config: { model_reasoning_effort: "medium", features: { demo: true } },
      }],
    },
  };
  const context = vm.createContext({
    window,
    localStorage,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });
  const source = fs.readFileSync(
    path.join(root, "codexpp", "environment-studio.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "environment-studio.js" });

  const api = window.__codexEnvironmentStudioTest;
  assert.ok(api, "Environment Studio test API is missing");
  const detected = api.fileProfileEntries();
  assert.equal(detected.length, 1);
  assert.equal(detected[0].id, "file-profile");
  assert.equal(detected[0].sourceKind, "file");
  assert.equal(api.storageKeyFor({ id: "file-profile", targetProfileId: "file-profile" }), "override:file-profile");
  assert.equal(api.selectorProfileId({ id: "file-profile", targetProfileId: "file-profile" }), "file-profile");
  assert.equal(api.titleFromMarkdown("# My Agents\n\nRules"), "My Agents");
  assert.equal(api.slugify("My Agents"), "my-agents");
  assert.equal(api.likelyContainsSecret("token = abcdefghijklmnop"), true);
  assert.equal(api.likelyContainsSecret("Use TOKEN from the environment"), false);

  const profile = {
    id: "my-agents",
    name: "My Agents",
    sourceFileName: "AGENTS.md",
    model: "test-model",
    modelProvider: "",
    developerInstructions: "Line one\nLine two",
    baseInstructions: "Base layer",
    memoryPolicy: { use: "off", generate: "on" },
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    serviceTier: "",
    config: {
      model_reasoning_effort: "high",
      features: { demo: true },
      model_providers: { "vendor@test": { base_url: "https://example.invalid/v1", requires_openai_auth: true } },
    },
  };
  assert.equal(api.validateProfile(profile), "");
  const toml = api.profileToml(profile);
  assert.match(toml, /model = "test-model"/);
  assert.match(toml, /model_reasoning_effort = "high"/);
  assert.match(toml, /developer_instructions = "Line one\\nLine two"/);
  assert.match(toml, /base_instructions = "Base layer"/);
  assert.match(toml, /\[memories\]/);
  assert.match(toml, /use_memories = false/);
  assert.match(toml, /generate_memories = true/);
  assert.match(toml, /\[features\]/);
  assert.match(toml, /demo = true/);
  assert.match(toml, /\[model_providers\."vendor@test"\]/);
  assert.match(toml, /base_url = "https:\/\/example\.invalid\/v1"/);
}

await testSelector();
testStudio();
console.log("userscript tests OK");
