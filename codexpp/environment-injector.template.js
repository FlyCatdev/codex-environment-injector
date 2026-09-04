/* Codex++ Environment Injector v0.3.2 */
(() => {
  "use strict";

  const GLOBAL_KEY = "__codexEnvironmentInjector";
  const LEGACY_GLOBAL_KEY = "__codexPlusProfileSelector";
  const VERSION = "0.3.2";
  const STORAGE_KEY = "codexpp.environmentInjector.v2";
  const LEGACY_SELECTOR_STORAGE_KEY = "codexpp.profileSelector.v1";
  const LEGACY_STUDIO_STORAGE_KEY = "codexpp.profileStudio.v1";
  const STATE_VERSION = 2;
  const WRAPPER_MARK = "__codexEnvironmentInjectorWrapper";
  const INJECTED_PARAMS_MARK = Symbol("codex-environment-injected-params");
  const HOST_ID = "codexpp-environment-injector-host";
  const UPDATE_EVENT = "codexpp-environment-injector-updated";
  const MAX_THREAD_ENTRIES = 160;
  const ENVIRONMENT_BUNDLE = __CODEX_ENVIRONMENT_BUNDLE__;

  window[GLOBAL_KEY]?.destroy?.();
  if (window[LEGACY_GLOBAL_KEY] && window[LEGACY_GLOBAL_KEY] !== window[GLOBAL_KEY]) {
    window[LEGACY_GLOBAL_KEY]?.destroy?.();
  }

  const lifetime = new AbortController();
  const { signal } = lifetime;
  const wrapperToken = {};
  const patchedClients = new Set();
  const environmentControllers = new Set();
  const replayTargets = new WeakSet();
  const modulePromises = new Map();
  const staticProfiles = Array.isArray(ENVIRONMENT_BUNDLE.profiles)
    ? ENVIRONMENT_BUNDLE.profiles
    : [];
  const staticProfileIds = new Set(staticProfiles
    .map((profile) => String(profile?.id || "").trim())
    .filter((id) => /^[A-Za-z0-9_-]+$/.test(id)));
  let profiles = [];
  let profileMap = new Map();

  let destroyed = false;
  let host = null;
  let shadow = null;
  let pill = null;
  let panel = null;
  let dialogCard = null;
  let panelTitle = null;
  let panelSubtitle = null;
  let panelExpandButton = null;
  let dialogExpanded = false;
  let optionsRoot = null;
  let currentRoot = null;
  let selectTab = null;
  let currentTab = null;
  let memoryTab = null;
  let agentsTab = null;
  let tutorialTab = null;
  let memoryRoot = null;
  let agentsRoot = null;
  let tutorialRoot = null;
  let panelFooter = null;
  let panelMode = "select";
  let selectionTitle = "选择环境";
  let currentRenderIdentity = "";
  let promptCheckbox = null;
  let toastNode = null;
  let activeChooser = null;
  let scanTimer = 0;
  let labelTimer = 0;
  let scanInFlight = false;
  let scanAttempts = 0;
  let lastPatchError = "";
  let healedLegacySendRequestShadows = 0;
  const requestTrace = [];
  const disclosureState = new Map();
  let pendingStartBinding = null;
  let pendingThreadObservation = null;
  let bridgeCapabilities = null;
  let bridgeAgents = null;
  let bridgeMemory = null;
  let uiAdapter = null;

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  async function bridgeCall(path, payload = {}) {
    if (typeof window.__codexSessionDeleteBridge !== "function") {
      return { status: "unavailable", message: "Codex++ bridge unavailable" };
    }
    try {
      return await window.__codexSessionDeleteBridge(path, payload);
    } catch (error) {
      return { status: "failed", message: String(error?.message || error) };
    }
  }

  async function refreshBridgeState() {
    const capabilities = await bridgeCall("/environment-injector/capabilities", {});
    if (capabilities?.status !== "ok") {
      bridgeCapabilities = null;
      bridgeAgents = null;
      bridgeMemory = null;
      return;
    }
    bridgeCapabilities = capabilities;
    const [agents, memory] = await Promise.all([
      bridgeCall("/environment-injector/agents/get", {}),
      bridgeCall("/environment-injector/memory/get", {}),
    ]);
    bridgeAgents = agents?.status === "ok" ? agents : null;
    bridgeMemory = memory?.status === "ok" ? memory : null;
    if (panelMode === "memory") renderMemoryView();
    if (panelMode === "agents") renderAgentsView();
    updatePill();
  }

  function cloneJson(value, fallback = {}) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }

  function defaultEnvironmentStore() {
    return {
      schemaVersion: STATE_VERSION,
      revision: 0,
      profiles: {},
      selection: { pendingProfileId: "", promptOnNewThread: true },
      bindingsByThread: {},
      proofByThread: {},
      migration: { completed: false, sources: [] },
      ui: {},
    };
  }

  function parseStoredJson(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  function normalizeEnvironmentStore(value) {
    const store = isObject(value) ? value : defaultEnvironmentStore();
    store.schemaVersion = STATE_VERSION;
    if (!Number.isFinite(store.revision)) store.revision = 0;
    if (!isObject(store.profiles)) store.profiles = {};
    if (!isObject(store.selection)) store.selection = {};
    if (!isObject(store.bindingsByThread)) store.bindingsByThread = {};
    if (!isObject(store.proofByThread)) store.proofByThread = {};
    if (!isObject(store.migration)) store.migration = { completed: false, sources: [] };
    if (!Array.isArray(store.migration.sources)) store.migration.sources = [];
    if (!isObject(store.ui)) store.ui = {};
    store.selection.pendingProfileId = String(store.selection.pendingProfileId || "");
    store.selection.promptOnNewThread = store.selection.promptOnNewThread !== false;
    return store;
  }

  function migrateLegacyEnvironmentStore() {
    const store = defaultEnvironmentStore();
    const legacyStudio = parseStoredJson(LEGACY_STUDIO_STORAGE_KEY);
    const legacySelector = parseStoredJson(LEGACY_SELECTOR_STORAGE_KEY);
    if (legacyStudio && isObject(legacyStudio.profiles)) {
      store.profiles = cloneJson(legacyStudio.profiles);
      store.migration.sources.push(LEGACY_STUDIO_STORAGE_KEY);
    }
    if (legacySelector) {
      store.selection.pendingProfileId = String(legacySelector.pendingProfileId || "");
      store.selection.promptOnNewThread = legacySelector.promptOnNewThread !== false;
      if (isObject(legacySelector.threadProfiles)) {
        store.bindingsByThread = cloneJson(legacySelector.threadProfiles);
      }
      store.migration.sources.push(LEGACY_SELECTOR_STORAGE_KEY);
    }
    store.migration.completed = true;
    store.migration.migratedAt = new Date().toISOString();
    return store;
  }

  function loadEnvironmentStore() {
    const existing = parseStoredJson(STORAGE_KEY);
    if (existing?.schemaVersion === STATE_VERSION) return normalizeEnvironmentStore(existing);
    const migrated = normalizeEnvironmentStore(migrateLegacyEnvironmentStore());
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
    return migrated;
  }

  function saveEnvironmentStore() {
    environmentStore.revision = Number(environmentStore.revision || 0) + 1;
    environmentStore.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(environmentStore)); } catch {}
    if (typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  }

  let environmentStore = loadEnvironmentStore();
  dialogExpanded = environmentStore.ui?.panelExpanded === true;

  function studioProfiles() {
    const values = Object.values(environmentStore.profiles || {});
    return values.slice(0, 60).flatMap((item) => {
      if (!isObject(item)) return [];
      const rawId = String(item.id || "").trim();
      if (!/^[A-Za-z0-9_-]+$/.test(rawId)) return [];
      const instructions = typeof item.developerInstructions === "string"
        ? item.developerInstructions
        : "";
      if (instructions.length > 40000) return [];
      const requestedTarget = String(item.targetProfileId || "").trim();
      const targetProfileId = staticProfileIds.has(requestedTarget) ? requestedTarget : "";
      return [{
        id: targetProfileId || `studio:${rawId}`,
        name: String(item.displayName || item.name || rawId).trim() || rawId,
        model: String(item.model || ""),
        modelProvider: String(item.modelProvider || ""),
        config: isObject(item.config) ? cloneJson(item.config) : {},
        developerInstructions: instructions,
        baseInstructions: typeof item.baseInstructions === "string" ? item.baseInstructions : "",
        approvalPolicy: String(item.approvalPolicy || ""),
        sandbox: String(item.sandbox || ""),
        serviceTier: String(item.serviceTier || ""),
        memoryPolicy: isObject(item.memoryPolicy) ? cloneJson(item.memoryPolicy) : {},
        source: targetProfileId ? "studio-override" : "studio",
        sourceProfileId: targetProfileId,
      }];
    });
  }

  function refreshProfileCatalog() {
    const catalog = [
      { id: "base", name: "Base", model: "", modelProvider: "", config: {}, source: "base" },
      ...staticProfiles.map((profile) => ({ ...profile, source: profile.source || "file" })),
    ];
    const indexes = new Map(catalog.map((profile, index) => [profile.id, index]));
    for (const profile of studioProfiles()) {
      const existingIndex = indexes.get(profile.id);
      if (existingIndex === undefined) {
        indexes.set(profile.id, catalog.length);
        catalog.push(profile);
      } else {
        catalog[existingIndex] = profile;
      }
    }
    profiles = catalog;
    profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  }

  refreshProfileCatalog();

  function editableStaticProfiles() {
    return staticProfiles.map((profile) => JSON.parse(JSON.stringify({
      ...profile,
      source: profile.source || "file",
      sourceFileName: profile.sourceFileName || `${profile.id}.config.toml`,
    })));
  }

  function validProfileId(value) {
    const id = String(value || "");
    return profileMap.has(id) ? id : "base";
  }

  function profileById(value) {
    return profileMap.get(validProfileId(value)) || profileMap.get("base");
  }

  function defaultState() {
    return {
      version: STATE_VERSION,
      pendingProfileId: "",
      promptOnNewThread: true,
      threadProfiles: {},
      proofByThread: {},
    };
  }

  function loadState() {
    const next = defaultState();
    next.pendingProfileId = environmentStore.selection.pendingProfileId
      ? validProfileId(environmentStore.selection.pendingProfileId)
      : "";
    next.promptOnNewThread = environmentStore.selection.promptOnNewThread !== false;
    next.threadProfiles = isObject(environmentStore.bindingsByThread)
      ? cloneJson(environmentStore.bindingsByThread)
      : {};
    next.proofByThread = isObject(environmentStore.proofByThread)
      ? cloneJson(environmentStore.proofByThread)
      : {};
    return next;
  }

  let state = loadState();

  function saveState() {
    const entries = Object.entries(state.threadProfiles || {})
      .filter(([, item]) => isObject(item) && profileMap.has(String(item.profileId || "")))
      .sort((left, right) => Number(right[1]?.at || 0) - Number(left[1]?.at || 0))
      .slice(0, MAX_THREAD_ENTRIES);
    state.threadProfiles = Object.fromEntries(entries);
    environmentStore.selection = {
      pendingProfileId: state.pendingProfileId,
      promptOnNewThread: state.promptOnNewThread,
    };
    environmentStore.bindingsByThread = cloneJson(state.threadProfiles);
    environmentStore.proofByThread = cloneJson(state.proofByThread || {});
    saveEnvironmentStore();
    updatePill();
  }

  function normalizedThreadId(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 180) return "";
    return text.startsWith("local:") ? text.slice("local:".length) : text;
  }

  function currentThreadId() {
    const direct = [
      document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')?.getAttribute("data-app-action-sidebar-thread-id"),
      document.querySelector('[data-app-action-sidebar-thread-id][data-state="active"]')?.getAttribute("data-app-action-sidebar-thread-id"),
      document.querySelector('[data-app-action-sidebar-thread-id].active')?.getAttribute("data-app-action-sidebar-thread-id"),
    ].map(normalizedThreadId).find(Boolean);
    if (direct) return direct;
    const match = String(location.href).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return normalizedThreadId(match?.[0]);
  }

  function threadProfileEntry(threadId = currentThreadId()) {
    const id = normalizedThreadId(threadId);
    if (!id) return null;
    const entry = state.threadProfiles[id] || state.threadProfiles[`local:${id}`];
    if (!isObject(entry)) return null;
    return { ...entry, profileId: validProfileId(entry.profileId) };
  }

  function threadProfileId(threadId = currentThreadId()) {
    return threadProfileEntry(threadId)?.profileId || "";
  }

  function bindThreadProfile(threadId, profileId, metadata = {}) {
    const id = normalizedThreadId(threadId);
    if (!id) return;
    const entry = {
      profileId: validProfileId(profileId),
      at: Date.now(),
      source: String(metadata.source || "dispatcher"),
    };
    if (metadata.applied === true || metadata.applied === false) entry.applied = metadata.applied;
    if (metadata.proofId) entry.proofId = String(metadata.proofId);
    state.threadProfiles[id] = entry;
    saveState();
  }

  function discardPrewarmedThreads() {
    for (const controller of environmentControllers) {
      const manager = ownValue(controller, "prewarmedThreadManager");
      const discard = callableMember(manager, "discardAllPrewarmedThreads")?.descriptor?.value;
      if (typeof discard !== "function") continue;
      try {
        discard.call(manager);
        traceRequest("prewarmed-threads-discarded", { typeNames: objectTypeNames(controller).slice(0, 2) });
      } catch (error) {
        traceRequest("prewarm-discard-error", { error: String(error?.message || error) });
      }
    }
  }

  function setPendingProfile(profileId) {
    const nextProfileId = validProfileId(profileId);
    if (state.pendingProfileId !== nextProfileId) discardPrewarmedThreads();
    state.pendingProfileId = nextProfileId;
    saveState();
  }

  function consumePendingProfile(profileId) {
    if (state.pendingProfileId === profileId) {
      state.pendingProfileId = "";
      saveState();
    }
  }

  function profileDisplayName(profileId) {
    return String(profileById(profileId)?.name || profileId || "Base");
  }

  function pillLabel() {
    const currentId = currentThreadId();
    const currentProfile = threadProfileId(currentId);
    if (currentId && currentProfile) return `当前环境: ${profileDisplayName(currentProfile)}`;
    if (state.pendingProfileId) return `下次环境: ${profileDisplayName(state.pendingProfileId)}`;
    return "环境: Base";
  }

  function uiSnapshot() {
    const status = publicStatus();
    const currentId = currentThreadId();
    const currentProfileId = threadProfileId(currentId) || "base";
    return cloneJson({
      status,
      profiles,
      currentProfile: profileById(currentProfileId),
      environmentStore,
      environmentSnapshot: ENVIRONMENT_BUNDLE.environment || {},
      bridgeAgents,
      bridgeMemory,
    });
  }

  function notifyUiAdapter() {
    try { uiAdapter?.update?.(uiSnapshot()); } catch {}
  }

  function attachUiAdapter(adapter) {
    if (!adapter || typeof adapter !== "object" || typeof adapter.chooseProfile !== "function") {
      throw new TypeError("Environment Injector UI adapter is invalid");
    }
    if (uiAdapter && uiAdapter !== adapter) {
      try { uiAdapter.destroy?.(); } catch {}
    }
    uiAdapter = adapter;
    if (pill) pill.hidden = true;
    if (panel) panel.hidden = true;
    notifyUiAdapter();
    return () => {
      if (uiAdapter !== adapter) return;
      uiAdapter = null;
      if (pill) pill.hidden = false;
      updatePill();
    };
  }

  function updatePill() {
    if (pill) {
      pill.textContent = pillLabel();
      pill.title = "打开环境注入器：环境、当前会话、Memories 与 AGENTS.md";
    }
    if (panelMode === "current" && panel && !panel.hidden) {
      const threadId = currentThreadId();
      const entry = threadProfileEntry(threadId);
      const identity = [threadId, entry?.profileId || "base", String(entry?.applied), state.pendingProfileId].join("|");
      if (identity !== currentRenderIdentity) renderCurrentProfileView();
    }
    notifyUiAdapter();
  }

  function showToast(message, kind = "info") {
    if (uiAdapter?.showToast) {
      try { uiAdapter.showToast(String(message || ""), kind); } catch {}
      return;
    }
    if (!toastNode) return;
    toastNode.textContent = String(message || "");
    toastNode.dataset.kind = kind;
    toastNode.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      if (toastNode) toastNode.hidden = true;
    }, 2600);
  }

  function closeChooser(value = null) {
    if (panel) panel.hidden = true;
    const chooser = activeChooser;
    activeChooser = null;
    chooser?.resolve?.(value);
  }

  function renderProfileOptions() {
    if (!optionsRoot) return;
    optionsRoot.replaceChildren();
    for (const profile of profiles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-option";
      button.dataset.profileId = profile.id;
      button.dataset.selected = String(state.pendingProfileId === profile.id);
      button.setAttribute("aria-pressed", String(state.pendingProfileId === profile.id));

      const text = document.createElement("span");
      text.className = "profile-option-text";
      const title = document.createElement("strong");
      title.textContent = profile.name;
      const details = document.createElement("small");
      const detailParts = [];
      if (profile.id === "base") detailParts.push("全局基础配置");
      else if (profile.source === "file") detailParts.push("文件 Profile");
      else if (profile.source === "studio-override") detailParts.push("本地覆盖");
      else if (profile.source === "studio") detailParts.push("工坊 Profile");
      if (profile.model) detailParts.push(profile.model);
      if (profile.modelProvider) detailParts.push(profile.modelProvider);
      details.textContent = detailParts.join(" · ") || "会话配置覆盖";
      text.append(title, details);

      const check = document.createElement("span");
      check.className = "profile-check";
      check.textContent = state.pendingProfileId === profile.id ? "✓" : "";
      button.append(text, check);
      button.addEventListener("click", () => closeChooser(profile.id), { signal });
      optionsRoot.append(button);
    }
  }

  function appendMetaRow(root, label, value) {
    const row = document.createElement("div");
    row.className = "current-meta-row";
    const key = document.createElement("span");
    key.textContent = label;
    const data = document.createElement("code");
    data.textContent = String(value || "继承 / 未设置");
    row.append(key, data);
    root.append(row);
  }

  function createDisclosureSection(title, content, options = {}) {
    const key = String(options.key || title);
    const initialOpen = disclosureState.has(key) ? disclosureState.get(key) === true : options.open === true;
    const section = document.createElement("section");
    section.className = `current-section${options.className ? ` ${options.className}` : ""}`;
    section.dataset.open = String(initialOpen);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "current-section-trigger";
    trigger.setAttribute("aria-expanded", String(initialOpen));
    const heading = document.createElement("span");
    heading.className = "current-section-title";
    heading.textContent = title;
    const end = document.createElement("span");
    end.className = "current-section-end";
    const meta = document.createElement("span");
    meta.className = "current-section-meta";
    meta.textContent = String(options.meta || "");
    const chevron = document.createElement("span");
    chevron.className = "current-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    end.append(meta, chevron);
    trigger.append(heading, end);
    const body = document.createElement("div");
    body.className = "current-section-body";
    body.hidden = !initialOpen;
    body.append(content);
    const setOpen = (open) => {
      disclosureState.set(key, open);
      section.dataset.open = String(open);
      trigger.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
    };
    trigger.addEventListener("click", () => setOpen(trigger.getAttribute("aria-expanded") !== "true"), { signal });
    section.append(trigger, body);
    return section;
  }

  function appendInspectionSection(root, title, text, emptyText, open = false) {
    const value = text ? String(text) : "";
    const body = document.createElement("pre");
    body.textContent = value || emptyText;
    if (!value) body.dataset.empty = "true";
    const meta = value
      ? `${Math.max(1, value.split("\n").length)} 行`
      : "未设置";
    const keyPrefix = root?.className || "inspection";
    root.append(createDisclosureSection(title, body, {
      key: `${keyPrefix}:${title}`,
      open,
      meta,
    }));
  }

  function currentBindingStatus(entry, threadId) {
    if (!threadId) {
      return { kind: "draft", label: "新对话草稿", detail: "尚未创建 thread；可查看下次待选 Profile。" };
    }
    if (!entry) {
      return { kind: "base", label: "未由选择器管理", detail: "该会话没有 Profile 绑定记录，按 Base / Codex 全局配置运行。" };
    }
    if (entry.applied === true) {
      return { kind: "confirmed", label: "已确认注入", detail: "选择器通过兼容的 thread 生命周期通道完成并记录了注入。" };
    }
    if (entry.applied === false) {
      return { kind: "unconfirmed", label: "已选择 · 未确认注入", detail: "当前是 direct-RPC 通道；下方显示计划注入内容，不代表 Codex 最终已采用。" };
    }
    return { kind: "unknown", label: "旧版绑定 · 状态未知", detail: "存在历史 Profile 记录，但旧数据没有保存注入确认状态。" };
  }

  function renderCurrentProfileView() {
    if (!currentRoot) return;
    currentRoot.replaceChildren();
    const threadId = currentThreadId();
    const entry = threadProfileEntry(threadId);
    const profileId = entry?.profileId || "base";
    const profile = profileById(profileId);
    const proof = threadId && isObject(state.proofByThread?.[threadId])
      ? state.proofByThread[threadId]
      : null;
    const status = currentBindingStatus(entry, threadId);
    currentRenderIdentity = [threadId, profileId, String(entry?.applied), proof?.status || "", state.pendingProfileId].join("|");

    const hero = document.createElement("section");
    hero.className = "current-hero";
    hero.dataset.kind = status.kind;
    const heroTop = document.createElement("div");
    heroTop.className = "current-hero-top";
    const heroText = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "current-eyebrow";
    eyebrow.textContent = threadId ? "当前会话环境" : "当前状态";
    const name = document.createElement("strong");
    name.textContent = profile?.name || profileId || "Base";
    heroText.append(eyebrow, name);
    const badge = document.createElement("span");
    badge.className = "current-status-badge";
    badge.textContent = status.label;
    heroTop.append(heroText, badge);
    const detail = document.createElement("p");
    detail.textContent = status.detail;
    hero.append(heroTop, detail);
    if (threadId) {
      const id = document.createElement("code");
      id.className = "current-thread-id";
      id.textContent = threadId;
      hero.append(id);
    }
    currentRoot.append(hero);

    if (state.pendingProfileId) {
      const pending = document.createElement("section");
      pending.className = "current-pending";
      const pendingLabel = document.createElement("span");
      pendingLabel.textContent = "下个新对话";
      const pendingName = document.createElement("strong");
      pendingName.textContent = profileDisplayName(state.pendingProfileId);
      pending.append(pendingLabel, pendingName);
      currentRoot.append(pending);
    }

    const meta = document.createElement("section");
    meta.className = "current-meta";
    appendMetaRow(meta, "环境 ID", profile?.id || "base");
    appendMetaRow(meta, "模型", profile?.model);
    appendMetaRow(meta, "Provider", profile?.modelProvider);
    appendMetaRow(meta, "推理强度", profile?.config?.model_reasoning_effort);
    appendMetaRow(meta, "审批策略", profile?.approvalPolicy);
    appendMetaRow(meta, "沙箱", profile?.sandbox);
    appendMetaRow(meta, "Service tier", profile?.serviceTier);
    appendMetaRow(meta, "Memory 使用", profile?.memoryPolicy?.use || "继承");
    appendMetaRow(meta, "Memory 生成", profile?.memoryPolicy?.generate || "继承");
    appendMetaRow(meta, "注入证明", proof?.status || (entry ? "无 proof" : "未绑定"));
    appendMetaRow(meta, "传输通道", proof?.transport || entry?.source || "Base");
    currentRoot.append(meta);

    const developerInstructions = typeof profile?.developerInstructions === "string"
      ? profile.developerInstructions
      : "";
    const baseInstructions = typeof profile?.baseInstructions === "string"
      ? profile.baseInstructions
      : "";
    const config = isObject(profile?.config) && Object.keys(profile.config).length
      ? JSON.stringify(profile.config, null, 2)
      : "";
    appendInspectionSection(
      currentRoot,
      `Developer Instructions${developerInstructions ? ` · ${developerInstructions.length} 字符` : ""}`,
      developerInstructions,
      "该 Profile 没有会话级 Developer Instructions。",
      Boolean(developerInstructions),
    );
    appendInspectionSection(
      currentRoot,
      `Base Instructions${baseInstructions ? ` · ${baseInstructions.length} 字符` : ""}`,
      baseInstructions,
      "该 Profile 没有覆盖 Base Instructions。",
    );
    appendInspectionSection(
      currentRoot,
      "环境 Config JSON",
      config,
      "该 Profile 没有额外 config 覆盖。",
    );
    appendInspectionSection(
      currentRoot,
      "Injection Proof",
      proof ? JSON.stringify(proof, null, 2) : "",
      "当前会话没有可验证的注入证明。",
    );

    const note = document.createElement("p");
    note.className = "current-note";
    note.textContent = "这里展示选择器记录和 Profile 计划注入内容；Codex 最终合成的完整系统提示词属于内部运行态，用户脚本无法可靠读取。";
    currentRoot.append(note);
  }

  function createEnvironmentHeading(title, detail) {
    const root = document.createElement("section");
    root.className = "environment-heading";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const description = document.createElement("p");
    description.textContent = detail;
    root.append(heading, description);
    return root;
  }

  function createEnvironmentButton(label, onClick, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "environment-action primary" : "environment-action";
    button.textContent = label;
    button.addEventListener("click", onClick, { signal });
    return button;
  }

  async function copyEnvironmentText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      showToast(successMessage || "已复制");
    } catch {
      showToast("复制失败，请手动选择文本", "error");
    }
  }

  function downloadEnvironmentText(name, text, type = "text/plain") {
    const blob = new Blob([String(text || "")], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderMemoryView() {
    if (!memoryRoot) return;
    memoryRoot.replaceChildren();
    const snapshotMemory = ENVIRONMENT_BUNDLE.environment?.memory || {};
    const memory = bridgeMemory ? { ...snapshotMemory, ...bridgeMemory, settings: snapshotMemory.settings || {} } : snapshotMemory;
    const settings = isObject(memory.settings) ? memory.settings : {};
    const bridgeWritable = bridgeCapabilities?.diskWrite === true;
    memoryRoot.append(createEnvironmentHeading(
      "本地 Codex Memories",
      "查看生成时快照、控制策略，并准备经过审核的修正草案。不会静默改写生成记忆。",
    ));
    const meta = document.createElement("section");
    meta.className = "current-meta";
    appendMetaRow(meta, "总开关", settings.enabled === true ? "已开启" : "已关闭");
    appendMetaRow(meta, "读取记忆", settings.use_memories === false ? "关闭" : settings.use_memories === true ? "开启" : "继承");
    appendMetaRow(meta, "生成记忆", settings.generate_memories === false ? "关闭" : settings.generate_memories === true ? "开启" : "继承");
    appendMetaRow(meta, "外部上下文排除", settings.disable_on_external_context === true ? "开启" : "关闭 / 未设置");
    appendMetaRow(meta, "记忆文件", Array.isArray(memory.files) ? `${memory.files.length} 个` : "未知");
    appendMetaRow(meta, "写入能力", bridgeWritable ? "Bridge 可写 · diff/backup" : "只读快照 / 草案");
    memoryRoot.append(meta);
    appendInspectionSection(memoryRoot, "Memory Summary", memory.summary?.content || "", "没有 memory_summary.md 快照。", true);
    appendInspectionSection(memoryRoot, "Durable MEMORY.md", memory.durable?.content || "", "没有 MEMORY.md 快照。");

    const editor = document.createElement("section");
    editor.className = "environment-editor-card";
    const label = document.createElement("strong");
    label.textContent = "记忆修正草案";
    const help = document.createElement("p");
    help.textContent = "建议只写稳定事实和纠正项；角色、模型、Provider 与任务工作流应留在环境 Profile。";
    const textarea = document.createElement("textarea");
    textarea.className = "environment-editor";
    textarea.placeholder = "例如：\n- 稳定偏好：默认使用简体中文。\n- 纠正：领域记忆只在 cwd/任务匹配时使用。\n- 不要把某个 Profile 的角色推广为全局记忆。";
    textarea.value = String(environmentStore.ui?.memoryCorrectionDraft ?? memory.correction?.content ?? "");
    const actions = document.createElement("div");
    actions.className = "environment-actions";
    const previewStatus = document.createElement("p");
    previewStatus.className = "environment-preview-status";
    let preview = null;
    const commitButton = createEnvironmentButton("确认写入修正 Note", async () => {
      if (!preview) return;
      const expectedHash = preview.before?.hash;
      const result = await bridgeCall("/environment-injector/memory/commit-correction", {
        content: textarea.value,
        ...(typeof expectedHash === "string" ? { expectedHash } : {}),
      });
      if (result?.status === "conflict") {
        previewStatus.textContent = "源文件已变化，请重新预览。";
        previewStatus.dataset.kind = "error";
        commitButton.disabled = true;
        preview = null;
        return;
      }
      if (result?.status !== "ok") {
        previewStatus.textContent = result?.message || "写入失败";
        previewStatus.dataset.kind = "error";
        return;
      }
      delete environmentStore.ui.memoryCorrectionDraft;
      saveEnvironmentStore();
      showToast(`Memory 修正 Note 已写入；备份：${result.backup || "新文件"}`);
      await refreshBridgeState();
      renderMemoryView();
    }, true);
    commitButton.disabled = true;
    actions.append(
      createEnvironmentButton("保存草案", () => {
        environmentStore.ui.memoryCorrectionDraft = textarea.value;
        saveEnvironmentStore();
        showToast("记忆修正草案已保存（尚未写入 Memory）");
      }),
      createEnvironmentButton("复制草案", () => { void copyEnvironmentText(textarea.value, "记忆草案已复制"); }),
      createEnvironmentButton("预览写入", async () => {
        const expectedHash = memory.correction?.hash;
        const result = await bridgeCall("/environment-injector/memory/preview-correction", {
          content: textarea.value,
          ...(typeof expectedHash === "string" ? { expectedHash } : {}),
        });
        preview = result?.status === "ok" ? result : null;
        commitButton.disabled = !preview;
        previewStatus.dataset.kind = result?.status === "ok" ? "success" : "error";
        previewStatus.textContent = result?.status === "ok"
          ? `预览完成：+${result.diff?.addedLines || 0} / -${result.diff?.removedLines || 0} 行；确认后会先备份。`
          : result?.message || "预览失败";
      }),
      commitButton,
      createEnvironmentButton("复制 /memories", () => { void copyEnvironmentText("/memories", "已复制 /memories"); }),
    );
    if (!bridgeWritable) {
      for (const button of [actions.children[2], commitButton]) button.disabled = true;
    }
    editor.append(label, help, textarea, actions, previewStatus);
    memoryRoot.append(editor);
    const note = document.createElement("p");
    note.className = "current-note";
    note.textContent = bridgeWritable
      ? "Memory 写入仅限 Environment Injector 的 ad-hoc 修正 Note；必须先预览，并使用 hash 冲突检查、备份和原子写入。不会直接改写 MEMORY.md 或 raw_memories.md。"
      : "官方建议把这些文件视为生成状态。当前只能安全审阅和保存草案；安装原生 Bridge 后才开放受限写入。";
    memoryRoot.append(note);
  }

  function renderAgentsView() {
    if (!agentsRoot) return;
    agentsRoot.replaceChildren();
    const agents = bridgeAgents || ENVIRONMENT_BUNDLE.environment?.globalAgents || {};
    const bridgeWritable = bridgeCapabilities?.diskWrite === true;
    agentsRoot.append(createEnvironmentHeading(
      "全局 AGENTS.md",
      "用于每个仓库都必须稳定遵守的个人工作规则。项目级规则仍应写在项目自己的 AGENTS.md。",
    ));
    const meta = document.createElement("section");
    meta.className = "current-meta";
    appendMetaRow(meta, "文件", agents.name || "AGENTS.md");
    appendMetaRow(meta, "状态", agents.exists ? "已存在" : "未创建");
    appendMetaRow(meta, "大小", Number.isFinite(agents.size) ? `${agents.size} bytes` : "—");
    appendMetaRow(meta, "内容 Hash", agents.hash || "—");
    appendMetaRow(meta, "写入能力", bridgeWritable ? "Bridge 可写 · diff/backup" : "草案 / 导出");
    agentsRoot.append(meta);

    const editor = document.createElement("section");
    editor.className = "environment-editor-card";
    const label = document.createElement("strong");
    label.textContent = "AGENTS.md 草案";
    const help = document.createElement("p");
    help.textContent = "显式任务和选中环境应优先于泛化记忆；Memories 只作为背景事实。";
    const textarea = document.createElement("textarea");
    textarea.className = "environment-editor tall";
    textarea.value = String(environmentStore.ui?.agentsDraft ?? agents.content ?? "");
    const actions = document.createElement("div");
    actions.className = "environment-actions";
    const previewStatus = document.createElement("p");
    previewStatus.className = "environment-preview-status";
    let preview = null;
    const commitButton = createEnvironmentButton("确认写入 AGENTS.md", async () => {
      if (!preview) return;
      const expectedHash = preview.before?.hash;
      const result = await bridgeCall("/environment-injector/agents/commit", {
        content: textarea.value,
        ...(typeof expectedHash === "string" ? { expectedHash } : {}),
      });
      if (result?.status === "conflict") {
        previewStatus.textContent = "AGENTS.md 已被外部修改，请重新预览。";
        previewStatus.dataset.kind = "error";
        commitButton.disabled = true;
        preview = null;
        return;
      }
      if (result?.status !== "ok") {
        previewStatus.textContent = result?.message || "写入失败";
        previewStatus.dataset.kind = "error";
        return;
      }
      delete environmentStore.ui.agentsDraft;
      saveEnvironmentStore();
      showToast(`AGENTS.md 已写入；备份：${result.backup || "新文件"}`);
      await refreshBridgeState();
      renderAgentsView();
    }, true);
    commitButton.disabled = true;
    actions.append(
      createEnvironmentButton("保存草案", () => {
        environmentStore.ui.agentsDraft = textarea.value;
        saveEnvironmentStore();
        showToast("AGENTS.md 草案已保存（尚未写入磁盘）");
      }),
      createEnvironmentButton("复制", () => { void copyEnvironmentText(textarea.value, "AGENTS.md 草案已复制"); }),
      createEnvironmentButton("导出 AGENTS.md", () => downloadEnvironmentText("AGENTS.md", textarea.value, "text/markdown")),
      createEnvironmentButton("预览写入", async () => {
        const expectedHash = agents.hash;
        const result = await bridgeCall("/environment-injector/agents/preview", {
          content: textarea.value,
          ...(typeof expectedHash === "string" ? { expectedHash } : {}),
        });
        preview = result?.status === "ok" ? result : null;
        commitButton.disabled = !preview;
        previewStatus.dataset.kind = result?.status === "ok" ? "success" : "error";
        previewStatus.textContent = result?.status === "ok"
          ? `预览完成：+${result.diff?.addedLines || 0} / -${result.diff?.removedLines || 0} 行；确认后会先备份。`
          : result?.message || "预览失败";
      }),
      commitButton,
      createEnvironmentButton("恢复当前文件", () => {
        textarea.value = String(agents.content || "");
      }),
    );
    if (!bridgeWritable) {
      for (const button of [actions.children[3], commitButton]) button.disabled = true;
    }
    editor.append(label, help, textarea, actions, previewStatus);
    agentsRoot.append(editor);
    const note = document.createElement("p");
    note.className = "current-note";
    note.textContent = bridgeWritable
      ? "写入固定目标 ~/.codex/AGENTS.md；必须先预览，提交时校验 hash，并创建可恢复备份。"
      : "当前无原生 Bridge，不会直接覆盖 ~/.codex/AGENTS.md；可保存草案或导出。";
    agentsRoot.append(note);
  }

  function tutorialSection(title, paragraphs, open = false) {
    const content = document.createElement("div");
    content.className = "tutorial-section-body";
    for (const paragraph of paragraphs) {
      const item = document.createElement("p");
      item.textContent = paragraph;
      content.append(item);
    }
    return createDisclosureSection(title, content, {
      key: `tutorial:${title}`,
      open,
      meta: `${paragraphs.length} 项`,
      className: "tutorial-section",
    });
  }

  function renderTutorialView() {
    if (!tutorialRoot) return;
    tutorialRoot.replaceChildren();
    tutorialRoot.append(createEnvironmentHeading(
      "环境注入器使用教程",
      "从选择环境到检查 proof，再到 Memories、AGENTS 和恢复操作。所有写入都先预览，避免静默修改。",
    ));

    const quick = document.createElement("section");
    quick.className = "tutorial-quick-start";
    const steps = [
      ["1", "点击新对话", "环境选择器会在 Codex 真正创建 thread 前出现。"],
      ["2", "选择环境", "例如 work；只有这次新会话会收到模型、Provider、提示词和策略。"],
      ["3", "发送第一条消息", "环境注入器拦截 prewarm/thread/start 并等待 app-server 确认。"],
      ["4", "查看当前会话", "确认 applied=true、proof=acknowledged、Thread ID 和实际字段。"],
    ];
    for (const [number, title, detail] of steps) {
      const card = document.createElement("article");
      card.className = "tutorial-step";
      const badge = document.createElement("span");
      badge.textContent = number;
      const copy = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = title;
      const paragraph = document.createElement("p");
      paragraph.textContent = detail;
      copy.append(strong, paragraph);
      card.append(badge, copy);
      quick.append(card);
    }
    tutorialRoot.append(quick);

    tutorialRoot.append(
      tutorialSection("如何创建或修改环境", [
        "打开左侧“环境注入器”，选择已有文件环境，或创建新的本地环境。",
        "可配置模型、Provider、推理强度、Developer/Base Instructions、权限、Service Tier 和 Memory 策略。",
        "编辑文件环境时默认保存为本地覆盖，原 .config.toml 不会被直接改写；点击“恢复文件版本”即可撤销。",
      ], true),
      tutorialSection("如何判断注入是否真的生效", [
        "打开“当前会话”，不要只看环境名称。可靠证据必须同时包含当前 Thread ID、applied=true 和 acknowledged proof。",
        "transport 为 prewarm-thread-start-prototype 或 app-server-request-client-prototype，代表请求已通过真实 app-server 通道。",
        "observed-unconfirmed 只表示检测到了新 thread，不能视为注入成功；failed 会显示最近错误。",
      ]),
      tutorialSection("Memories 应该怎么用", [
        "Memories 适合稳定事实和偏好，不适合保存某个环境的角色、模型、Provider 或临时工作流。",
        "环境需要隔离时，将 Memory 读取和生成设为 off；例如可为 work 环境创建这种本地覆盖。",
        "Memory 页面只允许写入 Environment Injector 的 ad-hoc 修正 Note，不会直接重写生成的 MEMORY.md、memory_summary.md 或 raw_memories.md。",
      ]),
      tutorialSection("AGENTS.md、预览和恢复", [
        "AGENTS.md 用于所有项目都应遵守的稳定工作规则；项目特定规则仍写在项目自己的 AGENTS.md。",
        "点击“预览写入”后才会解锁确认按钮。提交时会校验 expected hash、创建备份并原子写入。",
        "如果显示 conflict，说明文件被外部修改；重新加载并再次预览，不要强行覆盖。备份可通过 bridge 的 backup/restore 路由恢复。",
      ]),
      tutorialSection("常见故障", [
        "没有弹出选择器：确认“新对话创建前询问”已开启，并检查旧 Profile 脚本是否仍被启用。",
        "显示未确认注入：重新打开新对话并发送第一条消息；检查 direct-RPC 适配器和 requestTrace。",
        "Memory/AGENTS 只能保存草案：说明原生 Bridge 未加载，应检查 capabilities 中 diskWrite 是否为 true。",
        "遇到 RpcTarget.sendRequest 错误：不要给 RpcTarget 实例赋值；环境注入器应只显示原型级适配器。",
      ]),
    );

    const actions = document.createElement("div");
    actions.className = "environment-actions tutorial-actions";
    actions.append(
      createEnvironmentButton("打开环境编辑器", () => window.__codexEnvironmentStudio?.open?.(), true),
      createEnvironmentButton("查看当前会话", () => setPanelMode("current")),
      createEnvironmentButton("复制诊断 JSON", () => { void copyEnvironmentText(JSON.stringify(publicStatus(), null, 2), "诊断已复制"); }),
    );
    tutorialRoot.append(actions);
  }

  function applyDialogExpanded() {
    if (dialogCard) dialogCard.dataset.expanded = String(dialogExpanded);
    if (panelExpandButton) {
      panelExpandButton.textContent = dialogExpanded ? "↙" : "↗";
      panelExpandButton.setAttribute("aria-label", dialogExpanded ? "恢复面板大小" : "最大化面板");
      panelExpandButton.title = dialogExpanded ? "恢复面板大小" : "最大化面板";
    }
  }

  function toggleDialogExpanded() {
    dialogExpanded = !dialogExpanded;
    environmentStore.ui.panelExpanded = dialogExpanded;
    saveEnvironmentStore();
    applyDialogExpanded();
  }

  function setPanelMode(mode) {
    panelMode = ["current", "memory", "agents", "tutorial"].includes(mode) ? mode : "select";
    if (dialogCard) dialogCard.dataset.mode = panelMode;
    if (selectTab) selectTab.dataset.active = String(panelMode === "select");
    if (currentTab) currentTab.dataset.active = String(panelMode === "current");
    if (memoryTab) memoryTab.dataset.active = String(panelMode === "memory");
    if (agentsTab) agentsTab.dataset.active = String(panelMode === "agents");
    if (tutorialTab) tutorialTab.dataset.active = String(panelMode === "tutorial");
    if (optionsRoot) optionsRoot.hidden = panelMode !== "select";
    if (currentRoot) currentRoot.hidden = panelMode !== "current";
    if (memoryRoot) memoryRoot.hidden = panelMode !== "memory";
    if (agentsRoot) agentsRoot.hidden = panelMode !== "agents";
    if (tutorialRoot) tutorialRoot.hidden = panelMode !== "tutorial";
    if (panelFooter) panelFooter.hidden = panelMode !== "select";
    const titles = {
      select: selectionTitle,
      current: "当前会话环境",
      memory: "Memories",
      agents: "AGENTS.md",
      tutorial: "使用教程",
    };
    const subtitles = {
      select: "选择只影响即将创建的对话",
      current: "查看绑定状态、计划注入与证明",
      memory: "审阅本地记忆策略与修正草案",
      agents: "维护稳定的全局工作规则草案",
      tutorial: "快速上手、证明判定与安全恢复",
    };
    if (panelTitle) panelTitle.textContent = titles[panelMode];
    if (panelSubtitle) panelSubtitle.textContent = subtitles[panelMode];
    if (panelMode === "current") renderCurrentProfileView();
    if (panelMode === "memory") renderMemoryView();
    if (panelMode === "agents") renderAgentsView();
    if (panelMode === "tutorial") renderTutorialView();
  }

  function chooseProfile(title = "选择环境") {
    if (uiAdapter?.chooseProfile) {
      return Promise.resolve(uiAdapter.chooseProfile(title, uiSnapshot()));
    }
    if (activeChooser) return activeChooser.promise;
    selectionTitle = title;
    renderProfileOptions();
    setPanelMode("select");
    if (promptCheckbox) promptCheckbox.checked = state.promptOnNewThread;
    if (panel) panel.hidden = false;
    let resolveChooser;
    const promise = new Promise((resolve) => {
      resolveChooser = resolve;
    });
    activeChooser = { promise, resolve: resolveChooser };
    window.setTimeout(() => {
      const preferred = optionsRoot?.querySelector('.profile-option[data-selected="true"]')
        || optionsRoot?.querySelector(".profile-option");
      preferred?.focus();
    }, 0);
    return promise;
  }

  function openEnvironmentView(mode, focusTarget) {
    if (uiAdapter?.open) {
      uiAdapter.open(mode, uiSnapshot());
      return Promise.resolve(null);
    }
    const alreadyOpen = activeChooser?.promise || null;
    const promise = alreadyOpen || chooseProfile("环境注入器");
    setPanelMode(mode);
    window.setTimeout(() => focusTarget?.focus(), 0);
    if (!alreadyOpen) {
      void promise.then((selected) => {
        if (!selected) return;
        setPendingProfile(selected);
        showToast(`下个新对话：${profileDisplayName(selected)}`);
      });
    }
    return promise;
  }

  function openCurrentProfileView() {
    return openEnvironmentView("current", currentTab);
  }

  function openMemoryView() {
    return openEnvironmentView("memory", memoryTab);
  }

  function openAgentsView() {
    return openEnvironmentView("agents", agentsTab);
  }

  function openTutorialView() {
    return openEnvironmentView("tutorial", tutorialTab);
  }

  function createUi() {
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483000";
    host.style.pointerEvents = "none";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; }
      .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2; pointer-events: auto; appearance: none; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 999px; padding: 7px 11px; background: color-mix(in srgb, var(--color-surface, Canvas) 94%, transparent); color: var(--color-text, CanvasText); font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.18); cursor: pointer; backdrop-filter: blur(14px); transition: transform .16s ease, border-color .16s ease, background .16s ease; }
      .pill:hover { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 60%, transparent); transform: translateY(-1px); }
      .panel { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 16px; pointer-events: auto; background: rgba(0,0,0,.42); backdrop-filter: blur(3px); animation: cps-backdrop-in .16s ease-out; }
      .panel[hidden], .toast[hidden] { display: none; }
      .dialog { width: min(440px, calc(100vw - 24px)); max-height: min(760px, calc(100vh - 32px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 18px; background: color-mix(in srgb, var(--color-surface, Canvas) 98%, transparent); color: var(--color-text, CanvasText); box-shadow: 0 24px 80px rgba(0,0,0,.38), 0 2px 10px rgba(0,0,0,.18); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; animation: cps-dialog-in .18s cubic-bezier(.2,.8,.2,1); transition: width .18s ease, height .18s ease, max-height .18s ease, border-radius .18s ease; }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 14px 16px 11px; border-bottom: 1px solid color-mix(in srgb, CanvasText 9%, transparent); }
      .header-copy { min-width: 0; }
      .header strong { display: block; font-size: 16px; line-height: 22px; font-weight: 650; letter-spacing: -.01em; }
      .header small { display: block; margin-top: 2px; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 11px; line-height: 15px; }
      .header-actions { flex: none; display: flex; align-items: center; gap: 4px; }
      .close { width: 28px; height: 28px; flex: none; display: grid; place-items: center; appearance: none; border: 0; border-radius: 8px; background: transparent; color: color-mix(in srgb, CanvasText 68%, transparent); font-size: 20px; line-height: 1; cursor: pointer; }
      .panel-expand { font-size: 16px; font-weight: 700; }
      .close:hover, .close:focus-visible { background: color-mix(in srgb, CanvasText 8%, transparent); color: CanvasText; outline: none; }
      .tabs { display: flex; align-items: center; gap: 3px; padding: 6px 8px 0; }
      .tab { appearance: none; border: 0; border-radius: 8px; padding: 6px 9px; background: transparent; color: color-mix(in srgb, CanvasText 58%, transparent); font: 600 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
      .tab:hover, .tab:focus-visible { background: color-mix(in srgb, CanvasText 6%, transparent); color: CanvasText; outline: none; }
      .tab[data-active="true"] { background: color-mix(in srgb, CanvasText 9%, transparent); color: CanvasText; }
      .dialog:not([data-mode="select"]) { width: min(920px, calc(100vw - 24px)); height: min(820px, calc(100vh - 32px)); }
      .dialog[data-expanded="true"] { width: calc(100vw - 24px) !important; height: calc(100vh - 24px) !important; max-height: none; border-radius: 14px; }
      .options[hidden], .current-view[hidden], .memory-view[hidden], .agents-view[hidden], .tutorial-view[hidden], .footer[hidden] { display: none; }
      .options { min-height: 0; flex: 1 1 auto; display: grid; align-content: start; gap: 5px; padding: 10px; overflow-y: auto; overscroll-behavior: contain; }
      .current-view, .memory-view, .agents-view, .tutorial-view { min-height: 0; flex: 1 1 auto; display: grid; align-content: start; gap: 8px; padding: 10px 12px 12px; overflow-y: auto; overscroll-behavior: contain; }
      .current-view { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .current-view > :not(.current-section) { grid-column: 1 / -1; }
      .current-view > .current-section[data-open="true"] { grid-column: 1 / -1; }
      .environment-heading { display: grid; gap: 4px; padding: 2px 2px 4px; }
      .environment-heading strong { font-size: 14px; line-height: 20px; }
      .environment-heading p, .environment-editor-card p { margin: 0; color: color-mix(in srgb, CanvasText 56%, transparent); font-size: 10px; line-height: 16px; }
      .environment-editor-card { display: grid; gap: 8px; padding: 12px; border: 1px solid color-mix(in srgb, CanvasText 9%, transparent); border-radius: 11px; background: color-mix(in srgb, CanvasText 2.5%, transparent); }
      .environment-editor-card > strong { font-size: 12px; line-height: 17px; }
      .environment-editor { width: 100%; min-height: 130px; resize: vertical; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 9px; padding: 10px; background: color-mix(in srgb, CanvasText 2%, transparent); color: CanvasText; outline: none; font: 10px/16px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .environment-editor.tall { min-height: clamp(170px, 30vh, 260px); }
      .environment-editor:focus { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 58%, transparent); }
      .environment-actions { display: flex; flex-wrap: wrap; gap: 7px; }
      .environment-action { appearance: none; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 8px; padding: 6px 9px; background: color-mix(in srgb, CanvasText 4%, transparent); color: CanvasText; font: 600 10px/15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
      .environment-action:hover, .environment-action:focus-visible { background: color-mix(in srgb, CanvasText 8%, transparent); outline: none; }
      .environment-action.primary { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 55%, transparent); background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 14%, transparent); }
      .environment-action:disabled { cursor: not-allowed; opacity: .38; }
      .environment-preview-status { min-height: 16px; margin: 0; color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; line-height: 15px; }
      .environment-preview-status[data-kind="success"] { color: #3fbf88; }
      .environment-preview-status[data-kind="error"] { color: #ef6b73; }
      .tutorial-quick-start { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .tutorial-step { min-width: 0; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 9px; align-items: start; padding: 10px; border: 1px solid color-mix(in srgb, CanvasText 9%, transparent); border-radius: 10px; background: color-mix(in srgb, CanvasText 2.5%, transparent); }
      .tutorial-step > span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 16%, transparent); color: var(--color-token-primary, #3b82f6); font-size: 11px; font-weight: 750; }
      .tutorial-step > div { min-width: 0; display: grid; gap: 2px; }
      .tutorial-step strong { font-size: 11px; line-height: 16px; }
      .tutorial-step p, .tutorial-section-body p { margin: 0; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 10px; line-height: 16px; }
      .tutorial-section-body { display: grid; gap: 7px; padding: 10px 11px 11px; }
      .tutorial-actions { position: sticky; bottom: -16px; padding: 10px 0 2px; background: linear-gradient(transparent, color-mix(in srgb, var(--color-surface, Canvas) 98%, transparent) 32%); }
      .current-hero { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 12px; background: color-mix(in srgb, CanvasText 3%, transparent); }
      .current-hero-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
      .current-hero-top > div { min-width: 0; display: grid; gap: 2px; }
      .current-eyebrow { color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; line-height: 14px; }
      .current-hero strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; line-height: 20px; font-weight: 650; }
      .current-hero p { margin: 0; color: color-mix(in srgb, CanvasText 64%, transparent); font-size: 11px; line-height: 17px; }
      .current-status-badge { flex: none; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, CanvasText 7%, transparent); color: color-mix(in srgb, CanvasText 72%, transparent); font-size: 10px; line-height: 15px; font-weight: 650; }
      .current-hero[data-kind="confirmed"] .current-status-badge { background: color-mix(in srgb, #22a06b 15%, transparent); color: #3fbf88; }
      .current-hero[data-kind="unconfirmed"] .current-status-badge, .current-hero[data-kind="unknown"] .current-status-badge { background: color-mix(in srgb, #d99124 16%, transparent); color: #d99124; }
      .current-hero[data-kind="draft"] .current-status-badge { background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 14%, transparent); color: var(--color-token-primary, #3b82f6); }
      .current-thread-id { width: fit-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, CanvasText 54%, transparent); font: 10px/14px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .current-pending { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 11px; border-radius: 10px; background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 8%, transparent); font-size: 11px; }
      .current-pending span { color: color-mix(in srgb, CanvasText 56%, transparent); }
      .current-pending strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .current-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
      .current-meta-row { min-width: 0; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; border: 1px solid color-mix(in srgb, CanvasText 8%, transparent); border-radius: 9px; }
      .current-meta-row span { color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; }
      .current-meta-row code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: CanvasText; font: 10px/14px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .current-section { border: 1px solid color-mix(in srgb, CanvasText 9%, transparent); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, CanvasText 1.5%, transparent); }
      .current-section-trigger { width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 12px; appearance: none; border: 0; padding: 9px 11px; color: color-mix(in srgb, CanvasText 78%, transparent); background: color-mix(in srgb, CanvasText 3%, transparent); text-align: left; font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; user-select: none; }
      .current-section-trigger:hover, .current-section-trigger:focus-visible { background: color-mix(in srgb, CanvasText 7%, transparent); color: CanvasText; outline: none; }
      .current-section-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .current-section-end { flex: none; display: inline-flex; align-items: center; gap: 7px; }
      .current-section-meta { color: color-mix(in srgb, CanvasText 45%, transparent); font-size: 9px; line-height: 14px; font-weight: 500; }
      .current-section-chevron { display: inline-block; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 15px; line-height: 14px; transform: rotate(-90deg); transform-origin: center; transition: transform .16s ease; }
      .current-section[data-open="true"] .current-section-chevron { transform: rotate(0deg); }
      .current-section-body[hidden] { display: none; }
      .current-section-body { border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); animation: cps-disclosure-in .14s ease-out; }
      .current-section pre { max-height: min(42vh, 360px); margin: 0; padding: 11px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: color-mix(in srgb, CanvasText 2%, transparent); color: color-mix(in srgb, CanvasText 82%, transparent); font: 10px/16px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .current-section pre[data-empty="true"] { color: color-mix(in srgb, CanvasText 45%, transparent); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .current-note { margin: 0; color: color-mix(in srgb, CanvasText 48%, transparent); font-size: 10px; line-height: 16px; }
      .profile-option { width: 100%; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; appearance: none; border: 1px solid transparent; border-radius: 11px; background: transparent; color: inherit; text-align: left; cursor: pointer; transition: border-color .14s ease, background .14s ease, transform .14s ease; }
      .profile-option:hover, .profile-option:focus-visible { border-color: color-mix(in srgb, CanvasText 11%, transparent); background: color-mix(in srgb, CanvasText 6%, transparent); outline: none; }
      .profile-option:active { transform: scale(.995); }
      .profile-option[data-selected="true"] { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 52%, transparent); background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 11%, transparent); }
      .profile-option-text { min-width: 0; display: grid; gap: 3px; }
      .profile-option-text strong, .profile-option-text small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-option-text strong { font-size: 13px; line-height: 18px; font-weight: 600; }
      .profile-option-text small { color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 11px; line-height: 16px; }
      .profile-check { width: 22px; height: 22px; flex: none; display: grid; place-items: center; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 50%; color: transparent; font-size: 12px; font-weight: 800; }
      .profile-option[data-selected="true"] .profile-check { border-color: var(--color-token-primary, #3b82f6); background: var(--color-token-primary, #3b82f6); color: white; }
      .footer { display: grid; gap: 8px; padding: 12px 16px 15px; border-top: 1px solid color-mix(in srgb, CanvasText 9%, transparent); background: color-mix(in srgb, CanvasText 2.5%, transparent); }
      .toggle { display: flex; align-items: center; gap: 8px; width: fit-content; color: color-mix(in srgb, CanvasText 78%, transparent); font-size: 12px; cursor: pointer; }
      .toggle input { margin: 0; accent-color: var(--color-token-primary, #3b82f6); }
      .hint { color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; line-height: 15px; }
      .toast { position: fixed; right: 16px; bottom: 56px; z-index: 4; max-width: 340px; padding: 8px 10px; border-radius: 9px; background: #111827; color: #fff; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.28); }
      .toast[data-kind="error"] { background: #991b1b; }
      @keyframes cps-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cps-dialog-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes cps-disclosure-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
      @media (max-width: 760px) { .current-view { grid-template-columns: 1fr; } .current-view > .current-section { grid-column: 1; } .current-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 560px) { .panel { padding: 8px; } .dialog { width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 14px; } .dialog:not([data-mode="select"]), .dialog[data-expanded="true"] { width: calc(100vw - 16px) !important; height: calc(100vh - 16px) !important; } .header { padding: 11px 12px 9px; } .tabs { overflow-x: auto; padding-inline: 6px; } .options { padding: 7px; } .current-view, .memory-view, .agents-view, .tutorial-view { padding: 8px; } .current-meta, .tutorial-quick-start { grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { .panel, .dialog, .pill, .profile-option, .current-section-body { animation: none; transition: none; } .current-section-chevron { transition: none; } }
    `;

    pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pill";
    pill.addEventListener("click", async () => {
      const selected = await chooseProfile("下个新对话环境");
      if (!selected) return;
      setPendingProfile(selected);
      showToast(`下个新对话：${profileDisplayName(selected)}`);
    }, { signal });

    panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    dialogCard = document.createElement("section");
    dialogCard.className = "dialog";
    dialogCard.setAttribute("role", "dialog");
    dialogCard.setAttribute("aria-modal", "true");
    dialogCard.setAttribute("aria-label", "环境注入器");
    const header = document.createElement("div");
    header.className = "header";
    const headerCopy = document.createElement("div");
    headerCopy.className = "header-copy";
    panelTitle = document.createElement("strong");
    panelTitle.textContent = "环境注入器";
    panelSubtitle = document.createElement("small");
    panelSubtitle.textContent = "选择只影响即将创建的对话";
    headerCopy.append(panelTitle, panelSubtitle);
    const headerActions = document.createElement("div");
    headerActions.className = "header-actions";
    panelExpandButton = document.createElement("button");
    panelExpandButton.type = "button";
    panelExpandButton.className = "close panel-expand";
    panelExpandButton.addEventListener("click", toggleDialogExpanded, { signal });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => closeChooser(null), { signal });
    headerActions.append(panelExpandButton, close);
    header.append(headerCopy, headerActions);
    header.addEventListener("dblclick", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("button")) toggleDialogExpanded();
    }, { signal });
    applyDialogExpanded();

    const tabs = document.createElement("div");
    tabs.className = "tabs";
    selectTab = document.createElement("button");
    selectTab.type = "button";
    selectTab.className = "tab";
    selectTab.textContent = "选择环境";
    selectTab.addEventListener("click", () => setPanelMode("select"), { signal });
    currentTab = document.createElement("button");
    currentTab.type = "button";
    currentTab.className = "tab";
    currentTab.textContent = "当前会话";
    currentTab.addEventListener("click", () => setPanelMode("current"), { signal });
    memoryTab = document.createElement("button");
    memoryTab.type = "button";
    memoryTab.className = "tab";
    memoryTab.textContent = "Memories";
    memoryTab.addEventListener("click", () => setPanelMode("memory"), { signal });
    agentsTab = document.createElement("button");
    agentsTab.type = "button";
    agentsTab.className = "tab";
    agentsTab.textContent = "AGENTS.md";
    agentsTab.addEventListener("click", () => setPanelMode("agents"), { signal });
    tutorialTab = document.createElement("button");
    tutorialTab.type = "button";
    tutorialTab.className = "tab";
    tutorialTab.textContent = "教程";
    tutorialTab.addEventListener("click", () => setPanelMode("tutorial"), { signal });
    tabs.append(selectTab, currentTab, memoryTab, agentsTab, tutorialTab);

    optionsRoot = document.createElement("div");
    optionsRoot.className = "options";
    currentRoot = document.createElement("div");
    currentRoot.className = "current-view";
    currentRoot.hidden = true;
    memoryRoot = document.createElement("div");
    memoryRoot.className = "memory-view";
    memoryRoot.hidden = true;
    agentsRoot = document.createElement("div");
    agentsRoot.className = "agents-view";
    agentsRoot.hidden = true;
    tutorialRoot = document.createElement("div");
    tutorialRoot.className = "tutorial-view";
    tutorialRoot.hidden = true;
    panelFooter = document.createElement("div");
    panelFooter.className = "footer";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    promptCheckbox = document.createElement("input");
    promptCheckbox.type = "checkbox";
    promptCheckbox.checked = state.promptOnNewThread;
    promptCheckbox.addEventListener("change", () => {
      state.promptOnNewThread = promptCheckbox.checked;
      saveState();
    }, { signal });
    const toggleText = document.createElement("span");
    toggleText.textContent = "新对话创建前询问";
    toggle.append(promptCheckbox, toggleText);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "仅写入本次 thread/start/resume，不修改全局 config.toml。";
    panelFooter.append(toggle, hint);
    dialogCard.append(header, tabs, optionsRoot, currentRoot, memoryRoot, agentsRoot, tutorialRoot, panelFooter);
    setPanelMode("select");
    panel.append(dialogCard);
    panel.addEventListener("pointerdown", (event) => {
      if (event.target === panel) closeChooser(null);
    }, { signal });

    toastNode = document.createElement("div");
    toastNode.className = "toast";
    toastNode.hidden = true;

    shadow.append(style, panel, toastNode, pill);
    document.documentElement.append(host);
    updatePill();
  }

  function newChatTrigger(node) {
    if (!(node instanceof Element) || host?.contains(node) || uiAdapter?.contains?.(node)) return null;
    const target = node.closest('button,a,[role="button"]');
    if (!(target instanceof Element) || host?.contains(target) || uiAdapter?.contains?.(target)) return null;
    const text = [
      target.getAttribute("aria-label"),
      target.getAttribute("title"),
      target.getAttribute("data-testid"),
      target.textContent,
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
    if (/(^|\s)(new chat|new thread|new conversation)(\s|$)/i.test(text)) return target;
    if (/(新建对话|新对话|新建会话|新会话)/u.test(text)) return target;
    return null;
  }

  async function interceptNewChat(event) {
    const target = newChatTrigger(event.target);
    if (!target || replayTargets.has(target) || !state.promptOnNewThread) return;
    // A pending Profile is merely the preselected option. Newer direct-RPC
    // Codex builds may retain it across drafts, so it must never suppress the
    // explicit "ask before every new conversation" behavior.
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = await chooseProfile("为新对话选择环境");
    if (!selected || destroyed) return;
    pendingThreadObservation = {
      profileId: validProfileId(selected),
      previousThreadId: currentThreadId(),
      at: Date.now(),
    };
    setPendingProfile(selected);
    replayTargets.add(target);
    try {
      target.click();
      for (const delay of [0, 250, 900]) {
        window.setTimeout(() => { void scanClients(); }, delay);
      }
    } finally {
      window.setTimeout(() => replayTargets.delete(target), 0);
    }
  }

  function deepMerge(base, overlay) {
    if (!isObject(base)) base = {};
    const result = { ...base };
    for (const [key, value] of Object.entries(overlay || {})) {
      result[key] = isObject(value) && isObject(result[key])
        ? deepMerge(result[key], value)
        : value;
    }
    return result;
  }

  function applyProfileToParams(params, profile) {
    if (!profile || profile.id === "base" || !isObject(params)) return params;
    const next = { ...params };
    if (isObject(profile.config) && Object.keys(profile.config).length > 0) {
      next.config = deepMerge(isObject(next.config) ? next.config : {}, profile.config);
    }
    if (isObject(profile.memoryPolicy)) {
      const memoryOverrides = {};
      if (profile.memoryPolicy.use === "on" || profile.memoryPolicy.use === "off") {
        memoryOverrides.use_memories = profile.memoryPolicy.use === "on";
      }
      if (profile.memoryPolicy.generate === "on" || profile.memoryPolicy.generate === "off") {
        memoryOverrides.generate_memories = profile.memoryPolicy.generate === "on";
      }
      if (Object.keys(memoryOverrides).length) {
        next.config = deepMerge(isObject(next.config) ? next.config : {}, { memories: memoryOverrides });
      }
    }
    if (profile.model) next.model = profile.model;
    if (profile.modelProvider) next.modelProvider = profile.modelProvider;
    if (typeof profile.developerInstructions === "string") {
      next.developerInstructions = profile.developerInstructions;
    }
    if (typeof profile.baseInstructions === "string") {
      next.baseInstructions = profile.baseInstructions;
    }
    const hasUnifiedPermissions = Object.hasOwn(next, "permissions") && next.permissions != null;
    if (profile.approvalPolicy && !hasUnifiedPermissions) next.approvalPolicy = profile.approvalPolicy;
    if (profile.sandbox && !hasUnifiedPermissions) next.sandbox = profile.sandbox;
    if (profile.serviceTier) next.serviceTier = profile.serviceTier;
    return next;
  }

  function markInjectedParams(params) {
    if (!isObject(params)) return params;
    try {
      Object.defineProperty(params, INJECTED_PARAMS_MARK, { value: true, configurable: true });
    } catch {}
    return params;
  }

  function injectedFieldsFromParams(before, after) {
    const fields = [];
    for (const key of [
      "config",
      "model",
      "modelProvider",
      "developerInstructions",
      "baseInstructions",
      "approvalPolicy",
      "sandbox",
      "serviceTier",
    ]) {
      if (!Object.hasOwn(after || {}, key)) continue;
      let same = false;
      try { same = JSON.stringify(before?.[key]) === JSON.stringify(after?.[key]); } catch {}
      if (!same) fields.push(key);
    }
    return fields;
  }

  function canonicalizeForDigest(value) {
    if (Array.isArray(value)) return value.map(canonicalizeForDigest);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeForDigest(value[key])]));
  }

  async function profilePayloadDigest(profile) {
    try {
      const encoded = new TextEncoder().encode(JSON.stringify(canonicalizeForDigest({
        id: profile?.id || "base",
        model: profile?.model || "",
        modelProvider: profile?.modelProvider || "",
        config: profile?.config || {},
        developerInstructions: profile?.developerInstructions || "",
        baseInstructions: profile?.baseInstructions || "",
        approvalPolicy: profile?.approvalPolicy || "",
        sandbox: profile?.sandbox || "",
        serviceTier: profile?.serviceTier || "",
        memoryPolicy: profile?.memoryPolicy || {},
      })));
      const digest = await crypto.subtle.digest("SHA-256", encoded);
      return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
  }

  function recordThreadProof(threadId, proof) {
    const id = normalizedThreadId(threadId);
    if (!id) return "";
    const proofId = String(proof.proofId || `proof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    state.proofByThread[id] = {
      proofId,
      profileId: validProfileId(proof.profileId),
      profileRevision: Number(environmentStore.revision || 0),
      status: String(proof.status || "acknowledged"),
      method: String(proof.method || ""),
      transport: String(proof.transport || ""),
      fields: Array.isArray(proof.fields) ? proof.fields.map(String) : [],
      payloadDigest: proof.payloadDigest || null,
      dispatchedAt: proof.dispatchedAt || null,
      acknowledgedAt: proof.acknowledgedAt || null,
    };
    const entries = Object.entries(state.proofByThread)
      .sort((left, right) => String(right[1]?.acknowledgedAt || right[1]?.dispatchedAt || "").localeCompare(String(left[1]?.acknowledgedAt || left[1]?.dispatchedAt || "")))
      .slice(0, MAX_THREAD_ENTRIES);
    state.proofByThread = Object.fromEntries(entries);
    return proofId;
  }

  function requestDescriptor(method, params) {
    const rawMethod = String(method || "");
    if (["thread/start", "thread/resume", "thread/fork"].includes(rawMethod)) {
      return { kind: rawMethod, params, rebuild: (value) => value, prewarm: false };
    }
    if (["start-conversation", "start-thread-for-host"].includes(rawMethod)) {
      return { kind: "thread/start", params, rebuild: (value) => value, prewarm: false };
    }
    if (["thread-prewarm-start", "prewarm-thread-start-for-host"].includes(rawMethod)) {
      return { kind: "thread/start", params, rebuild: (value) => value, prewarm: true };
    }
    if (rawMethod === "send-cli-request-for-host" && isObject(params)) {
      const innerMethod = String(params.method || "");
      if (!["thread/start", "thread/resume", "thread/fork"].includes(innerMethod)) return null;
      if (isObject(params.params)) {
        return {
          kind: innerMethod,
          params: params.params,
          rebuild: (value) => ({ ...params, params: value }),
          prewarm: false,
        };
      }
    }
    return null;
  }

  function dispatcherRequestDescriptor(type, payload) {
    const rawType = String(type || "");
    if (rawType === "fetch") {
      const url = typeof ownValue(payload, "url") === "string" ? ownValue(payload, "url") : "";
      const prefix = "vscode://codex/";
      const body = parsedFetchBody(payload);
      if (url.startsWith(prefix) && body.value) {
        const requestType = url.slice(prefix.length).split(/[?#]/, 1)[0];
        const inner = requestDescriptor(requestType, body.value);
        if (inner) {
          return {
            kind: inner.kind,
            params: inner.params,
            rebuild: (value) => {
              const nextBody = inner.rebuild(value);
              return { ...payload, body: body.wasString ? JSON.stringify(nextBody) : nextBody };
            },
            prewarm: inner.prewarm,
          };
        }
      }
    }
    if (["thread/start", "thread/resume", "thread/fork"].includes(rawType)) {
      return { kind: rawType, params: payload, rebuild: (value) => value, prewarm: false };
    }
    if (["start-conversation", "start-thread-for-host"].includes(rawType)) {
      return { kind: "thread/start", params: payload, rebuild: (value) => value, prewarm: false };
    }
    if (rawType === "prewarm-thread-start-for-host" && isObject(payload?.params)) {
      return { kind: "thread/start", params: payload.params, rebuild: (value) => ({ ...payload, params: value }), prewarm: true };
    }
    if (rawType === "thread-prewarm-start" && isObject(payload?.request?.params)) {
      return {
        kind: "thread/start",
        params: payload.request.params,
        rebuild: (value) => ({ ...payload, request: { ...payload.request, params: value } }),
        prewarm: true,
      };
    }
    if (rawType === "send-cli-request-for-host" && isObject(payload)) {
      const innerMethod = String(payload.method || "");
      if (["thread/start", "thread/resume", "thread/fork"].includes(innerMethod) && isObject(payload.params)) {
        return { kind: innerMethod, params: payload.params, rebuild: (value) => ({ ...payload, params: value }), prewarm: false };
      }
    }
    if (["mcp-request", "worker-request"].includes(rawType) && isObject(payload?.request)) {
      const innerMethod = String(payload.request.method || "");
      if (["thread/start", "thread/resume", "thread/fork"].includes(innerMethod) && isObject(payload.request.params)) {
        return {
          kind: innerMethod,
          params: payload.request.params,
          rebuild: (value) => ({ ...payload, request: { ...payload.request, params: value } }),
          prewarm: false,
        };
      }
    }
    return null;
  }

  function prepareDispatcherRequest(type, payload) {
    const descriptor = dispatcherRequestDescriptor(type, payload);
    if (!descriptor || descriptor.prewarm || descriptor.params?.[INJECTED_PARAMS_MARK] === true) return null;
    let profileId = "";
    if (descriptor.kind === "thread/start") {
      profileId = state.pendingProfileId || "base";
    } else if (descriptor.kind === "thread/resume") {
      profileId = threadProfileId(descriptor.params?.threadId);
      if (!profileId) return null;
    } else if (descriptor.kind === "thread/fork") {
      profileId = threadProfileId(descriptor.params?.threadId) || state.pendingProfileId || "base";
    }
    const profile = profileById(profileId || "base");
    const patchedParams = applyProfileToParams(descriptor.params, profile);
    return {
      descriptor,
      profile,
      payload: descriptor.rebuild(patchedParams),
      bindOnStarted: descriptor.kind === "thread/start" || descriptor.kind === "thread/fork",
    };
  }

  function turnStartThreadId(type, payload) {
    const rawType = String(type || "");
    if (rawType === "turn/start") {
      return normalizedThreadId(ownValue(payload, "threadId") || ownValue(payload, "conversationId"));
    }
    if (["mcp-request", "worker-request"].includes(rawType)) {
      const request = ownValue(payload, "request");
      if (ownValue(request, "method") !== "turn/start") return "";
      const params = ownValue(request, "params");
      return normalizedThreadId(ownValue(params, "threadId") || ownValue(params, "conversationId"));
    }
    return "";
  }

  function observePendingProfileForTurn(type, payload) {
    const pending = pendingThreadObservation;
    if (!pending) return;
    if (Date.now() - pending.at > 2 * 60_000) {
      pendingThreadObservation = null;
      return;
    }
    const threadId = turnStartThreadId(type, payload);
    if (!threadId || threadId === pending.previousThreadId) return;
    pendingThreadObservation = null;
    const existing = threadProfileEntry(threadId);
    if (existing?.profileId === pending.profileId) {
      consumePendingProfile(pending.profileId);
      showToast(existing.applied === true
        ? `环境已确认：${profileDisplayName(pending.profileId)}`
        : `已记录会话环境：${profileDisplayName(pending.profileId)}（未确认注入）`);
      return;
    }
    if (!existing) {
      bindThreadProfile(threadId, pending.profileId, { applied: false, source: "direct-rpc-turn-start" });
      consumePendingProfile(pending.profileId);
      showToast(`已记录会话环境：${profileDisplayName(pending.profileId)}（未确认注入）`);
      traceRequest("direct-rpc-thread-observed", { threadId, profileId: pending.profileId });
    }
  }

  function findThreadId(value) {
    const queue = [{ value, depth: 0 }];
    const seen = new WeakSet();
    while (queue.length) {
      const item = queue.shift();
      const candidate = item?.value;
      if (!candidate || typeof candidate !== "object") continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const direct = normalizedThreadId(
        candidate.threadId
        || candidate.conversationId
        || candidate.thread?.id
        || candidate.params?.threadId
        || candidate.params?.thread?.id
      );
      if (direct) return direct;
      if (item.depth >= 5) continue;
      for (const key of ["result", "response", "data", "payload", "params", "thread"]) {
        if (candidate[key] && typeof candidate[key] === "object") {
          queue.push({ value: candidate[key], depth: item.depth + 1 });
        }
      }
    }
    return "";
  }

  function handleThreadStarted(payload) {
    const pending = pendingStartBinding;
    if (!pending) return;
    if (Date.now() - pending.at > 60_000) {
      pendingStartBinding = null;
      return;
    }
    const threadId = findThreadId(payload) || findThreadId({ params: payload });
    if (!threadId) return;
    bindThreadProfile(threadId, pending.profileId, { applied: true, source: "dispatcher-thread-started" });
    if (pending.kind === "thread/start") consumePendingProfile(pending.profileId);
    showToast(`会话环境：${pending.profileName}`);
    traceRequest("thread-started", { kind: pending.kind, profileId: pending.profileId, threadId });
    pendingStartBinding = null;
  }

  function traceRequest(stage, details = {}) {
    requestTrace.push({ at: new Date().toISOString(), stage, ...details });
    if (requestTrace.length > 24) requestTrace.splice(0, requestTrace.length - 24);
  }

  function ownDataDescriptor(value, key) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
        ? descriptor
        : null;
    } catch {
      return null;
    }
  }

  function ownDataValues(value, limit = 180) {
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const values = [];
      for (const key of Reflect.ownKeys(descriptors).slice(0, limit)) {
        const descriptor = descriptors[key];
        if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          values.push(descriptor.value);
        }
      }
      return values;
    } catch {
      return [];
    }
  }

  function callableMember(value, key) {
    let cursor = value;
    for (let depth = 0; cursor && depth < 7; depth += 1) {
      const descriptor = ownDataDescriptor(cursor, key);
      if (descriptor) {
        return typeof descriptor.value === "function"
          ? { owner: cursor, descriptor, depth }
          : null;
      }
      try {
        cursor = Object.getPrototypeOf(cursor);
      } catch {
        return null;
      }
    }
    return null;
  }

  function callableDescriptor(value, key) {
    return callableMember(value, key)?.descriptor || null;
  }

  function healLegacySendRequestShadow(value) {
    if (!value || typeof value !== "object") return false;
    const own = ownDataDescriptor(value, "sendRequest");
    if (!own || typeof own.value !== "function" || own.configurable !== true || own.enumerable !== true) return false;
    let prototype = null;
    try { prototype = Object.getPrototypeOf(value); } catch { return false; }
    if (!prototype) return false;
    const inherited = callableMember(prototype, "sendRequest");
    if (!inherited || inherited.descriptor.enumerable === true || inherited.descriptor.value !== own.value) return false;
    try {
      if (!Reflect.deleteProperty(value, "sendRequest")) return false;
    } catch {
      return false;
    }
    if (ownDataDescriptor(value, "sendRequest")) return false;
    healedLegacySendRequestShadows += 1;
    traceRequest("legacy-sendRequest-shadow-healed", {
      typeNames: objectTypeNames(value).slice(0, 3),
    });
    return true;
  }

  function objectTypeNames(value) {
    const names = [];
    let cursor = value;
    for (let depth = 0; cursor && depth < 7; depth += 1) {
      let prototype = null;
      try {
        prototype = Object.getPrototypeOf(cursor);
      } catch {
        break;
      }
      if (!prototype) break;
      const constructor = ownDataDescriptor(prototype, "constructor")?.value;
      if (typeof constructor === "function" && constructor.name) names.push(constructor.name);
      cursor = prototype;
    }
    return names;
  }

  function isRpcTargetLike(value) {
    return objectTypeNames(value).some((name) => /rpc.?target/i.test(name));
  }

  function ownValue(value, key) {
    return ownDataDescriptor(value, key)?.value;
  }

  function parsedFetchBody(payload) {
    const rawBody = ownValue(payload, "body");
    if (isObject(rawBody)) return { value: rawBody, wasString: false };
    if (typeof rawBody !== "string" || !rawBody.trim()) return { value: null, wasString: false };
    try {
      const value = JSON.parse(rawBody);
      return { value: isObject(value) ? value : null, wasString: true };
    } catch {
      return { value: null, wasString: true };
    }
  }

  function directRpcPatchTarget(value) {
    if (!value || typeof value !== "object") return null;
    const requestClient = ownValue(value, "requestClient");
    const threadCreation = ownValue(value, "threadCreation");
    if (!requestClient || typeof requestClient !== "object" || !threadCreation || typeof threadCreation !== "object") return null;
    const member = callableMember(requestClient, "sendRequest");
    if (!member || member.owner === requestClient) return null;
    if (member.descriptor.writable === false || member.descriptor.configurable === false) return null;
    let source = "";
    try { source = Function.prototype.toString.call(member.descriptor.value); } catch {}
    if (!source.includes("enqueueRequest") && !source.includes("sendConfigReadRequest")) return null;
    return {
      controller: value,
      client: requestClient,
      owner: member.owner,
      property: "sendRequest",
      descriptor: member.descriptor,
      prewarmMember: callableMember(requestClient, "prewarmThreadStart"),
      strategy: "app-server-request-client-prototype",
    };
  }

  function patchPrewarmThreadStart(target) {
    const member = target.prewarmMember;
    if (!member || member.owner === target.client) return false;
    const descriptor = member.descriptor;
    if (descriptor.writable === false || descriptor.configurable === false) return false;
    if (descriptor.value?.[WRAPPER_MARK] === wrapperToken) return false;
    const previous = descriptor.value;
    const wrapped = async function codexEnvironmentPrewarmThreadStart(request, options) {
      const profileId = state.pendingProfileId;
      if (!profileId) return previous.call(this, request, options);
      const profile = profileById(profileId);
      const patchedRequest = markInjectedParams(applyProfileToParams(request, profile));
      const fields = injectedFieldsFromParams(request, patchedRequest);
      const dispatchedAt = new Date().toISOString();
      const digestPromise = profilePayloadDigest(profile);
      traceRequest("prewarm-environment-dispatched", { profileId: profile.id, fields });
      try {
        const result = await previous.call(this, patchedRequest, options);
        const threadId = findThreadId(result) || findThreadId(patchedRequest);
        const payloadDigest = await digestPromise;
        if (threadId) {
          const acknowledgedAt = new Date().toISOString();
          const proofId = recordThreadProof(threadId, {
            profileId: profile.id,
            status: "acknowledged",
            method: "thread/start",
            transport: "prewarm-thread-start-prototype",
            fields,
            payloadDigest,
            dispatchedAt,
            acknowledgedAt,
          });
          bindThreadProfile(threadId, profile.id, {
            applied: true,
            source: "prewarm-thread-start-prototype",
            proofId,
          });
          showToast(`环境预热完成：${profile.name}`);
          traceRequest("prewarm-environment-acknowledged", { threadId, profileId: profile.id, proofId });
        }
        return result;
      } catch (error) {
        traceRequest("prewarm-environment-error", { profileId: profile.id, error: String(error?.message || error) });
        throw error;
      }
    };
    Object.defineProperty(wrapped, WRAPPER_MARK, { value: wrapperToken });
    try {
      Object.defineProperty(member.owner, "prewarmThreadStart", { ...descriptor, value: wrapped });
    } catch {
      return false;
    }
    if (ownDataDescriptor(member.owner, "prewarmThreadStart")?.value !== wrapped) return false;
    patchedClients.add({
      controller: target.controller,
      client: target.client,
      owner: member.owner,
      property: "prewarmThreadStart",
      descriptor,
      strategy: "prewarm-thread-start-prototype",
      wrapped,
      previous,
    });
    return true;
  }

  function patchDirectRpcTarget(value) {
    const target = directRpcPatchTarget(value);
    if (!target) return false;
    environmentControllers.add(target.controller);
    const prewarmPatched = patchPrewarmThreadStart(target);
    const { client, owner, descriptor } = target;
    if (descriptor.value?.[WRAPPER_MARK] === wrapperToken) return prewarmPatched;
    const previous = descriptor.value;
    const wrapped = async function codexEnvironmentSendRequest(method, params, ...rest) {
      const descriptorInfo = requestDescriptor(method, params);
      if (!descriptorInfo || descriptorInfo.prewarm) {
        return previous.call(this, method, params, ...rest);
      }
      let profileId = "";
      if (descriptorInfo.kind === "thread/start") {
        profileId = state.pendingProfileId || "base";
      } else if (descriptorInfo.kind === "thread/resume") {
        profileId = threadProfileId(descriptorInfo.params?.threadId);
        if (!profileId) return previous.call(this, method, params, ...rest);
      } else if (descriptorInfo.kind === "thread/fork") {
        profileId = threadProfileId(descriptorInfo.params?.threadId) || state.pendingProfileId || "base";
      }
      const profile = profileById(profileId || "base");
      const patchedParams = markInjectedParams(applyProfileToParams(descriptorInfo.params, profile));
      const nextParams = descriptorInfo.rebuild(patchedParams);
      const fields = injectedFieldsFromParams(descriptorInfo.params, patchedParams);
      const dispatchedAt = new Date().toISOString();
      const digestPromise = profilePayloadDigest(profile);
      traceRequest("direct-rpc-dispatched", { method: String(method || ""), profileId: profile.id, fields });
      try {
        const result = await previous.call(this, method, nextParams, ...rest);
        const threadId = findThreadId(result) || findThreadId(patchedParams);
        const payloadDigest = await digestPromise;
        if (threadId) {
          const acknowledgedAt = new Date().toISOString();
          const proofId = recordThreadProof(threadId, {
            profileId: profile.id,
            status: "acknowledged",
            method: descriptorInfo.kind,
            transport: "app-server-request-client-prototype",
            fields,
            payloadDigest,
            dispatchedAt,
            acknowledgedAt,
          });
          bindThreadProfile(threadId, profile.id, {
            applied: true,
            source: "app-server-request-client-prototype",
            proofId,
          });
          if (descriptorInfo.kind === "thread/start") consumePendingProfile(profile.id);
          pendingThreadObservation = null;
          showToast(`环境已注入：${profile.name}`);
          traceRequest("direct-rpc-acknowledged", { threadId, profileId: profile.id, proofId });
        }
        return result;
      } catch (error) {
        traceRequest("direct-rpc-error", { method: String(method || ""), profileId: profile.id, error: String(error?.message || error) });
        throw error;
      }
    };
    Object.defineProperty(wrapped, WRAPPER_MARK, { value: wrapperToken });
    try {
      Object.defineProperty(owner, "sendRequest", { ...descriptor, value: wrapped });
    } catch {
      return prewarmPatched;
    }
    if (ownDataDescriptor(owner, "sendRequest")?.value !== wrapped) return prewarmPatched;
    patchedClients.add({ ...target, client, owner, wrapped, previous, descriptor });
    return true;
  }

  function dispatcherPatchTarget(dispatcher) {
    if (!dispatcher || typeof dispatcher !== "object" || isRpcTargetLike(dispatcher)) return null;
    if (typeof ownValue(dispatcher, "__codexServiceTierOriginalDispatchMessage") !== "function") return null;
    const dispatch = callableMember(dispatcher, "dispatchMessage");
    const subscribe = callableMember(dispatcher, "subscribe");
    if (!dispatch || !subscribe) return null;
    if (dispatch.descriptor.writable === false || dispatch.descriptor.configurable === false) return null;
    return {
      client: dispatcher,
      owner: dispatch.owner,
      property: "dispatchMessage",
      descriptor: dispatch.descriptor,
      subscribe: subscribe.descriptor.value,
      strategy: "dispatcher-message",
    };
  }

  function patchDispatcher(dispatcher) {
    const target = dispatcherPatchTarget(dispatcher);
    if (!target) return false;
    const { client, owner, descriptor } = target;
    if (descriptor.value?.[WRAPPER_MARK] === wrapperToken) return false;
    const previous = descriptor.value;
    const wrapped = function codexProfileSelectorDispatchMessage(type, payload) {
      const rawType = String(type || "");
      observePendingProfileForTurn(type, payload);
      let prepared = null;
      try {
        prepared = prepareDispatcherRequest(type, payload);
      } catch (error) {
        traceRequest("dispatch-prepare-error", { type: rawType, error: String(error?.message || error) });
        throw error;
      }
      if (!prepared) {
        try {
          return previous.call(this, type, payload);
        } catch (error) {
          traceRequest("dispatch-passthrough-error", { type: rawType, error: String(error?.message || error) });
          throw error;
        }
      }
      traceRequest("dispatch-profile-selected", {
        type: String(type || ""),
        kind: prepared.descriptor.kind,
        profileId: prepared.profile.id,
      });
      const priorPending = pendingStartBinding;
      if (prepared.bindOnStarted) {
        pendingStartBinding = {
          at: Date.now(),
          kind: prepared.descriptor.kind,
          profileId: prepared.profile.id,
          profileName: prepared.profile.name,
        };
      }
      try {
        const result = previous.call(this, type, prepared.payload);
        traceRequest("dispatch-forwarded", { type: String(type || ""), kind: prepared.descriptor.kind });
        return result;
      } catch (error) {
        if (prepared.bindOnStarted) pendingStartBinding = priorPending;
        traceRequest("dispatch-error", { type: String(type || ""), error: String(error?.message || error) });
        throw error;
      }
    };
    Object.defineProperty(wrapped, WRAPPER_MARK, { value: wrapperToken });
    try {
      Object.defineProperty(owner, "dispatchMessage", { ...descriptor, value: wrapped });
    } catch {
      return false;
    }
    if (ownDataDescriptor(owner, "dispatchMessage")?.value !== wrapped) return false;
    let unsubscribe = null;
    try {
      unsubscribe = target.subscribe.call(client, "thread/started", handleThreadStarted);
    } catch {
      Object.defineProperty(owner, "dispatchMessage", descriptor);
      return false;
    }
    patchedClients.add({ ...target, client, owner, wrapped, previous, descriptor, unsubscribe });
    return true;
  }

  function patchClient(value) {
    return patchDirectRpcTarget(value) || patchDispatcher(value);
  }

  function patchedClientDiagnostics() {
    return Array.from(patchedClients, (record) => {
      let ownKeys = [];
      try {
        ownKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(record.client))
          .filter((key) => typeof key === "string")
          .slice(0, 40);
      } catch {}
      let previousSource = "";
      try { previousSource = Function.prototype.toString.call(record.previous).slice(0, 360); } catch {}
      return {
        strategy: record.strategy || "unknown",
        typeNames: objectTypeNames(record.client),
        ownerIsPrototype: record.owner !== record.client,
        ownKeys,
        property: record.property || "",
        previousName: String(record.previous?.name || ""),
        previousSource,
        descriptor: {
          enumerable: record.descriptor?.enumerable === true,
          configurable: record.descriptor?.configurable === true,
          writable: record.descriptor?.writable === true,
        },
        serviceTierDispatcher: typeof ownValue(record.client, "__codexServiceTierOriginalDispatchMessage") === "function",
      };
    });
  }

  function appAssetUrls() {
    return Array.from(new Set([
      ...Array.from(document.scripts || []).map((script) => script.src),
      ...Array.from(document.querySelectorAll("link[href]") || []).map((link) => link.href),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ].filter((url) => typeof url === "string" && url.includes("/assets/") && url.split("?")[0].endsWith(".js"))));
  }

  function preferredAssetUrls() {
    const urls = appAssetUrls();
    const preferred = urls.filter((url) => {
      const name = (url.split("/").pop() || "").toLowerCase();
      return /use-host-config|app-server-manager-signals|app-initial|setting-storage|vscode-api|app-main|page-|signals|server-manager/.test(name);
    });
    return preferred.slice(0, 20);
  }

  async function importAsset(url) {
    if (!modulePromises.has(url)) {
      modulePromises.set(url, import(url).catch((error) => {
        modulePromises.delete(url);
        throw error;
      }));
    }
    return modulePromises.get(url);
  }

  function moduleCandidates(module) {
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      candidates.push(value);
    };
    for (const value of ownDataValues(module || {}, 180)) {
      push(value);
      if (!value || typeof value !== "object" || isRpcTargetLike(value)) continue;
      const get = callableDescriptor(value, "get")?.value;
      if (get) {
        try { push(get.call(value)); } catch {}
        try { push(get.call(value, "local")); } catch {}
      }
      for (const nested of ownDataValues(value, 120)) push(nested);
    }
    return candidates;
  }

  function fiberForNode(node) {
    if (!(node instanceof Element)) return null;
    const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  function patchFromObjectGraph(rootValue) {
    const queue = [{ value: rootValue, depth: 0 }];
    const seen = new WeakSet();
    let patched = 0;
    while (queue.length) {
      const item = queue.shift();
      const value = item?.value;
      if (!value || typeof value !== "object"
          || (typeof Node !== "undefined" && value instanceof Node)
          || seen.has(value)) continue;
      seen.add(value);
      healLegacySendRequestShadow(value);
      if (patchClient(value)) patched += 1;
      if (isRpcTargetLike(value)) continue;
      if (item.depth >= 6) continue;
      for (const child of ownDataValues(value, 180)) {
        if (child && typeof child === "object") {
          queue.push({ value: child, depth: item.depth + 1 });
        }
      }
    }
    return patched;
  }

  function patchFromReactFibers() {
    let patched = 0;
    const nodes = [
      document.querySelector("[data-codex-composer-root]"),
      document.querySelector("[data-codex-composer]"),
      document.querySelector('[contenteditable="true"]'),
    ].filter(Boolean);
    const seenFibers = new WeakSet();
    for (const node of nodes) {
      let fiber = fiberForNode(node);
      for (let depth = 0; fiber && depth < 90; depth += 1, fiber = fiber.return) {
        for (const candidate of [fiber, fiber.alternate]) {
          if (!candidate || seenFibers.has(candidate)) continue;
          seenFibers.add(candidate);
          patched += patchFromObjectGraph(candidate.memoizedState);
          patched += patchFromObjectGraph(candidate.updateQueue?.memoCache);
        }
      }
    }
    return patched;
  }

  async function scanClients() {
    if (destroyed || scanInFlight) return;
    scanInFlight = true;
    scanAttempts += 1;
    let patched = 0;
    try {
      for (const url of preferredAssetUrls()) {
        try {
          const module = await importAsset(url);
          for (const candidate of moduleCandidates(module)) {
            healLegacySendRequestShadow(candidate);
            if (patchClient(candidate)) patched += 1;
          }
        } catch {}
      }
      patched += patchFromReactFibers();
      lastPatchError = "";
    } catch (error) {
      lastPatchError = String(error?.stack || error?.message || error);
    } finally {
      scanInFlight = false;
      updatePill();
    }
    const delay = patched > 0 || patchedClients.size > 0
      ? 30000
      : Math.min(15000, 500 * Math.max(1, scanAttempts));
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanClients, delay);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    lifetime.abort();
    window.clearTimeout(scanTimer);
    window.clearInterval(labelTimer);
    closeChooser(null);
    for (const record of patchedClients) {
      try { record.unsubscribe?.(); } catch {}
      try {
        if (ownDataDescriptor(record.owner, record.property)?.value === record.wrapped) {
          Object.defineProperty(record.owner, record.property, record.descriptor);
        }
      } catch {}
    }
    patchedClients.clear();
    environmentControllers.clear();
    try { uiAdapter?.destroy?.(); } catch {}
    uiAdapter = null;
    host?.remove();
    const currentApi = window[GLOBAL_KEY];
    if (window[LEGACY_GLOBAL_KEY] === currentApi || window[LEGACY_GLOBAL_KEY]?.version === VERSION) {
      delete window[LEGACY_GLOBAL_KEY];
    }
    if (currentApi?.version === VERSION) delete window[GLOBAL_KEY];
  }

  function publicStatus() {
    const currentId = currentThreadId();
    const currentEntry = threadProfileEntry(currentId);
    const currentProfile = currentEntry?.profileId || "";
    const currentProof = currentId && isObject(state.proofByThread?.[currentId])
      ? state.proofByThread[currentId]
      : null;
    let attachedUi = null;
    try { attachedUi = uiAdapter?.status?.() || null; } catch {}
    return {
      name: "环境注入器",
      version: VERSION,
      generatedAt: ENVIRONMENT_BUNDLE.generatedAt || "",
      profiles: profiles.map(({ id, name, model, modelProvider, source }) => ({ id, name, model, modelProvider, source })),
      currentThreadId: currentId,
      currentProfileId: currentProfile,
      currentProfileBinding: currentEntry ? {
        profileId: currentEntry.profileId,
        applied: currentEntry.applied,
        source: currentEntry.source || "legacy",
        proofId: currentEntry.proofId || null,
        at: currentEntry.at || null,
      } : null,
      currentProof: currentProof ? {
        proofId: currentProof.proofId,
        status: currentProof.status,
        transport: currentProof.transport,
        fields: currentProof.fields,
        payloadDigest: currentProof.payloadDigest,
        acknowledgedAt: currentProof.acknowledgedAt,
      } : null,
      store: {
        schemaVersion: environmentStore.schemaVersion,
        revision: environmentStore.revision,
        migrated: environmentStore.migration?.completed === true,
        migrationSources: environmentStore.migration?.sources || [],
      },
      capabilities: cloneJson(bridgeCapabilities || ENVIRONMENT_BUNDLE.environment?.capabilities || {}),
      memoryEnabled: ENVIRONMENT_BUNDLE.environment?.memory?.settings?.enabled === true,
      pendingProfileId: state.pendingProfileId,
      promptOnNewThread: state.promptOnNewThread,
      chooserOpen: attachedUi ? attachedUi.open === true : !!panel && !panel.hidden,
      panelMode: attachedUi?.mode || panelMode,
      patchedClients: patchedClients.size,
      patchedClientDiagnostics: patchedClientDiagnostics(),
      scanAttempts,
      lastPatchError,
      healedLegacySendRequestShadows,
      requestTrace: requestTrace.slice(),
    };
  }

  function refreshEnvironmentData() {
    environmentStore = loadEnvironmentStore();
    refreshProfileCatalog();
    state = loadState();
    renderProfileOptions();
    updatePill();
    if (panelMode === "current") renderCurrentProfileView();
  }

  if (window.__CODEX_ENVIRONMENT_INJECTOR_TEST__ || window.__CODEX_PROFILE_SELECTOR_TEST__) {
    const testApi = {
      refreshProfiles: () => {
        refreshProfileCatalog();
        return profiles;
      },
      profiles: () => profiles,
      editableProfiles: editableStaticProfiles,
      profileById,
      applyProfileToParams,
      markInjectedParams,
      injectedFieldsFromParams,
      prepareDispatcherRequest,
      requestDescriptor,
      threadProfileEntry,
      bindThreadProfile,
      setPendingProfile,
      currentBindingStatus,
      turnStartThreadId,
      deepMerge,
      patchClient,
      patchFromObjectGraph,
      moduleCandidates,
      ownDataValues,
      healLegacySendRequestShadow,
      isRpcTargetLike,
      patchedClientCount: () => patchedClients.size,
      environmentStore: () => cloneJson(environmentStore),
      environmentBundle: () => cloneJson(ENVIRONMENT_BUNDLE),
      bridgeCall,
      refreshBridgeState,
      bridgeState: () => cloneJson({ bridgeCapabilities, bridgeAgents, bridgeMemory }),
      uiSnapshot,
      attachUiAdapter,
      chooseProfile,
      openEnvironmentView,
      destroy,
    };
    window.__codexEnvironmentInjectorTest = testApi;
    window.__codexPlusProfileSelectorTest = testApi;
    return;
  }

  document.addEventListener("click", interceptNewChat, { capture: true, signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeChooser) closeChooser(null);
  }, { signal });
  const handleRouteChange = () => {
    updatePill();
    void scanClients();
  };
  window.addEventListener("popstate", handleRouteChange, { signal });
  window.addEventListener("hashchange", handleRouteChange, { signal });
  window.addEventListener(UPDATE_EVENT, refreshEnvironmentData, { signal });
  window.addEventListener("codexpp-profile-studio-updated", refreshEnvironmentData, { signal });
  window.addEventListener("storage", (event) => {
    if (![STORAGE_KEY, LEGACY_STUDIO_STORAGE_KEY, LEGACY_SELECTOR_STORAGE_KEY].includes(event.key)) return;
    refreshEnvironmentData();
  }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      updatePill();
      void scanClients();
    }
  }, { signal });

  createUi();
  renderProfileOptions();
  labelTimer = window.setInterval(updatePill, 1000);
  void refreshBridgeState();
  void scanClients();

  const publicApi = {
    version: VERSION,
    status: publicStatus,
    editableProfiles: editableStaticProfiles,
    environmentSnapshot: () => cloneJson(ENVIRONMENT_BUNDLE.environment || {}),
    environmentStore: () => cloneJson(environmentStore),
    uiSnapshot,
    attachUiAdapter,
    bridgeCall,
    refreshBridge: async () => {
      await refreshBridgeState();
      return uiSnapshot();
    },
    replaceEnvironmentStore: (nextStore) => {
      environmentStore = normalizeEnvironmentStore(cloneJson(nextStore));
      saveEnvironmentStore();
      refreshProfileCatalog();
      state = loadState();
      renderProfileOptions();
      updatePill();
      return uiSnapshot();
    },
    updateUiPreferences: (patch) => {
      if (isObject(patch)) Object.assign(environmentStore.ui, cloneJson(patch));
      saveEnvironmentStore();
      notifyUiAdapter();
      return uiSnapshot();
    },
    setPromptOnNewThread: (enabled) => {
      state.promptOnNewThread = enabled !== false;
      saveState();
      return uiSnapshot();
    },
    open: () => chooseProfile("下个新对话环境"),
    viewCurrent: openCurrentProfileView,
    viewMemory: openMemoryView,
    viewAgents: openAgentsView,
    viewTutorial: openTutorialView,
    setNext: (profileId) => {
      setPendingProfile(profileId);
      return publicStatus();
    },
    clearNext: () => {
      state.pendingProfileId = "";
      saveState();
      return publicStatus();
    },
    rescan: () => scanClients(),
    refreshProfiles: () => {
      refreshEnvironmentData();
      return publicStatus();
    },
    destroy,
  };
  window[GLOBAL_KEY] = publicApi;
  window[LEGACY_GLOBAL_KEY] = publicApi;
})();
