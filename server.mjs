import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 19190);
const host = process.env.HOST || "0.0.0.0";
const OPENCLAW_INSTALL_CMD = "curl -fsSL https://openclaw.ai/install.sh | bash";
const SKILL_INSTALLER_DIR = join(homedir(), ".codex/skills/.system/skill-installer/scripts");
const SKILL_LIST_SCRIPT = join(SKILL_INSTALLER_DIR, "list-skills.py");
const SKILL_INSTALL_SCRIPT = join(SKILL_INSTALLER_DIR, "install-skill-from-github.py");
const RECOMMENDED_SKILLS = ["playwright", "screenshot", "openai-docs", "doc"];

const installTask = {
  status: "idle",
  startedAt: null,
  endedAt: null,
  code: null,
  command: OPENCLAW_INSTALL_CMD,
  logs: []
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

async function runOpenClaw(args, timeout = 45000) {
  try {
    const { stdout, stderr } = await execFileAsync("openclaw", args, {
      timeout,
      maxBuffer: 1024 * 1024 * 8
    });
    return { ok: true, args, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (error) {
    return {
      ok: false,
      args,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || error.message || ""),
      code: error.code ?? -1
    };
  }
}

function runOpenClawNoCap(args, timeout = 0) {
  return runOpenClaw(args, timeout);
}

function pickJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatAgeMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 48) return `${hour}h`;
  return `${Math.floor(hour / 24)}d`;
}

function normalizeSessionModel(session) {
  if (!session) return null;
  const raw = session.modelOverride || session.model || "";
  if (!raw) return null;
  if (raw.includes("/")) return raw;
  const provider = session.providerOverride || session.modelProvider || "";
  return provider ? `${provider}/${raw}` : raw;
}

function cmdOutputText(result) {
  return `${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
}

function pushInstallLog(line) {
  if (!line) return;
  installTask.logs.push(`[${new Date().toISOString()}] ${line}`);
  if (installTask.logs.length > 400) {
    installTask.logs.splice(0, installTask.logs.length - 400);
  }
}

function getInstallStatus() {
  return {
    status: installTask.status,
    startedAt: installTask.startedAt,
    endedAt: installTask.endedAt,
    code: installTask.code,
    command: installTask.command,
    logs: installTask.logs.slice(-160)
  };
}

function startInstallTask() {
  if (installTask.status === "running") {
    return { ok: false, error: "install task is already running", install: getInstallStatus() };
  }

  installTask.status = "running";
  installTask.startedAt = new Date().toISOString();
  installTask.endedAt = null;
  installTask.code = null;
  installTask.logs = [];
  pushInstallLog(`start: ${OPENCLAW_INSTALL_CMD}`);

  const child = spawn("/bin/zsh", ["-lc", OPENCLAW_INSTALL_CMD], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => pushInstallLog(String(chunk || "").trim()));
  child.stderr.on("data", (chunk) => pushInstallLog(String(chunk || "").trim()));
  child.on("error", (error) => {
    installTask.status = "failed";
    installTask.endedAt = new Date().toISOString();
    installTask.code = -1;
    pushInstallLog(`spawn error: ${String(error?.message || error)}`);
  });
  child.on("close", (code) => {
    installTask.status = code === 0 ? "success" : "failed";
    installTask.endedAt = new Date().toISOString();
    installTask.code = code ?? -1;
    pushInstallLog(`finished with code=${installTask.code}`);
  });

  return { ok: true, install: getInstallStatus() };
}

function startDashboard() {
  try {
    const child = spawn("openclaw", ["dashboard"], {
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function listRecommendedSkills() {
  const result = await execFileAsync("python3", [SKILL_LIST_SCRIPT, "--format", "json"], {
    timeout: 45000,
    maxBuffer: 1024 * 1024 * 2
  });
  const parsed = JSON.parse(String(result.stdout || "[]"));
  const skills = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed.skills) ? parsed.skills : []);
  const map = new Map(skills.map((s) => [s.name, s]));
  return RECOMMENDED_SKILLS.map((name) => {
    const item = map.get(name);
    return {
      name,
      installed: Boolean(item?.installed),
      available: Boolean(item)
    };
  });
}

async function installRecommendedSkill(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || !RECOMMENDED_SKILLS.includes(trimmed)) {
    return { ok: false, error: "unsupported skill name" };
  }
  const path = `skills/.curated/${trimmed}`;
  try {
    const { stdout, stderr } = await execFileAsync("python3", [
      SKILL_INSTALL_SCRIPT,
      "--repo",
      "openai/skills",
      "--path",
      path
    ], {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      ok: true,
      name: trimmed,
      raw: `${String(stdout || "")}${stderr ? `\n${String(stderr)}` : ""}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      name: trimmed,
      raw: `${String(error.stdout || "")}${error.stderr ? `\n${String(error.stderr)}` : ""}`.trim(),
      error: String(error?.message || "skill install failed")
    };
  }
}

async function getOverview() {
  const tasks = [
    ["versionRaw", ["--version"]],
    ["gatewayRaw", ["gateway", "status"]],
    ["channelsRaw", ["channels", "status"]],
    ["modelsRaw", ["models", "status", "--json"]],
    ["sessionsRaw", ["sessions", "--json"]],
    ["aliasesRaw", ["models", "aliases", "list"]],
    ["fallbacksRaw", ["models", "fallbacks", "list"]]
  ];

  const results = await Promise.allSettled(
    tasks.map(([, args]) => runOpenClawNoCap(args, 0))
  );

  const byKey = {};
  tasks.forEach(([key], idx) => {
    const item = results[idx];
    byKey[key] = item.status === "fulfilled" ? item.value : {
      ok: false,
      args: tasks[idx][1],
      stdout: "",
      stderr: String(item.reason || "unknown error"),
      code: "REJECTED"
    };
  });

  const {
    versionRaw,
    gatewayRaw,
    channelsRaw,
    modelsRaw,
    sessionsRaw,
    aliasesRaw,
    fallbacksRaw
  } = byKey;

  const modelsJson = pickJson(cmdOutputText(modelsRaw)) || {};
  const sessionsJson = pickJson(cmdOutputText(sessionsRaw)) || { sessions: [], count: 0 };
  const sessions = Array.isArray(sessionsJson.sessions) ? sessionsJson.sessions : [];

  const withTelemetry = sessions.filter((s) => typeof s.abortedLastRun === "boolean");
  const successRate = withTelemetry.length
    ? Number(((withTelemetry.filter((s) => !s.abortedLastRun).length / withTelemetry.length) * 100).toFixed(1))
    : 100;

  const totalTokens = sessions.reduce((sum, s) => sum + safeNumber(s.totalTokens), 0);
  const totalInputTokens = sessions.reduce((sum, s) => sum + safeNumber(s.inputTokens), 0);
  const totalOutputTokens = sessions.reduce((sum, s) => sum + safeNumber(s.outputTokens), 0);

  const sortedSessions = sessions
    .filter((s) => s.key && s.key !== "sessions")
    .sort((a, b) => safeNumber(b.updatedAt) - safeNumber(a.updatedAt));

  const recentSessions = sortedSessions
    .slice(0, 10)
    .map((s) => ({
      key: s.key,
      model: s.model || "-",
      totalTokens: safeNumber(s.totalTokens),
      usagePct: s.contextTokens ? Math.round((safeNumber(s.totalTokens) / safeNumber(s.contextTokens)) * 100) : null,
      abortedLastRun: s.abortedLastRun === true,
      age: formatAgeMs(s.ageMs)
    }));

  const channels = cmdOutputText(channelsRaw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, 12);
  const aliases = cmdOutputText(aliasesRaw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\\s*/, ""));
  const fallbacks = cmdOutputText(fallbacksRaw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\\s*/, ""));

  const gatewayText = cmdOutputText(gatewayRaw);
  const gatewayUp = gatewayText.includes("Runtime: running") && gatewayText.includes("RPC probe: ok");
  const versionText = cmdOutputText(versionRaw);
  const commandAvailable = versionRaw.ok || gatewayRaw.ok || modelsRaw.ok || sessionsRaw.ok || channelsRaw.ok;
  const openclawInstalled = commandAvailable;
  const defaultModel = modelsJson.resolvedDefault || modelsJson.defaultModel || "unknown";
  const latestSession = sortedSessions[0];
  const sessionModel = normalizeSessionModel(latestSession);
  const currentModel = sessionModel || defaultModel;
  const currentModelSource = sessionModel ? "session" : "default";

  const errors = {
    version: versionRaw.ok ? null : cmdOutputText(versionRaw) || "version failed",
    gateway: gatewayRaw.ok ? null : cmdOutputText(gatewayRaw) || "gateway failed",
    channels: channelsRaw.ok ? null : cmdOutputText(channelsRaw) || "channels failed",
    models: modelsRaw.ok ? null : cmdOutputText(modelsRaw) || "models failed",
    sessions: sessionsRaw.ok ? null : cmdOutputText(sessionsRaw) || "sessions failed",
    aliases: aliasesRaw.ok ? null : cmdOutputText(aliasesRaw) || "aliases failed",
    fallbacks: fallbacksRaw.ok ? null : cmdOutputText(fallbacksRaw) || "fallbacks failed"
  };
  const partial = Object.values(errors).some((v) => v);

  return {
    ok: true,
    source: "local-openclaw-cli",
    now: new Date().toISOString(),
    openclawInstalled,
    openclawVersion: versionText || "unknown",
    gatewayUp,
    currentModel,
    currentModelSource,
    defaultModel,
    allowedModels: Array.isArray(modelsJson.allowed) ? modelsJson.allowed : [],
    sessionsCount: safeNumber(sessionsJson.count),
    successRate,
    tokenStats: {
      totalTokens,
      totalInputTokens,
      totalOutputTokens
    },
    channels,
    aliases,
    fallbacks,
    recentSessions,
    diagnostics: {
      gatewayOk: gatewayRaw.ok,
      channelsOk: channelsRaw.ok,
      modelsOk: modelsRaw.ok,
      sessionsOk: sessionsRaw.ok
    },
    partial,
    errors
  };
}

async function setModel(model) {
  const trimmed = String(model || "").trim();
  if (!trimmed) return { ok: false, error: "model is required" };
  const setResult = await runOpenClaw(["models", "set", trimmed]);
  const statusResult = await runOpenClaw(["models", "status", "--json"]);
  const statusJson = pickJson(cmdOutputText(statusResult)) || {};
  const defaultModel = statusJson.resolvedDefault || statusJson.defaultModel || "unknown";
  return {
    ok: setResult.ok,
    applied: trimmed,
    currentModel: defaultModel,
    raw: cmdOutputText(setResult)
  };
}

async function getModelStatus() {
  const [statusResult, sessionsResult] = await Promise.all([
    runOpenClaw(["models", "status", "--json"]),
    runOpenClaw(["sessions", "--json"])
  ]);
  const statusJson = pickJson(cmdOutputText(statusResult)) || {};
  const sessionsJson = pickJson(cmdOutputText(sessionsResult)) || { sessions: [] };
  const sessions = Array.isArray(sessionsJson.sessions) ? sessionsJson.sessions : [];
  const latest = sessions
    .filter((s) => s && s.updatedAt)
    .sort((a, b) => safeNumber(b.updatedAt) - safeNumber(a.updatedAt))[0];
  const sessionModel = normalizeSessionModel(latest);
  const defaultModel = statusJson.resolvedDefault || statusJson.defaultModel || "unknown";
  const currentModel = sessionModel || defaultModel;
  return {
    ok: statusResult.ok || Boolean(currentModel && currentModel !== "unknown"),
    currentModel,
    currentModelSource: sessionModel ? "session" : "default",
    defaultModel,
    allowedModels: Array.isArray(statusJson.allowed) ? statusJson.allowed : [],
    error: statusResult.ok ? null : "models status failed"
  };
}

async function addModelConfig(payload) {
  const model = String(payload?.model || "").trim();
  const alias = String(payload?.alias || "").trim();
  const setDefault = payload?.setDefault !== false;
  const addFallback = payload?.addFallback !== false;
  if (!model) return { ok: false, error: "model is required" };

  const logs = [];
  let allOk = true;

  if (alias) {
    const aliasResult = await runOpenClaw(["models", "aliases", "add", alias, model]);
    allOk = allOk && aliasResult.ok;
    logs.push(`[aliases add] ${aliasResult.ok ? "ok" : "fail"}\\n${cmdOutputText(aliasResult)}`);
  }

  if (addFallback) {
    const fallbackResult = await runOpenClaw(["models", "fallbacks", "add", model]);
    allOk = allOk && fallbackResult.ok;
    logs.push(`[fallbacks add] ${fallbackResult.ok ? "ok" : "fail"}\\n${cmdOutputText(fallbackResult)}`);
  }

  if (setDefault) {
    const setResult = await runOpenClaw(["models", "set", model]);
    allOk = allOk && setResult.ok;
    logs.push(`[models set] ${setResult.ok ? "ok" : "fail"}\\n${cmdOutputText(setResult)}`);
  }

  const statusResult = await runOpenClaw(["models", "status", "--json"]);
  const statusJson = pickJson(cmdOutputText(statusResult)) || {};

  return {
    ok: allOk,
    model,
    currentModel: statusJson.resolvedDefault || statusJson.defaultModel || "unknown",
    raw: logs.join("\\n\\n").trim()
  };
}

async function addOpenAIChatModel(payload) {
  const baseUrl = String(payload?.baseUrl || "").trim();
  const model = String(payload?.model || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  const provider = String(payload?.provider || "openai-chat").trim() || "openai-chat";
  const alias = String(payload?.alias || "").trim();
  const setDefault = payload?.setDefault !== false;
  const addFallback = payload?.addFallback !== false;

  if (!baseUrl || !model || !apiKey) {
    return { ok: false, error: "baseUrl, model, apiKey are required" };
  }

  const status = await runOpenClaw(["models", "status", "--json"], 30000);
  const statusJson = pickJson(cmdOutputText(status)) || {};
  const agentDir = String(statusJson.agentDir || "").trim();
  if (!agentDir) {
    return { ok: false, error: "cannot resolve agentDir from openclaw models status" };
  }

  const modelsPath = join(agentDir, "models.json");
  let modelsConfig;
  try {
    modelsConfig = JSON.parse(await readFile(modelsPath, "utf8"));
  } catch {
    return { ok: false, error: `cannot read models.json: ${modelsPath}` };
  }

  if (!modelsConfig.providers || typeof modelsConfig.providers !== "object") {
    modelsConfig.providers = {};
  }

  const existed = modelsConfig.providers[provider] || {};
  const models = Array.isArray(existed.models) ? existed.models : [];
  const nextModel = {
    id: model,
    name: model,
    contextWindow: 200000,
    maxTokens: 8192,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  const idx = models.findIndex((m) => m && String(m.id) === model);
  if (idx >= 0) models[idx] = { ...models[idx], ...nextModel };
  else models.push(nextModel);

  modelsConfig.providers[provider] = {
    ...existed,
    baseUrl,
    apiKey,
    api: "openai-chat",
    models
  };

  await writeFile(modelsPath, `${JSON.stringify(modelsConfig, null, 2)}\n`, "utf8");

  const fullModel = `${provider}/${model}`;
  const logs = [`[models.json] provider=${provider} model=${model} api=openai-chat 已写入`];
  let allOk = true;

  if (alias) {
    const aliasResult = await runOpenClaw(["models", "aliases", "add", alias, fullModel], 30000);
    allOk = allOk && aliasResult.ok;
    logs.push(`[aliases add] ${aliasResult.ok ? "ok" : "fail"}\n${cmdOutputText(aliasResult)}`);
  }
  if (addFallback) {
    const fallbackResult = await runOpenClaw(["models", "fallbacks", "add", fullModel], 30000);
    allOk = allOk && fallbackResult.ok;
    logs.push(`[fallbacks add] ${fallbackResult.ok ? "ok" : "fail"}\n${cmdOutputText(fallbackResult)}`);
  }
  if (setDefault) {
    const setResult = await runOpenClaw(["models", "set", fullModel], 30000);
    allOk = allOk && setResult.ok;
    logs.push(`[models set] ${setResult.ok ? "ok" : "fail"}\n${cmdOutputText(setResult)}`);
  }

  const statusAfter = await runOpenClaw(["models", "status", "--json"], 30000);
  const statusAfterJson = pickJson(cmdOutputText(statusAfter)) || {};
  return {
    ok: allOk,
    model: fullModel,
    currentModel: String(statusAfterJson.resolvedDefault || statusAfterJson.defaultModel || "unknown"),
    raw: logs.join("\n\n")
  };
}

async function testModelConnectivity(payload) {
  const targetModel = String(payload?.model || "").trim();
  const statusBefore = await runOpenClaw(["models", "status", "--json"]);
  const statusBeforeJson = pickJson(cmdOutputText(statusBefore)) || {};
  const previousModel = String(statusBeforeJson.resolvedDefault || statusBeforeJson.defaultModel || "").trim();

  let changedModel = false;
  const logs = [];

  if (targetModel && previousModel && targetModel !== previousModel) {
    const setResult = await runOpenClaw(["models", "set", targetModel], 30000);
    logs.push(`[switch->test-model] ${setResult.ok ? "ok" : "fail"}\n${cmdOutputText(setResult)}`);
    if (!setResult.ok) {
      return {
        ok: false,
        modelTested: targetModel,
        raw: logs.join("\n\n")
      };
    }
    changedModel = true;
  }

  const statusNow = await runOpenClaw(["models", "status", "--json"], 30000);
  const statusNowJson = pickJson(cmdOutputText(statusNow)) || {};
  const appliedModel = String(statusNowJson.resolvedDefault || statusNowJson.defaultModel || "");
  const health = await runOpenClaw(["gateway", "health"], 20000);
  const healthText = cmdOutputText(health);
  logs.push(`[model-status] ${statusNow.ok ? "ok" : "fail"}\n${cmdOutputText(statusNow)}`);
  logs.push(`[gateway-health] ${health.ok ? "ok" : "fail"}\n${healthText}`);

  let restoreOk = true;
  if (changedModel && previousModel) {
    const restore = await runOpenClaw(["models", "set", previousModel], 30000);
    restoreOk = restore.ok;
    logs.push(`[restore-model] ${restore.ok ? "ok" : "fail"}\n${cmdOutputText(restore)}`);
  }

  const responded = health.ok && healthText.length > 0;
  return {
    ok: statusNow.ok && responded && restoreOk && (!targetModel || appliedModel === targetModel),
    modelTested: targetModel || appliedModel || previousModel || "unknown",
    responded,
    restored: changedModel ? restoreOk : true,
    raw: logs.join("\n\n")
  };
}

async function controlGateway(action) {
  const allowed = new Set(["start", "stop", "restart", "status"]);
  if (!allowed.has(action)) return { ok: false, error: "invalid action" };
  const args = action === "status" ? ["gateway", "status"] : ["gateway", action];
  const result = await runOpenClaw(args, 30000);
  return {
    ok: result.ok,
    action,
    raw: cmdOutputText(result)
  };
}

async function checkUpdateStatus() {
  const [versionRaw, updateRaw, dryRunRaw] = await Promise.all([
    runOpenClaw(["--version"], 15000),
    runOpenClaw(["update", "status", "--json"], 45000),
    runOpenClaw(["update", "--dry-run", "--json", "--yes"], 45000)
  ]);
  const updateJson = pickJson(cmdOutputText(updateRaw)) || {};
  const dryRunJson = pickJson(cmdOutputText(dryRunRaw)) || {};
  const availability = updateJson.availability || {};
  let registryError = updateJson.update?.registry?.error || null;
  const channelLabel = updateJson.channel?.label || dryRunJson.effectiveChannel || "-";
  const currentVersion = cmdOutputText(versionRaw) || String(dryRunJson.currentVersion || "unknown");
  let latestVersion = availability.latestVersion || dryRunJson.targetVersion || null;
  let latestSource = "openclaw-update";

  if (!latestVersion) {
    try {
      const { stdout } = await execFileAsync("npm", ["view", "openclaw@latest", "version"], {
        timeout: 30000,
        maxBuffer: 1024 * 512
      });
      const npmLatest = String(stdout || "").trim();
      if (npmLatest) {
        latestVersion = npmLatest;
        latestSource = "npm-view";
        registryError = null;
      }
    } catch (error) {
      registryError = registryError || String(error?.message || "npm view failed");
    }
  }

  if (!latestVersion) {
    try {
      const { stdout } = await execFileAsync("curl", ["-fsSL", "https://registry.npmjs.org/openclaw"], {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 2
      });
      const pkg = JSON.parse(String(stdout || "{}"));
      const curlLatest = String(pkg?.["dist-tags"]?.latest || "").trim();
      if (curlLatest) {
        latestVersion = curlLatest;
        latestSource = "npm-registry-curl";
        registryError = null;
      }
    } catch (error) {
      registryError = registryError || String(error?.message || "registry curl failed");
    }
  }

  const available = availability.available === true || (latestVersion && latestVersion !== currentVersion);
  return {
    ok: updateRaw.ok || dryRunRaw.ok,
    currentVersion,
    channelLabel,
    latestVersion,
    latestSource,
    available: Boolean(available),
    registryError,
    update: updateJson,
    dryRun: dryRunJson,
    raw: cmdOutputText(updateRaw)
  };
}

async function runUpdateNow() {
  const updateRun = await runOpenClaw(["update", "--yes", "--json"], 120000);
  let statusAfter = null;
  try {
    statusAfter = await checkUpdateStatus();
  } catch {
    statusAfter = null;
  }
  return {
    ok: updateRun.ok,
    result: statusAfter,
    raw: cmdOutputText(updateRun)
  };
}

async function createSession(payload) {
  const to = String(payload?.to || "").trim();
  const message = String(payload?.message || "").trim();
  if (!to || !message) return { ok: false, error: "to and message are required" };

  const args = ["agent", "--to", to, "--message", message, "--json"];
  if (payload?.agent) args.push("--agent", String(payload.agent));
  if (payload?.channel) args.push("--channel", String(payload.channel));
  if (payload?.thinking) args.push("--thinking", String(payload.thinking));
  const result = await runOpenClaw(args, 60000);

  return {
    ok: result.ok,
    raw: cmdOutputText(result)
  };
}

async function cleanupSessions() {
  const result = await runOpenClaw(["sessions", "cleanup", "--enforce", "--json"], 30000);
  return {
    ok: result.ok,
    raw: cmdOutputText(result)
  };
}

function sendJson(res, code, data) {
  res.writeHead(code, {
    "Content-Type": MIME[".json"],
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 256) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/overview") {
    sendJson(res, 200, await getOverview());
    return true;
  }

  if (req.method === "GET" && req.url === "/api/install/status") {
    sendJson(res, 200, { ok: true, install: getInstallStatus() });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/install/start") {
    const result = startInstallTask();
    sendJson(res, result.ok ? 200 : 409, result);
    return true;
  }

  if (req.method === "GET" && req.url === "/api/skills/recommended") {
    try {
      sendJson(res, 200, { ok: true, skills: await listRecommendedSkills() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/skills/install") {
    try {
      const parsed = await readJsonBody(req);
      const result = await installRecommendedSkill(parsed.name);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/model") {
    try {
      const parsed = await readJsonBody(req);
      const result = await setModel(parsed.model);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/model/status") {
    const result = await getModelStatus();
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/model/add") {
    try {
      const parsed = await readJsonBody(req);
      const result = await addModelConfig(parsed);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/model/openai-chat/add") {
    try {
      const parsed = await readJsonBody(req);
      const result = await addOpenAIChatModel(parsed);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/model/test") {
    try {
      const parsed = await readJsonBody(req);
      const result = await testModelConnectivity(parsed);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/gateway") {
    try {
      const parsed = await readJsonBody(req);
      const result = await controlGateway(String(parsed.action || ""));
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/update/status") {
    const result = await checkUpdateStatus();
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/update/run") {
    const result = await runUpdateNow();
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/session/new") {
    try {
      const parsed = await readJsonBody(req);
      const result = await createSession(parsed);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/sessions/cleanup") {
    const result = await cleanupSessions();
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/dashboard/start") {
    const result = startDashboard();
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = join(publicDir, urlPath.replace(/^\/+/, ""));
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Bad Request");
    return;
  }
  if (req.url.startsWith("/api/")) {
    const handled = await handleApi(req, res);
    if (!handled) sendJson(res, 404, { ok: false, error: "not found", method: req.method, url: req.url });
    return;
  }
  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`OpenClaw Dashboard Pro (local) running at http://${host}:${port}`);
});
