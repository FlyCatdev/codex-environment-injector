/* Codex++ Environment Studio v0.3.2 */
(() => {
  "use strict";

  const GLOBAL_KEY = "__codexEnvironmentStudio";
  const LEGACY_GLOBAL_KEY = "__codexPlusProfileStudio";
  const INJECTOR_GLOBAL_KEY = "__codexEnvironmentInjector";
  const VERSION = "0.3.2";
  const STORAGE_KEY = "codexpp.environmentInjector.v2";
  const LEGACY_STORAGE_KEY = "codexpp.profileStudio.v1";
  const STORE_VERSION = 2;
  const UPDATE_EVENT = "codexpp-environment-injector-updated";
  const NAV_ATTR = "data-codex-environment-injector-nav";
  const HOST_ID = "codexpp-environment-studio-host";
  const MAX_PROFILES = 50;
  const MAX_INSTRUCTIONS_CHARS = 40000;

  window[GLOBAL_KEY]?.destroy?.();
  if (window[LEGACY_GLOBAL_KEY] && window[LEGACY_GLOBAL_KEY] !== window[GLOBAL_KEY]) {
    window[LEGACY_GLOBAL_KEY]?.destroy?.();
  }

  const lifetime = new AbortController();
  const { signal } = lifetime;
  let destroyed = false;
  let host = null;
  let shadow = null;
  let dialog = null;
  let navNode = null;
  let observer = null;
  let scanTimer = 0;
  let uiAdapter = null;
  let selectedKey = "";
  let selectedTargetProfileId = "";
  let sourceFileName = "";
  let sourceConfig = {};

  const ui = {};

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function defaultStore() {
    return {
      schemaVersion: STORE_VERSION,
      revision: 0,
      profiles: {},
      selection: { pendingProfileId: "", promptOnNewThread: true },
      bindingsByThread: {},
      proofByThread: {},
      migration: { completed: true, sources: [], migratedAt: new Date().toISOString() },
      ui: {},
    };
  }

  function loadStore() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    if (!isObject(parsed) || parsed.schemaVersion !== STORE_VERSION) {
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null"); } catch {}
      parsed = defaultStore();
      if (isObject(legacy?.profiles)) {
        parsed.profiles = cloneJson(legacy.profiles);
        parsed.migration.sources.push(LEGACY_STORAGE_KEY);
      }
    }
    if (!isObject(parsed.profiles)) parsed.profiles = {};
    if (!isObject(parsed.selection)) parsed.selection = { pendingProfileId: "", promptOnNewThread: true };
    if (!isObject(parsed.bindingsByThread)) parsed.bindingsByThread = {};
    if (!isObject(parsed.proofByThread)) parsed.proofByThread = {};
    if (!isObject(parsed.ui)) parsed.ui = {};
    return parsed;
  }

  let store = loadStore();

  function saveStore() {
    store.revision = Number(store.revision || 0) + 1;
    store.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      throw new Error(`保存环境失败：${error?.message || error}`);
    }
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
    window[INJECTOR_GLOBAL_KEY]?.refreshProfiles?.();
    renderProfileList();
  }

  function cloneJson(value, fallback = {}) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function storedProfileEntries() {
    return Object.entries(store.profiles || {}).flatMap(([storageKey, item]) => {
      if (!isObject(item) || !/^[A-Za-z0-9_-]+$/.test(String(item.id || ""))) return [];
      const requestedTarget = String(item.targetProfileId || "").trim();
      const targetProfileId = /^[A-Za-z0-9_-]+$/.test(requestedTarget) ? requestedTarget : "";
      return [{
        ...item,
        targetProfileId,
        storageKey,
        sourceKind: targetProfileId ? "override" : "studio",
      }];
    }).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }

  function fileProfileEntries() {
    let values = [];
    try {
      values = window[INJECTOR_GLOBAL_KEY]?.editableProfiles?.() || window.__codexPlusProfileSelector?.editableProfiles?.() || [];
    } catch {}
    if (!Array.isArray(values)) return [];
    return values.flatMap((item) => {
      if (!isObject(item)) return [];
      const id = String(item.id || "").trim();
      if (id === "base" || !/^[A-Za-z0-9_-]+$/.test(id)) return [];
      return [{
        ...cloneJson(item),
        id,
        storageKey: "",
        targetProfileId: id,
        sourceKind: "file",
        sourceFileName: String(item.sourceFileName || `${id}.config.toml`),
      }];
    }).sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
  }

  function profileEntries() {
    const stored = storedProfileEntries();
    const files = fileProfileEntries();
    const fileIds = new Set(files.map((profile) => profile.id));
    const overrides = new Map(stored
      .filter((profile) => profile.targetProfileId && fileIds.has(profile.targetProfileId))
      .map((profile) => [profile.targetProfileId, profile]));
    const fileRows = files.map((profile) => overrides.get(profile.id) || profile);
    const customRows = stored.filter((profile) => !profile.targetProfileId);
    const orphanOverrides = stored
      .filter((profile) => profile.targetProfileId && !fileIds.has(profile.targetProfileId))
      .map((profile) => ({ ...profile, sourceKind: "orphan-override" }));
    return [...fileRows, ...customRows, ...orphanOverrides];
  }

  function selectorProfileId(profile) {
    return profile.targetProfileId || `studio:${profile.id}`;
  }

  function slugify(value) {
    const slug = String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return slug || `profile-${Date.now().toString(36).slice(-6)}`;
  }

  function titleFromMarkdown(text) {
    const line = String(text || "").split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => /^#\s+\S/.test(item));
    return line ? line.replace(/^#\s+/, "").trim().slice(0, 80) : "";
  }

  function setStatus(message, kind = "info") {
    if (!ui.status) return;
    ui.status.textContent = String(message || "");
    ui.status.dataset.kind = kind;
  }

  function currentFormProfile() {
    const id = String(ui.id?.value || "").trim();
    const name = String(ui.name?.value || "").trim() || id;
    const instructions = String(ui.instructions?.value || "");
    const reasoning = String(ui.reasoning?.value || "");
    const config = isObject(sourceConfig) ? cloneJson(sourceConfig) : {};
    if (reasoning) config.model_reasoning_effort = reasoning;
    else delete config.model_reasoning_effort;
    const profile = {
      id,
      name,
      sourceFileName,
      model: String(ui.model?.value || "").trim(),
      modelProvider: String(ui.provider?.value || "").trim(),
      developerInstructions: instructions,
      baseInstructions: String(ui.baseInstructions?.value || ""),
      memoryPolicy: {
        use: String(ui.memoryUse?.value || "inherit"),
        generate: String(ui.memoryGenerate?.value || "inherit"),
      },
      origin: selectedTargetProfileId ? "file-override" : "local",
      approvalPolicy: String(ui.approval?.value || ""),
      sandbox: String(ui.sandbox?.value || ""),
      serviceTier: String(ui.serviceTier?.value || "").trim(),
      config,
      createdAt: selectedKey && store.profiles[selectedKey]?.createdAt
        ? store.profiles[selectedKey].createdAt
        : Date.now(),
      updatedAt: Date.now(),
    };
    if (selectedTargetProfileId) profile.targetProfileId = selectedTargetProfileId;
    return profile;
  }

  function likelyContainsSecret(text) {
    const source = String(text || "");
    return [
      /\bsk-[A-Za-z0-9_-]{16,}\b/,
      /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{12,}/i,
      /\bBearer\s+[A-Za-z0-9_./+\-=]{16,}/i,
    ].some((pattern) => pattern.test(source));
  }

  function likelyContainsSecretValue(value, depth = 0) {
    if (depth > 8) return false;
    if (typeof value === "string") return likelyContainsSecret(value);
    if (Array.isArray(value)) return value.some((item) => likelyContainsSecretValue(item, depth + 1));
    if (!isObject(value)) return false;
    return Object.entries(value).some(([key, item]) =>
      /api[_-]?key|token|password|secret|authorization|bearer|credential|auth_contents/i.test(key)
      || likelyContainsSecretValue(item, depth + 1));
  }

  function storageKeyFor(profile) {
    return profile.targetProfileId ? `override:${profile.targetProfileId}` : profile.id;
  }

  function validateProfile(profile) {
    if (!/^[A-Za-z0-9_-]+$/.test(profile.id)) {
      return "Profile ID 只能包含英文、数字、下划线和减号";
    }
    const hasContent = String(profile.developerInstructions || "").trim()
      || String(profile.baseInstructions || "").trim()
      || (profile.memoryPolicy?.use || "inherit") !== "inherit"
      || (profile.memoryPolicy?.generate || "inherit") !== "inherit"
      || profile.model
      || profile.modelProvider
      || profile.approvalPolicy
      || profile.sandbox
      || profile.serviceTier
      || Object.keys(profile.config || {}).length > 0;
    if (!hasContent) {
      return "请提供 AGENTS.md 内容或至少一项 Profile 设置";
    }
    if (profile.developerInstructions.length > MAX_INSTRUCTIONS_CHARS) {
      return `Developer Instructions 不能超过 ${MAX_INSTRUCTIONS_CHARS} 个字符`;
    }
    if (String(profile.baseInstructions || "").length > MAX_INSTRUCTIONS_CHARS) {
      return `Base Instructions 不能超过 ${MAX_INSTRUCTIONS_CHARS} 个字符`;
    }
    const nextKey = storageKeyFor(profile);
    if (!selectedKey && !store.profiles[nextKey] && storedProfileEntries().length >= MAX_PROFILES) {
      return `最多保存 ${MAX_PROFILES} 个自定义 Profile 或本地覆盖`;
    }
    if (selectedKey !== nextKey && store.profiles[nextKey]) {
      return profile.targetProfileId
        ? `这个文件 Profile 已存在本地覆盖：${profile.targetProfileId}`
        : `Profile ID 已存在：${profile.id}`;
    }
    return "";
  }

  function clearForm() {
    selectedKey = "";
    selectedTargetProfileId = "";
    sourceFileName = "";
    sourceConfig = {};
    ui.id.value = "";
    ui.id.disabled = false;
    ui.name.value = "";
    ui.model.value = "";
    ui.provider.value = "";
    ui.reasoning.value = "";
    ui.approval.value = "";
    ui.sandbox.value = "";
    ui.serviceTier.value = "";
    ui.memoryUse.value = "inherit";
    ui.memoryGenerate.value = "inherit";
    ui.instructions.value = "";
    ui.baseInstructions.value = "";
    ui.fileLabel.textContent = "拖入或选择 AGENTS.md";
    if (ui.saveButton) ui.saveButton.textContent = "打包并保存";
    if (ui.removeButton) {
      ui.removeButton.disabled = true;
      ui.removeButton.textContent = "删除";
    }
    setStatus("可新建 Profile，也可从左侧选择已检测到的文件 Profile 进行覆盖编辑。", "info");
    renderProfileList();
  }

  function fillForm(profile) {
    selectedKey = String(profile.storageKey || "");
    selectedTargetProfileId = String(profile.targetProfileId || "");
    sourceFileName = String(profile.sourceFileName || "");
    sourceConfig = isObject(profile.config) ? cloneJson(profile.config) : {};
    ui.id.value = profile.id;
    ui.id.disabled = Boolean(selectedTargetProfileId);
    ui.name.value = profile.name || profile.id;
    ui.model.value = profile.model || "";
    ui.provider.value = profile.modelProvider || "";
    ui.reasoning.value = profile.config?.model_reasoning_effort || "";
    ui.approval.value = profile.approvalPolicy || "";
    ui.sandbox.value = profile.sandbox || "";
    ui.serviceTier.value = profile.serviceTier || "";
    ui.memoryUse.value = profile.memoryPolicy?.use || "inherit";
    ui.memoryGenerate.value = profile.memoryPolicy?.generate || "inherit";
    ui.instructions.value = profile.developerInstructions || "";
    ui.baseInstructions.value = profile.baseInstructions || "";
    ui.fileLabel.textContent = sourceFileName || (profile.developerInstructions ? "已加载 AGENTS.md" : "未关联 AGENTS.md");
    if (ui.saveButton) ui.saveButton.textContent = selectedTargetProfileId ? "保存本地覆盖" : "保存修改";
    if (ui.removeButton) {
      ui.removeButton.disabled = !selectedKey;
      ui.removeButton.textContent = selectedTargetProfileId ? "恢复文件版本" : "删除";
    }
    if (profile.sourceKind === "file") {
      setStatus(`已检测到文件 Profile：${profile.name || profile.id}。保存后作为会话级本地覆盖，原文件不变。`, "info");
    } else if (profile.sourceKind === "override") {
      setStatus(`正在编辑文件 Profile 的本地覆盖：${profile.name || profile.id}`, "info");
    } else if (profile.sourceKind === "orphan-override") {
      setStatus(`正在编辑本地覆盖；源文件 Profile ${selectedTargetProfileId} 当前未被检测到。`, "error");
    } else {
      setStatus(`正在编辑工坊 Profile：${profile.name || profile.id}`, "info");
    }
    renderProfileList();
  }

  async function loadAgentsFile(file) {
    if (!file) return;
    const fileName = String(file.name || "AGENTS.md");
    if (!/\.md$/i.test(fileName) && file.type && !/text|markdown/i.test(file.type)) {
      setStatus("请选择 Markdown 文本文件", "error");
      return;
    }
    if (file.size > 256 * 1024) {
      setStatus("文件过大；AGENTS.md 最大允许 256 KiB", "error");
      return;
    }
    const text = await file.text();
    if (text.length > MAX_INSTRUCTIONS_CHARS) {
      setStatus(`内容超过 ${MAX_INSTRUCTIONS_CHARS} 字符，请先精简`, "error");
      return;
    }
    sourceFileName = fileName;
    ui.instructions.value = text;
    const title = titleFromMarkdown(text) || fileName.replace(/\.md$/i, "") || "Custom Profile";
    if (!ui.name.value.trim()) ui.name.value = title;
    if (!ui.id.value.trim()) ui.id.value = slugify(title);
    ui.fileLabel.textContent = `${fileName} · ${text.length} 字符`;
    setStatus("AGENTS.md 已载入，点击“打包并保存”。", "success");
  }

  function saveCurrentProfile() {
    const profile = currentFormProfile();
    const error = validateProfile(profile);
    if (error) {
      setStatus(error, "error");
      return;
    }
    if (likelyContainsSecret(profile.developerInstructions)
        || likelyContainsSecret(profile.baseInstructions)
        || likelyContainsSecretValue(profile.config)) {
      if (!window.confirm("环境内容可能包含密钥、Token 或认证字段。仍要保存到 Codex 页面 localStorage 吗？")) {
        return;
      }
    }
    const nextKey = storageKeyFor(profile);
    if (selectedKey && selectedKey !== nextKey) delete store.profiles[selectedKey];
    store.profiles[nextKey] = profile;
    selectedKey = nextKey;
    selectedTargetProfileId = String(profile.targetProfileId || "");
    sourceConfig = cloneJson(profile.config || {});
    saveStore();
    if (ui.useNext.checked) {
      window[INJECTOR_GLOBAL_KEY]?.setNext?.(selectorProfileId(profile));
    }
    fillForm({ ...profile, storageKey: nextKey, sourceKind: profile.targetProfileId ? "override" : "studio" });
    if (profile.targetProfileId) {
      setStatus(`已保存 ${profile.targetProfileId} 的本地覆盖；原 .config.toml 未修改。`, "success");
    } else {
      setStatus(`已打包：${profile.name}。现在可在右下角 Profile 选择器中使用。`, "success");
    }
  }

  function deleteCurrentProfile() {
    if (!selectedKey || !store.profiles[selectedKey]) return;
    const profile = store.profiles[selectedKey];
    const isOverride = Boolean(profile.targetProfileId);
    const prompt = isOverride
      ? `恢复文件 Profile“${profile.targetProfileId}”并删除本地覆盖？`
      : `删除自定义 Profile“${profile.name || profile.id}”？`;
    if (!window.confirm(prompt)) return;
    delete store.profiles[selectedKey];
    saveStore();
    clearForm();
    setStatus(isOverride
      ? `已恢复文件 Profile：${profile.targetProfileId}`
      : "Profile 已删除。已绑定的旧会话将回退到 Base。", "success");
  }

  function tomlString(value) {
    return JSON.stringify(String(value || ""));
  }

  function tomlKey(value) {
    const key = String(value || "");
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
  }

  function tomlValue(value) {
    if (typeof value === "string") return tomlString(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
    if (isObject(value)) {
      return `{ ${Object.entries(value).map(([key, item]) => `${tomlKey(key)} = ${tomlValue(item)}`).join(", ")} }`;
    }
    throw new Error(`无法导出 TOML 值：${String(value)}`);
  }

  function appendTomlConfig(lines, value, path = []) {
    const entries = Object.entries(value || {});
    const scalars = entries.filter(([, item]) => !isObject(item));
    const tables = entries.filter(([, item]) => isObject(item));
    if (path.length) {
      lines.push("", `[${path.map(tomlKey).join(".")}]`);
    }
    for (const [key, item] of scalars) lines.push(`${tomlKey(key)} = ${tomlValue(item)}`);
    for (const [key, item] of tables) appendTomlConfig(lines, item, [...path, key]);
  }

  function profileToml(profile) {
    const lines = [
      "# Generated by Codex++ Environment Injector",
      `# Source: ${profile.sourceFileName || "AGENTS.md"}`,
      "",
    ];
    if (profile.model) lines.push(`model = ${tomlString(profile.model)}`);
    if (profile.modelProvider) lines.push(`model_provider = ${tomlString(profile.modelProvider)}`);
    if (profile.config?.model_reasoning_effort) {
      lines.push(`model_reasoning_effort = ${tomlString(profile.config.model_reasoning_effort)}`);
    }
    if (profile.approvalPolicy) lines.push(`approval_policy = ${tomlString(profile.approvalPolicy)}`);
    if (profile.sandbox) lines.push(`sandbox_mode = ${tomlString(profile.sandbox)}`);
    if (profile.serviceTier) lines.push(`service_tier = ${tomlString(profile.serviceTier)}`);
    if (profile.developerInstructions) {
      lines.push(`developer_instructions = ${tomlString(profile.developerInstructions)}`);
    }
    if (profile.baseInstructions) {
      lines.push(`base_instructions = ${tomlString(profile.baseInstructions)}`);
    }
    const config = isObject(profile.config) ? cloneJson(profile.config) : {};
    delete config.model_reasoning_effort;
    const memories = {};
    if (profile.memoryPolicy?.use === "on" || profile.memoryPolicy?.use === "off") {
      memories.use_memories = profile.memoryPolicy.use === "on";
    }
    if (profile.memoryPolicy?.generate === "on" || profile.memoryPolicy?.generate === "off") {
      memories.generate_memories = profile.memoryPolicy.generate === "on";
    }
    if (Object.keys(memories).length) config.memories = memories;
    appendTomlConfig(lines, config);
    lines.push("");
    return lines.join("\n");
  }

  function exportCurrentProfile() {
    const profile = currentFormProfile();
    const error = validateProfile(profile);
    if (error) {
      setStatus(error, "error");
      return;
    }
    let content = "";
    try {
      content = profileToml(profile);
    } catch (exportError) {
      setStatus(`导出失败：${exportError?.message || exportError}`, "error");
      return;
    }
    const blob = new Blob([content], { type: "application/toml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.id}.config.toml`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`已导出：${profile.id}.config.toml`, "success");
  }

  function renderProfileList() {
    if (!ui.profileList) return;
    ui.profileList.replaceChildren();
    const entries = profileEntries();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "未检测到文件 Profile，也没有工坊 Profile";
      ui.profileList.append(empty);
      return;
    }
    for (const profile of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-row";
      const active = profile.storageKey
        ? profile.storageKey === selectedKey
        : !selectedKey && profile.sourceKind === "file" && selectedTargetProfileId === profile.id;
      if (active) button.dataset.active = "true";
      const title = document.createElement("strong");
      title.textContent = profile.name || profile.id;
      const detail = document.createElement("small");
      const sourceLabel = profile.sourceKind === "file"
        ? "文件 Profile"
        : profile.sourceKind === "override"
          ? "本地覆盖"
          : profile.sourceKind === "orphan-override"
            ? "源文件未检测到"
            : "工坊 Profile";
      detail.textContent = [sourceLabel, profile.model || "继承模型", profile.modelProvider || "继承 Provider"].join(" · ");
      button.append(title, detail);
      button.addEventListener("click", () => fillForm(profile), { signal });
      ui.profileList.append(button);
    }
  }

  function field(labelText, input) {
    const label = document.createElement("label");
    label.className = "field";
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(text, input);
    return label;
  }

  function textInput(placeholder = "") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    return input;
  }

  function selectInput(options) {
    const select = document.createElement("select");
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    return select;
  }

  function createUi() {
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483100";
    host.style.pointerEvents = "none";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; }
      .backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.46); pointer-events: auto; }
      .backdrop[hidden] { display: none; }
      .dialog { width: min(920px, 96vw); height: min(700px, 92vh); display: grid; grid-template-rows: auto 1fr; overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 18px; background: var(--color-surface, Canvas); color: var(--color-text, CanvasText); box-shadow: 0 28px 90px rgba(0,0,0,.38); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, currentColor 11%, transparent); }
      .top h2 { margin: 0; font-size: 17px; }
      .top p { margin: 2px 0 0; opacity: .62; font-size: 11px; }
      .top-actions { display: flex; align-items: center; gap: 7px; }
      .tutorial-button { padding: 6px 9px; font-size: 11px; }
      button { font: inherit; }
      .icon-button { appearance: none; border: 0; background: transparent; color: inherit; font-size: 22px; cursor: pointer; opacity: .7; }
      .body { min-height: 0; display: grid; grid-template-columns: 240px minmax(0,1fr); }
      .sidebar { min-height: 0; overflow: auto; padding: 12px; border-right: 1px solid color-mix(in srgb, currentColor 11%, transparent); }
      .new-button, .action { appearance: none; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 9px; padding: 8px 10px; background: color-mix(in srgb, currentColor 5%, transparent); color: inherit; cursor: pointer; }
      .new-button { width: 100%; margin-bottom: 10px; }
      .new-button:hover, .action:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 60%, transparent); }
      .action:disabled { cursor: default; opacity: .38; }
      .profile-list { display: grid; gap: 6px; }
      .profile-row { display: grid; gap: 2px; width: 100%; padding: 8px 9px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .profile-row:hover, .profile-row[data-active="true"] { background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 9%, transparent); border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 35%, transparent); }
      .profile-row small { opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .empty { padding: 12px 4px; opacity: .55; font-size: 12px; }
      .editor { min-height: 0; overflow: auto; padding: 15px; display: grid; align-content: start; gap: 12px; }
      .drop { display: grid; place-items: center; min-height: 92px; padding: 14px; border: 1px dashed color-mix(in srgb, currentColor 28%, transparent); border-radius: 12px; background: color-mix(in srgb, currentColor 3%, transparent); cursor: pointer; text-align: center; }
      .drop[data-drag="true"] { border-color: var(--color-token-primary, #3b82f6); background: color-mix(in srgb, var(--color-token-primary, #3b82f6) 9%, transparent); }
      .drop strong { display: block; }
      .drop small { opacity: .58; }
      .grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
      .field { display: grid; gap: 5px; min-width: 0; }
      .field > span { font-size: 11px; opacity: .7; }
      input, select, textarea { width: 100%; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 8px; padding: 8px 9px; background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; outline: none; }
      input:focus, select:focus, textarea:focus { border-color: var(--color-token-primary, #3b82f6); }
      input:disabled { cursor: not-allowed; opacity: .58; }
      textarea { min-height: 220px; resize: vertical; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
      textarea.compact { min-height: 140px; }
      .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .primary { background: var(--color-token-primary, #2563eb); color: white; border-color: transparent; font-weight: 650; }
      .danger { color: #ef4444; }
      .check { display: flex; align-items: center; gap: 7px; margin-right: auto; }
      .check input { width: auto; }
      .status { min-height: 20px; font-size: 12px; opacity: .75; }
      .status[data-kind="success"] { color: #16a34a; opacity: 1; }
      .status[data-kind="error"] { color: #ef4444; opacity: 1; }
      @media (max-width: 720px) { .body { grid-template-columns: 1fr; } .sidebar { max-height: 150px; border-right: 0; border-bottom: 1px solid color-mix(in srgb, currentColor 11%, transparent); } .grid { grid-template-columns: 1fr; } }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.hidden = true;
    dialog = backdrop;
    const box = document.createElement("section");
    box.className = "dialog";
    const top = document.createElement("header");
    top.className = "top";
    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "环境注入器";
    const subtitle = document.createElement("p");
    subtitle.textContent = "环境 Profiles · 提示词 · Memories · 权限";
    heading.append(title, subtitle);
    const topActions = document.createElement("div");
    topActions.className = "top-actions";
    const tutorial = document.createElement("button");
    tutorial.type = "button";
    tutorial.className = "action tutorial-button";
    tutorial.textContent = "使用教程";
    tutorial.addEventListener("click", () => {
      closeStudio();
      window[INJECTOR_GLOBAL_KEY]?.viewTutorial?.();
    }, { signal });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button";
    close.textContent = "×";
    close.addEventListener("click", closeStudio, { signal });
    topActions.append(tutorial, close);
    top.append(heading, topActions);

    const body = document.createElement("div");
    body.className = "body";
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "new-button";
    newButton.textContent = "+ 新建环境";
    newButton.addEventListener("click", clearForm, { signal });
    ui.profileList = document.createElement("div");
    ui.profileList.className = "profile-list";
    sidebar.append(newButton, ui.profileList);

    const editor = document.createElement("main");
    editor.className = "editor";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".md,text/markdown,text/plain";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => loadAgentsFile(fileInput.files?.[0]), { signal });
    const drop = document.createElement("div");
    drop.className = "drop";
    drop.tabIndex = 0;
    ui.fileLabel = document.createElement("strong");
    ui.fileLabel.textContent = "拖入或选择 AGENTS.md";
    const dropHint = document.createElement("small");
    dropHint.textContent = "文件内容会成为 developerInstructions";
    drop.append(ui.fileLabel, dropHint, fileInput);
    drop.addEventListener("click", () => fileInput.click(), { signal });
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") fileInput.click();
    }, { signal });
    for (const name of ["dragenter", "dragover"]) {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.dataset.drag = "true";
      }, { signal });
    }
    for (const name of ["dragleave", "drop"]) {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        delete drop.dataset.drag;
      }, { signal });
    }
    drop.addEventListener("drop", (event) => loadAgentsFile(event.dataTransfer?.files?.[0]), { signal });

    ui.id = textInput("例如 my-work");
    ui.name = textInput("显示名称");
    ui.model = textInput("留空继承 Base");
    ui.provider = textInput("留空继承 Base");
    ui.reasoning = selectInput([
      ["", "继承推理强度"], ["low", "Low"], ["medium", "Medium"], ["high", "High"],
      ["xhigh", "Extra high"], ["max", "Max"], ["ultra", "Ultra"],
    ]);
    ui.approval = selectInput([
      ["", "继承审批策略"], ["on-request", "On request"], ["untrusted", "Untrusted"], ["never", "Never"],
    ]);
    ui.sandbox = selectInput([
      ["", "继承沙箱"], ["read-only", "Read only"], ["workspace-write", "Workspace write"], ["danger-full-access", "Full access"],
    ]);
    ui.serviceTier = textInput("留空继承，例如 default / priority");
    ui.memoryUse = selectInput([
      ["inherit", "继承 Memory 读取"], ["on", "使用已有 Memories"], ["off", "禁用已有 Memories"],
    ]);
    ui.memoryGenerate = selectInput([
      ["inherit", "继承 Memory 生成"], ["on", "允许生成未来 Memories"], ["off", "禁止本会话进入 Memories"],
    ]);
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(
      field("环境 ID", ui.id), field("显示名称", ui.name),
      field("模型（可选）", ui.model), field("Provider（可选）", ui.provider),
      field("推理强度（可选）", ui.reasoning), field("审批策略（可选）", ui.approval),
      field("沙箱（可选）", ui.sandbox), field("Service tier（可选）", ui.serviceTier),
      field("Memory 读取", ui.memoryUse), field("Memory 生成", ui.memoryGenerate),
    );

    ui.instructions = document.createElement("textarea");
    ui.instructions.placeholder = "环境级 Developer Instructions / AGENTS.md 内容";
    const instructionsField = field("Developer Instructions / AGENTS.md", ui.instructions);
    ui.baseInstructions = document.createElement("textarea");
    ui.baseInstructions.className = "compact";
    ui.baseInstructions.placeholder = "可选：覆盖环境的 Base Instructions；留空继承 Codex 默认。";
    const baseInstructionsField = field("Base Instructions（高级，可选）", ui.baseInstructions);

    const actions = document.createElement("div");
    actions.className = "actions";
    ui.useNext = document.createElement("input");
    ui.useNext.type = "checkbox";
    ui.useNext.checked = true;
    const useNextLabel = document.createElement("label");
    useNextLabel.className = "check";
    const useNextText = document.createElement("span");
    useNextText.textContent = "保存后设为下个对话";
    useNextLabel.append(ui.useNext, useNextText);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "action primary";
    save.textContent = "打包并保存";
    save.addEventListener("click", saveCurrentProfile, { signal });
    ui.saveButton = save;
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "action";
    exportButton.textContent = "导出 .config.toml";
    exportButton.addEventListener("click", exportCurrentProfile, { signal });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "action danger";
    remove.textContent = "删除";
    remove.disabled = true;
    remove.addEventListener("click", deleteCurrentProfile, { signal });
    ui.removeButton = remove;
    actions.append(useNextLabel, save, exportButton, remove);

    ui.status = document.createElement("div");
    ui.status.className = "status";
    editor.append(drop, grid, instructionsField, baseInstructionsField, actions, ui.status);
    body.append(sidebar, editor);
    box.append(top, body);
    backdrop.append(box);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) closeStudio();
    }, { signal });
    shadow.append(style, backdrop);
    document.documentElement.append(host);
    clearForm();
  }

  function openStudio() {
    if (uiAdapter?.open) {
      uiAdapter.open();
      return;
    }
    store = loadStore();
    renderProfileList();
    if (dialog) dialog.hidden = false;
    host.style.pointerEvents = "auto";
  }

  function closeStudio() {
    if (uiAdapter?.close) {
      uiAdapter.close();
      return;
    }
    if (dialog) dialog.hidden = true;
    if (host) host.style.pointerEvents = "none";
  }

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findSidebarReference() {
    const roots = Array.from(document.querySelectorAll('nav,aside,[role="navigation"]'));
    const elements = roots.length
      ? roots.flatMap((root) => Array.from(root.querySelectorAll('a,button,[role="button"]')))
      : Array.from(document.querySelectorAll('a,button,[role="button"]'));
    const exact = (element, labels) => {
      const text = normalizedText([
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent,
      ].filter(Boolean).join(" "));
      return labels.some((label) => text === label || text.endsWith(` ${label}`));
    };
    return elements.find((element) => exact(element, ["插件", "plugins"]))
      || elements.find((element) => exact(element, ["已安排", "scheduled"]));
  }

  function replaceNavText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const target = nodes.find((node) => /^(插件|plugins|已安排|scheduled)$/i.test(String(node.nodeValue || "").trim()));
    if (target) target.nodeValue = "环境注入器";
    else {
      const text = document.createElement("span");
      text.textContent = "环境注入器";
      root.append(text);
    }
  }

  function installSidebarEntry() {
    if (destroyed) return;
    if (document.querySelector(`[${NAV_ATTR}]`)) return;
    const reference = findSidebarReference();
    if (!reference || !reference.parentElement) return;
    const clone = reference.cloneNode(true);
    clone.setAttribute(NAV_ATTR, "true");
    clone.removeAttribute("id");
    clone.removeAttribute("aria-current");
    clone.removeAttribute("data-state");
    if (clone instanceof HTMLAnchorElement) clone.href = "#";
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    replaceNavText(clone);
    clone.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openStudio();
    }, { signal });
    reference.insertAdjacentElement("afterend", clone);
    navNode = clone;
  }

  function scheduleSidebarScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      installSidebarEntry();
    }, 120);
  }

  function attachUiAdapter(adapter) {
    if (!adapter || typeof adapter.open !== "function" || typeof adapter.close !== "function") {
      throw new TypeError("Environment Studio UI adapter is invalid");
    }
    if (uiAdapter && uiAdapter !== adapter) {
      try { uiAdapter.destroy?.(); } catch {}
    }
    uiAdapter = adapter;
    if (dialog) dialog.hidden = true;
    if (host) host.style.pointerEvents = "none";
    return () => {
      if (uiAdapter !== adapter) return;
      uiAdapter = null;
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    lifetime.abort();
    observer?.disconnect();
    window.clearTimeout(scanTimer);
    try { uiAdapter?.destroy?.(); } catch {}
    uiAdapter = null;
    navNode?.remove();
    host?.remove();
    const currentApi = window[GLOBAL_KEY];
    if (window[LEGACY_GLOBAL_KEY] === currentApi || window[LEGACY_GLOBAL_KEY]?.version === VERSION) {
      delete window[LEGACY_GLOBAL_KEY];
    }
    if (currentApi?.version === VERSION) delete window[GLOBAL_KEY];
  }

  if (window.__CODEX_ENVIRONMENT_STUDIO_TEST__ || window.__CODEX_PROFILE_STUDIO_TEST__) {
    const testApi = {
      slugify,
      titleFromMarkdown,
      profileToml,
      likelyContainsSecret,
      validateProfile,
      profileEntries,
      fileProfileEntries,
      storedProfileEntries,
      selectorProfileId,
      storageKeyFor,
      environmentStore: () => cloneJson(store),
    };
    window.__codexEnvironmentStudioTest = testApi;
    window.__codexPlusProfileStudioTest = testApi;
    return;
  }

  createUi();
  installSidebarEntry();
  observer = new MutationObserver(scheduleSidebarScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog && !dialog.hidden) closeStudio();
  }, { signal });
  window.addEventListener(UPDATE_EVENT, () => {
    store = loadStore();
    renderProfileList();
  }, { signal });

  const publicApi = {
    version: VERSION,
    open: openStudio,
    close: closeStudio,
    attachUiAdapter,
    list: () => profileEntries().map(({ id, name, model, modelProvider, memoryPolicy, updatedAt, sourceKind, targetProfileId }) => ({ id, name, model, modelProvider, memoryPolicy, updatedAt, sourceKind, targetProfileId })),
    status: () => {
      let adapterStatus = null;
      try { adapterStatus = uiAdapter?.status?.() || null; } catch {}
      return {
        name: "环境注入器",
        version: VERSION,
        profiles: profileEntries().length,
        fileProfiles: fileProfileEntries().length,
        storedProfiles: storedProfileEntries().length,
        storeRevision: Number(store.revision || 0),
        sidebarInstalled: !!document.querySelector(`[${NAV_ATTR}]`),
        open: adapterStatus ? adapterStatus.open === true : !!dialog && !dialog.hidden,
        renderer: adapterStatus ? "react" : "vanilla",
      };
    },
    destroy,
  };
  window[GLOBAL_KEY] = publicApi;
  window[LEGACY_GLOBAL_KEY] = publicApi;
})();
