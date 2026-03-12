const $ = (id) => document.getElementById(id);

let skillState = [];
let installPollTimer = null;
let latestOverview = null;
let stopArmedUntil = 0;
const CLAWHUB_RECOMMENDATIONS = [
  {
    name: "codexmonitor",
    summary: "观察 Codex 会话与运行状态，适合日常巡检。",
    href: "https://clawhub.ai/odrobnik/codexmonitor",
    installName: ""
  },
  {
    name: "playwright",
    summary: "自动化回归与端到端测试，适合稳定性优化。",
    href: "https://clawhub.ai/openai/skills",
    installName: "playwright"
  },
  {
    name: "screenshot",
    summary: "快速截图留档，方便版本前后对比。",
    href: "https://clawhub.ai/openai/skills",
    installName: "screenshot"
  },
  {
    name: "openai-docs",
    summary: "查询官方文档，减少模型与 API 配置误差。",
    href: "https://clawhub.ai/openai/skills",
    installName: "openai-docs"
  },
  {
    name: "doc",
    summary: "文档提炼与整理，适合交接和知识沉淀。",
    href: "https://clawhub.ai/openai/skills",
    installName: "doc"
  }
];

function setLog(text) {
  $("commandLog").textContent = text || "(empty)";
}

function setActionFeedback(text, tone = "") {
  const el = $("actionFeedback");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "fail");
  if (tone) el.classList.add(tone);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function setLoading(visible, text) {
  const overlay = $("loadingOverlay");
  const label = $("loadingText");
  if (!overlay || !label) return;
  if (text) label.textContent = text;
  overlay.classList.toggle("hidden", !visible);
}

function beginBtnLoading(btn, loadingText) {
  if (!btn) return () => {};
  const label = btn.querySelector("span");
  if (label && !btn.dataset.defaultLabel) {
    btn.dataset.defaultLabel = label.textContent || "";
  }
  btn.disabled = true;
  btn.classList.add("is-loading");
  if (label && loadingText) label.textContent = loadingText;
  return () => {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    const restoreLabel = btn.dataset.defaultLabel || "";
    const labelNode = btn.querySelector("span");
    if (labelNode && restoreLabel) labelNode.textContent = restoreLabel;
  };
}

function resetAllButtonLoadingStates() {
  for (const btn of document.querySelectorAll(".btn.is-loading")) {
    btn.classList.remove("is-loading");
    btn.disabled = false;
    const restoreLabel = btn.dataset.defaultLabel || "";
    const labelNode = btn.querySelector("span");
    if (labelNode && restoreLabel) labelNode.textContent = restoreLabel;
  }
}

function installReady(data) {
  return data.openclawInstalled === true
    || data.gatewayUp === true
    || (data.currentModel && data.currentModel !== "unknown")
    || Number(data.sessionsCount || 0) > 0;
}

function stages(data) {
  const installed = installReady(data);
  const configured = installed && data.currentModel && data.currentModel !== "unknown";
  const manageable = installed && data.gatewayUp === true;
  const optimized = manageable && ((data.fallbacks || []).length > 0 || Number(data.sessionsCount || 0) > 0);
  return [
    { key: "install", done: installed, todo: "先完成安装" },
    { key: "configure", done: configured, todo: "配置并测试模型" },
    { key: "manage", done: manageable, todo: "启动网关进入管理" },
    { key: "optimize", done: optimized, todo: "补充 fallback 与技能" }
  ];
}

function activeTab() {
  const tab = document.querySelector(".tab.is-active");
  return tab?.dataset.tab || "install";
}

function activateTab(tabName) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.tab === tabName);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("is-active", panel.id === `panel-${tabName}`);
  }
  for (const node of document.querySelectorAll(".flow-node")) {
    node.classList.toggle("is-active", node.dataset.tab === tabName);
  }
}

function renderWorkflow(data) {
  const current = activeTab();
  const s = stages(data);
  const next = s.find((x) => !x.done);
  $("nextAction").textContent = next ? `下一步：${next.todo}` : "状态健康，可持续管理。";
  for (const node of document.querySelectorAll(".flow-node")) {
    const item = s.find((x) => x.key === node.dataset.tab);
    node.classList.toggle("is-done", Boolean(item?.done));
    node.classList.toggle("is-active", node.dataset.tab === current);
  }
}

function renderMetrics(data) {
  const list = [
    ["Gateway", data.gatewayUp ? "在线" : "离线", data.gatewayUp ? "ok" : "fail"],
    ["当前模型", data.currentModel || "unknown", ""],
    ["模型数", String((data.allowedModels || []).length), ""],
    ["Session", String(data.sessionsCount || 0), ""],
    ["成功率", `${data.successRate ?? 0}%`, ""],
    ["Token", Intl.NumberFormat().format(data.tokenStats?.totalTokens || 0), ""]
  ];
  $("metrics").innerHTML = list.map(([k, v, cls]) => `
    <article class="metric"><p>${k}</p><b class="${cls}">${v}</b></article>
  `).join("");
}

function renderInstallPanel(data, install) {
  const installed = installReady(data);
  const txt = installed ? `已安装：${data.openclawVersion || "OpenClaw"}` : "未检测到 OpenClaw CLI";
  const status = $("installStatusText");
  status.textContent = txt;
  status.classList.toggle("ok", installed);
  status.classList.toggle("fail", !installed);

  const taskText = install
    ? `安装任务：${install.status}${install.startedAt ? `（${new Date(install.startedAt).toLocaleString()}）` : ""}`
    : "安装任务：未开始";
  $("installTaskText").textContent = taskText;
  $("installLog").textContent = install?.logs?.length ? install.logs.join("\n") : "暂无安装日志。";

  const runBtn = $("runInstallBtn");
  runBtn.disabled = install?.status === "running";
  runBtn.querySelector("span").textContent = install?.status === "running" ? "安装进行中..." : "一键安装";
}

function renderConfig(data) {
  const checks = [
    [installReady(data), "CLI 已可用"],
    [data.gatewayUp === true, "网关已启动"],
    [Array.isArray(data.allowedModels) && data.allowedModels.length > 0, "模型列表已加载"],
    [data.currentModel && data.currentModel !== "unknown", "默认模型已设置"]
  ];
  $("configChecklist").innerHTML = checks
    .map(([ok, text]) => `<li class="${ok ? "ok" : "fail"}">${ok ? "已完成" : "待完成"} · ${text}</li>`)
    .join("");

  const models = data.allowedModels || [];
  const select = $("modelSelect");
  select.innerHTML = models.length ? models.map((m) => `<option value="${m}">${m}</option>`).join("") : `<option value="">暂无可用模型</option>`;
  if (data.currentModel && models.includes(data.currentModel)) select.value = data.currentModel;

  $("aliasList").innerHTML = (data.aliases?.length ? data.aliases : ["暂无 alias"]).map((x) => `<li>${x}</li>`).join("");
  $("fallbackList").innerHTML = (data.fallbacks?.length ? data.fallbacks : ["暂无 fallback"]).map((x) => `<li>${x}</li>`).join("");
}

function renderManage(data) {
  const badge = $("gatewayBadge");
  badge.textContent = data.gatewayUp ? "网关运行中" : "网关未启动";
  badge.className = `badge ${data.gatewayUp ? "ok" : "fail"}`;

  const channels = data.channels?.length ? data.channels : ["暂无渠道状态"];
  $("channelsList").innerHTML = channels.map((x) => `<li>${x}</li>`).join("");

  const rows = (data.recentSessions || []).map((s) => `
    <tr>
      <td>${s.key}</td><td>${s.model}</td><td>${Intl.NumberFormat().format(s.totalTokens)}</td>
      <td>${s.usagePct == null ? "-" : `${s.usagePct}%`}</td>
      <td class="${s.abortedLastRun ? "fail" : "ok"}">${s.abortedLastRun ? "失败" : "正常"}</td>
      <td>${s.age || "-"}</td>
    </tr>
  `).join("");
  $("sessionsBody").innerHTML = rows || `<tr><td colspan="6">暂无数据</td></tr>`;
}

function renderOptimize(data) {
  const tips = [];
  if (!data.gatewayUp) tips.push("先启动网关，保证通道可用。");
  if (!data.currentModel || data.currentModel === "unknown") tips.push("设置默认模型并做连通测试。");
  if ((data.fallbacks || []).length === 0) tips.push("建议添加 1-2 个 fallback 模型兜底。");
  if ((data.sessionsCount || 0) > 30) tips.push("建议定期清理 Session，降低管理成本。");
  if (!tips.length) tips.push("当前状态良好，可继续扩展技能。");
  $("tipsList").innerHTML = tips.map((x) => `<li>${x}</li>`).join("");

  const descMap = {
    playwright: "自动化回归测试",
    screenshot: "状态截图归档",
    "openai-docs": "官方文档辅助",
    doc: "文档整理与提炼"
  };
  const fallback = ["playwright", "screenshot", "openai-docs", "doc"].map((name) => ({ name, installed: false, available: false }));
  const skills = skillState.length ? skillState : fallback;
  const skillMap = new Map(skills.map((item) => [item.name, item]));
  $("skillCards").innerHTML = skills.map((item) => `
    <article class="skill-card">
      <div class="skill-card-head"><strong>${item.name}</strong><span class="${item.installed ? "mini-badge ok" : "mini-badge"}">${item.installed ? "已安装" : (item.available ? "可安装" : "待检测")}</span></div>
      <p>${descMap[item.name] || "提升效率"}</p>
      <button class="btn btn-primary" type="button" data-install-skill="${item.name}" ${item.installed || !item.available ? "disabled" : ""}>
        <i class="ri-download-2-line"></i><span>${item.installed ? "已安装" : "安装技能"}</span>
      </button>
    </article>
  `).join("");

  $("clawhubCards").innerHTML = CLAWHUB_RECOMMENDATIONS.map((item) => {
    const state = item.installName ? skillMap.get(item.installName) : null;
    const statusText = state?.installed ? "已安装" : (state?.available ? "可一键安装" : "商店推荐");
    const statusClass = state?.installed ? "mini-badge ok" : "mini-badge";
    const installDisabled = !item.installName || state?.installed || !state?.available;
    return `
      <article class="store-card">
        <div class="skill-card-head">
          <strong>${item.name}</strong>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <p>${item.summary}</p>
        <div class="store-actions">
          <a class="btn btn-ghost" href="${item.href}" target="_blank" rel="noreferrer">
            <i class="ri-external-link-line"></i><span>商店详情</span>
          </a>
          <button class="btn btn-primary" type="button" data-install-skill="${item.installName || ""}" ${installDisabled ? "disabled" : ""}>
            <i class="ri-download-2-line"></i><span>${state?.installed ? "已安装" : "一键安装"}</span>
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function updateInstallPolling(installStatus) {
  if (installStatus?.status === "running") {
    if (!installPollTimer) installPollTimer = setInterval(loadInstallStatusOnly, 2000);
  } else if (installPollTimer) {
    clearInterval(installPollTimer);
    installPollTimer = null;
  }
}

async function loadSkills() {
  try {
    const res = await fetch("/api/skills/recommended", { cache: "no-store" });
    const data = await res.json();
    skillState = data.ok && Array.isArray(data.skills) ? data.skills : [];
  } catch {
    skillState = [];
  }
}

function renderAll(data, install) {
  latestOverview = data;
  renderWorkflow(data);
  renderMetrics(data);
  renderInstallPanel(data, install);
  renderConfig(data);
  renderManage(data);
  renderOptimize(data);
  $("timeLabel").textContent = new Date(data.now).toLocaleString();
}

async function loadOverview() {
  setLoading(true, "正在重新连接你的 OpenClaw（可能需要 10-20s，请耐心等待）");
  setActionFeedback("正在重新连接...");
  try {
    const [overviewRes, installRes] = await Promise.all([
      fetch("/api/overview", { cache: "no-store" }),
      fetch("/api/install/status", { cache: "no-store" })
    ]);
    const overview = await overviewRes.json();
    const install = await installRes.json();
    renderAll(overview, install.install || null);
    updateInstallPolling(install.install || null);
    resetAllButtonLoadingStates();
    setLoading(false);
  } catch (error) {
    setLoading(true, "连接失败，请确认服务已启动后重试。");
    setLog(String(error?.message || error));
  }
}

async function loadInstallStatusOnly() {
  try {
    const res = await fetch("/api/install/status", { cache: "no-store" });
    const data = await res.json();
    if (data.install) {
      renderInstallPanel(latestOverview || { openclawInstalled: false }, data.install);
      updateInstallPolling(data.install);
      if (data.install.status !== "running") await loadOverview();
    }
  } catch {
    // ignore
  }
}

async function runInstall() {
  const endLoading = beginBtnLoading($("runInstallBtn"), "安装中...");
  setLog("正在启动安装任务...");
  try {
    const res = await fetch("/api/install/start", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      setLog(data.error || "安装任务启动失败");
      return;
    }
    activateTab("install");
    setLog("安装任务已启动。可在安装日志查看进度。");
    await loadOverview();
  } finally {
    endLoading();
  }
}

async function applyModel() {
  const endLoading = beginBtnLoading($("applyModelBtn"), "应用中...");
  const model = $("customModel").value.trim() || $("modelSelect").value;
  try {
    if (!model) return;
    $("modelResult").textContent = `正在切换到 ${model} ...`;
    const res = await fetch("/api/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
    const data = await res.json();
    if (!data.ok) {
      $("modelResult").textContent = `切换失败：${data.error || "unknown"}`;
      setLog(data.raw || JSON.stringify(data, null, 2));
      return;
    }
    $("modelResult").textContent = `已切换：${data.currentModel}`;
    setLog(data.raw || "模型已切换");
    await loadOverview();
  } finally {
    endLoading();
  }
}

async function testModelConnectivity() {
  const model = $("customModel").value.trim() || $("modelSelect").value;
  if (!model) return setLog("请先选择模型");
  const endLoading = beginBtnLoading($("testModelBtn"), "测试中...");
  try {
    const res = await fetch("/api/model/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
    const data = await res.json();
    setLog(data.raw || JSON.stringify(data, null, 2));
    $("modelResult").textContent = data.ok ? `连通性测试通过：${model}` : `连通性测试失败：${model}`;
    await loadOverview();
  } finally {
    endLoading();
  }
}

async function addModelConfig() {
  const endLoading = beginBtnLoading($("addModelBtn"), "保存中...");
  const payload = {
    baseUrl: $("openaiBaseUrl").value.trim(),
    model: $("openaiModelId").value.trim(),
    apiKey: $("openaiApiKey").value.trim(),
    provider: $("openaiProviderKey").value.trim() || "openai-chat",
    alias: $("newModelAlias").value.trim(),
    setDefault: $("newModelSetDefault").checked,
    addFallback: $("newModelAddFallback").checked
  };
  try {
    if (!payload.baseUrl || !payload.model || !payload.apiKey) return setLog("请填写 baseUrl / model / apiKey");
    const res = await fetch("/api/model/openai-chat/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    setLog(data.raw || JSON.stringify(data, null, 2));
    if (data.ok) {
      $("openaiBaseUrl").value = "";
      $("openaiModelId").value = "";
      $("openaiApiKey").value = "";
      $("openaiProviderKey").value = "";
      $("newModelAlias").value = "";
      await loadOverview();
    }
  } finally {
    endLoading();
  }
}

async function callGateway(action) {
  if (action === "stop") {
    const now = Date.now();
    const btn = document.querySelector("button[data-gateway=\"stop\"]");
    if (now > stopArmedUntil) {
      stopArmedUntil = now + 5000;
      if (btn) {
        btn.classList.add("armed");
        const label = btn.querySelector("span");
        if (label) label.textContent = "再次点击确认";
      }
      setLog("停止保护已激活：请在 5 秒内再次点击“停止”确认。");
      setTimeout(() => {
        if (Date.now() > stopArmedUntil && btn) {
          btn.classList.remove("armed");
          const label = btn.querySelector("span");
          if (label) label.textContent = "停止";
        }
      }, 5200);
      return;
    }
    stopArmedUntil = 0;
    if (btn) {
      btn.classList.remove("armed");
      const label = btn.querySelector("span");
      if (label) label.textContent = "停止";
    }
  }
  const btn = document.querySelector(`button[data-gateway="${action}"]`);
  const endLoading = beginBtnLoading(btn, "处理中...");
  try {
    const data = await fetchJsonWithTimeout("/api/gateway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    }, 40000);
    setLog(data.raw || JSON.stringify(data, null, 2));
    setActionFeedback(data.ok ? `网关${action}执行完成` : `网关${action}执行失败`, data.ok ? "ok" : "fail");
    await loadOverview();
  } catch (error) {
    const msg = String(error?.message || error);
    setLog(`gateway ${action} 请求失败: ${msg}`);
    setActionFeedback(`网关${action}超时或失败`, "fail");
  } finally {
    endLoading();
  }
}

function renderQuickUpdate(data) {
  const status = $("updateQuickStatus");
  const meta = $("updateQuickMeta");
  if (!status || !meta) return;
  if (!data) {
    status.textContent = "尚未检查更新";
    status.classList.remove("ok", "fail");
    meta.textContent = "点击“检查更新”获取版本信息。";
    return;
  }
  const available = data.available === true;
  status.textContent = available ? `发现新版本：${data.latestVersion || "unknown"}` : "当前已是最新版本";
  status.classList.toggle("ok", !available);
  status.classList.toggle("fail", available);
  meta.textContent = `当前 ${data.currentVersion || "unknown"} · 通道 ${data.channelLabel || "-"}`;
}

async function checkUpdateStatus(triggerId = "checkUpdateBtn") {
  const endLoading = beginBtnLoading($(triggerId), "检查中...");
  setLog("正在检查版本更新状态...");
  try {
    const data = await fetchJsonWithTimeout("/api/update/status", { cache: "no-store" }, 45000);
    if (!data.ok) {
      setLog(`版本检查失败：${data.error || "unknown error"}\n\n${data.raw || ""}`.trim());
      setActionFeedback("版本检查失败", "fail");
      renderQuickUpdate(null);
      return;
    }
    const channel = data.channelLabel || data.update?.channel?.label || "-";
    const latest = data.latestVersion || "无法获取";
    const available = data.available === true ? "有可用更新" : "暂未发现可用更新";
    const registry = data.registryError ? `Registry 错误: ${data.registryError}` : "Registry: 正常";
    const summary = [
      `当前版本: ${data.currentVersion || "unknown"}`,
      `通道: ${channel}`,
      `最新版本: ${latest}`,
      `检查结果: ${available}`,
      registry
    ].join("\n");
    const dryRunActions = Array.isArray(data.dryRun?.actions) ? data.dryRun.actions : [];
    const actionText = dryRunActions.length ? `\n\n可执行更新动作:\n- ${dryRunActions.join("\n- ")}` : "";
    setLog(`${summary}${actionText}\n\n${data.raw || ""}`.trim());
    setActionFeedback(data.available ? `发现新版本 ${data.latestVersion}` : "版本检查完成，无可用更新", data.available ? "ok" : "");
    renderQuickUpdate(data);
  } catch (error) {
    const msg = String(error?.message || error);
    setLog(`版本检查请求失败: ${msg}`);
    setActionFeedback("版本检查超时或失败", "fail");
    renderQuickUpdate(null);
  } finally {
    endLoading();
  }
}

async function runUpdateNow() {
  const endLoading = beginBtnLoading($("runUpdateBtn"), "更新中...");
  setLog("正在执行一键更新，请稍候...");
  try {
    const data = await fetchJsonWithTimeout("/api/update/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true })
    }, 120000);
    setLog(data.raw || JSON.stringify(data, null, 2));
    if (!data.ok) {
      setActionFeedback("一键更新失败", "fail");
      return;
    }
    setActionFeedback("一键更新执行完成", "ok");
    await checkUpdateStatus("checkUpdateInstallBtn");
    await loadOverview();
  } catch (error) {
    const msg = String(error?.message || error);
    setLog(`一键更新请求失败: ${msg}`);
    setActionFeedback("一键更新超时或失败", "fail");
  } finally {
    endLoading();
  }
}

async function createNewSession() {
  const endLoading = beginBtnLoading($("newSessionBtn"), "创建中...");
  const to = $("sessionTo").value.trim();
  const message = $("sessionMessage").value.trim();
  try {
    if (!to || !message) return setLog("新建 Session 需要 to 和 message");
    const res = await fetch("/api/session/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, message })
    });
    const data = await res.json();
    setLog(data.raw || JSON.stringify(data, null, 2));
    await loadOverview();
  } finally {
    endLoading();
  }
}

async function cleanupSessions() {
  const endLoading = beginBtnLoading($("cleanupBtn"), "清理中...");
  try {
    const res = await fetch("/api/sessions/cleanup", { method: "POST" });
    const data = await res.json();
    setLog(data.raw || JSON.stringify(data, null, 2));
    await loadOverview();
  } finally {
    endLoading();
  }
}

async function installSkill(name, button) {
  button.disabled = true;
  const res = await fetch("/api/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  setLog(data.raw || JSON.stringify(data, null, 2));
  await loadSkills();
  await loadOverview();
}

async function copyInstallCommand() {
  try {
    await navigator.clipboard.writeText($("installCommand").textContent || "");
    setLog("安装命令已复制。");
  } catch {
    setLog("复制失败，请手动复制。");
  }
}

$("refreshBtn").addEventListener("click", loadOverview);
$("runInstallBtn").addEventListener("click", runInstall);
$("copyInstallBtn").addEventListener("click", copyInstallCommand);
$("applyModelBtn").addEventListener("click", applyModel);
$("testModelBtn").addEventListener("click", testModelConnectivity);
$("addModelBtn").addEventListener("click", addModelConfig);
$("newSessionBtn").addEventListener("click", createNewSession);
$("cleanupBtn").addEventListener("click", cleanupSessions);
$("checkUpdateBtn").addEventListener("click", () => checkUpdateStatus("checkUpdateBtn"));
$("checkUpdateInstallBtn").addEventListener("click", () => checkUpdateStatus("checkUpdateInstallBtn"));
$("runUpdateBtn").addEventListener("click", runUpdateNow);

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
}
for (const node of document.querySelectorAll(".flow-node")) {
  node.addEventListener("click", () => activateTab(node.dataset.tab));
}
for (const btn of document.querySelectorAll("[data-jump]")) {
  btn.addEventListener("click", () => activateTab(btn.dataset.jump));
}
for (const btn of document.querySelectorAll("button[data-gateway]")) {
  btn.addEventListener("click", () => callGateway(btn.getAttribute("data-gateway")));
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const button = target instanceof HTMLElement ? target.closest("button[data-install-skill]") : null;
  if (!button) return;
  const name = button.getAttribute("data-install-skill");
  if (!name) return;
  installSkill(name, button);
});

setLoading(true, "初始化状态采集中（可能需要 10-20s，请耐心等待）");
setActionFeedback("等待操作...");
for (const btn of document.querySelectorAll(".btn")) {
  const label = btn.querySelector("span");
  if (label && !btn.dataset.defaultLabel) btn.dataset.defaultLabel = label.textContent || "";
}
Promise.all([loadSkills(), loadOverview()]).finally(() => {
  setInterval(loadOverview, 15000);
});
