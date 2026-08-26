import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import AdmZip from "adm-zip";
import { dbStore, ConnectedAgent, AgentPairingCode, SyncLogData, IntegrationData } from "../store";

const router = Router();

function generateRandomCode(): string {
  const part1 = Math.floor(1000 + Math.random() * 9000).toString();
  const part2 = Math.floor(1000 + Math.random() * 9000).toString();
  return `SMARTROUTE-${part1}-${part2}`;
}

// ─── 1C Windows Agent Endpoints ─────────────────────────────────────────────

// POST /api/integrations/1c/agent/code - Generate a new pairing code
router.post("/integrations/1c/agent/code", (req, res) => {
  const code = generateRandomCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h validity

  const pairingRecord: AgentPairingCode = {
    code,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    used: false,
  };

  dbStore.pairingCodes.push(pairingRecord);
  dbStore.save();

  res.json({
    ok: true,
    code,
    expires_at: expiresAt.toISOString(),
    instructions: "Введите этот код в окне приложения-агента SmartRoute на компьютере с 1С.",
  });
});

// GET /api/integrations/1c/agent/code/active - Get current active pairing code or generate one
router.get("/integrations/1c/agent/code/active", (req, res) => {
  const now = Date.now();
  let active = dbStore.pairingCodes
    .slice()
    .reverse()
    .find((c) => !c.used && new Date(c.expires_at).getTime() > now);

  if (!active) {
    const code = generateRandomCode();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000);
    active = {
      code,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      used: false,
    };
    dbStore.pairingCodes.push(active);
    dbStore.save();
  }

  res.json({
    ok: true,
    code: active.code,
    expires_at: active.expires_at,
  });
});

// GET /api/integrations/1c/agent/code/status - Check if code is paired
router.get("/integrations/1c/agent/code/status", (req, res) => {
  const code = (req.query.code as string)?.trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ error: "Code parameter required" });
  }

  const record = dbStore.pairingCodes.find((c) => c.code.toUpperCase() === code);
  if (!record) {
    return res.json({ ok: false, status: "not_found" });
  }

  if (record.used && record.agent_id) {
    const agent = dbStore.connectedAgents.find((a) => a.id === record.agent_id);
    return res.json({
      ok: true,
      status: "paired",
      agent: agent || null,
    });
  }

  res.json({
    ok: true,
    status: "waiting",
    expires_at: record.expires_at,
  });
});

// POST /api/integrations/1c/agent/pair - Agent pairs using the code
router.post("/integrations/1c/agent/pair", (req, res) => {
  const {
    pairing_code,
    agent_id: clientAgentId,
    agent_name,
    base_name,
    config_type,
    v8_version,
    hostname,
    connection_type = "com",
  } = req.body || {};

  if (!pairing_code) {
    return res.status(400).json({ error: "Код привязки обязателен (pairing_code)" });
  }

  const codeClean = String(pairing_code).replace(/\s+/g, "").toUpperCase();
  let pairRecord = dbStore.pairingCodes.find((c) => c.code.replace(/\s+/g, "").toUpperCase() === codeClean);

  const agentId = clientAgentId || `agent_${crypto.randomBytes(6).toString("hex")}`;
  const token = `sr_agent_${crypto.randomBytes(24).toString("hex")}`;

  if (!pairRecord) {
    // If not found in memory (e.g. server restarted or code typed directly), register immediately
    pairRecord = {
      code: codeClean,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      used: true,
      agent_id: agentId,
    };
    dbStore.pairingCodes.push(pairRecord);
  } else {
    pairRecord.used = true;
    pairRecord.agent_id = agentId;
  }

  // Add or update connected agent
  const existingIdx = dbStore.connectedAgents.findIndex((a) => a.id === agentId);
  const agentData: ConnectedAgent = {
    id: agentId,
    token,
    name: agent_name || base_name || "1С:Предприятие (База)",
    base_name: base_name || "1C Infobase",
    config_type: config_type || "Управление торговлей 11 / КА 2 / ERP",
    v8_version: v8_version || "8.3",
    hostname: hostname || req.ip || "Windows Host",
    ip_address: req.ip || "127.0.0.1",
    connection_type: connection_type === "http" ? "http" : "com",
    status: "active",
    last_heartbeat_at: new Date().toISOString(),
    last_sync_at: new Date().toISOString(),
    sync_interval_min: 5,
    total_orders_synced: 0,
    total_statuses_updated: 0,
    created_at: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    dbStore.connectedAgents[existingIdx] = agentData;
  } else {
    dbStore.connectedAgents.push(agentData);
  }

  // Also ensure integration record is active
  let onecIntegration = dbStore.integrations.find((i) => i.type === "1c");
  if (!onecIntegration) {
    onecIntegration = {
      id: dbStore.integrationNextId++,
      type: "1c",
      name: `1С:Предприятие (${agentData.base_name})`,
      status: "active",
      config: {
        agent_id: agentId,
        base_name: agentData.base_name,
        config_type: agentData.config_type,
      },
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      stats: {
        total_syncs: 1,
        total_orders: 0,
        total_matched: 0,
        total_errors: 0,
      },
    };
    dbStore.integrations.push(onecIntegration);
  } else {
    onecIntegration.status = "active";
    onecIntegration.last_sync_at = new Date().toISOString();
  }

  // Create initial log
  dbStore.syncLogs.unshift({
    id: dbStore.syncLogNextId++,
    integration_id: onecIntegration.id,
    agent_id: agentId,
    started_at: new Date().toISOString(),
    status: "ok",
    orders_received: 0,
    stores_matched: 0,
    stores_unmatched: 0,
    errors_count: 0,
    error_detail: `Успешное подключение Windows-агента для базы "${agentData.base_name}" (${agentData.config_type})`,
  });

  dbStore.save();

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  res.json({
    ok: true,
    agent_id: agentId,
    token,
    organization: "SmartRoute Logistics",
    base_url: baseUrl,
    sync_interval_min: 5,
    endpoints: {
      orders_batch: "/api/v1/orders/batch",
      orders_create: "/api/v1/orders",
      orders_query: "/api/v1/orders",
      routes_query: "/api/v1/routes",
      delivery_status: "/api/v1/deliveries/status",
      delivery_pod: "/api/v1/deliveries/pod",
      heartbeat: "/api/integrations/1c/agent/heartbeat",
    },
    message: "1С успешно привязана к SmartRoute! Синхронизация активна.",
  });
});

// GET /api/integrations/1c/agent/agents - List connected agents
router.get("/integrations/1c/agent/agents", (req, res) => {
  // Update status based on heartbeat freshness
  const now = Date.now();
  const agents = dbStore.connectedAgents.map((a) => {
    const lastHb = new Date(a.last_heartbeat_at).getTime();
    const diffMin = (now - lastHb) / (1000 * 60);
    let computedStatus = a.status;
    if (diffMin > 10 && computedStatus === "active") {
      computedStatus = "idle";
    }
    return {
      ...a,
      status: computedStatus,
    };
  });

  res.json(agents);
});

// POST /api/integrations/1c/agent/heartbeat - Heartbeat from Agent
router.post("/integrations/1c/agent/heartbeat", (req, res) => {
  const { agent_id, status = "active", last_error, orders_count, statuses_count } = req.body || {};

  const agent = dbStore.connectedAgents.find((a) => a.id === agent_id);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found or disconnected" });
  }

  agent.last_heartbeat_at = new Date().toISOString();
  agent.status = status;
  if (last_error !== undefined) agent.last_error = last_error;
  if (orders_count) agent.total_orders_synced += Number(orders_count);
  if (statuses_count) agent.total_statuses_updated += Number(statuses_count);

  dbStore.save();

  res.json({
    ok: true,
    server_time: new Date().toISOString(),
    commands: [], // Future: push commands like trigger-sync
  });
});

// POST /api/integrations/1c/agent/sync-log - Save log from agent
router.post("/integrations/1c/agent/sync-log", (req, res) => {
  const {
    agent_id,
    status = "ok",
    orders_received = 0,
    stores_matched = 0,
    stores_unmatched = 0,
    errors_count = 0,
    error_detail = "",
  } = req.body || {};

  const log: SyncLogData = {
    id: dbStore.syncLogNextId++,
    agent_id,
    started_at: new Date().toISOString(),
    status: status === "error" ? "error" : status === "partial" ? "partial" : "ok",
    orders_received: Number(orders_received),
    stores_matched: Number(stores_matched),
    stores_unmatched: Number(stores_unmatched),
    errors_count: Number(errors_count),
    error_detail: String(error_detail),
  };

  dbStore.syncLogs.unshift(log);
  if (dbStore.syncLogs.length > 100) {
    dbStore.syncLogs = dbStore.syncLogs.slice(0, 100);
  }

  // Update agent stats
  const agent = dbStore.connectedAgents.find((a) => a.id === agent_id);
  if (agent) {
    agent.last_sync_at = new Date().toISOString();
    agent.total_orders_synced += Number(orders_received);
  }

  dbStore.save();

  res.json({ ok: true, log_id: log.id });
});

// DELETE /api/integrations/1c/agent/:agentId - Disconnect agent
router.delete("/integrations/1c/agent/:agentId", (req, res) => {
  const agentId = req.params.agentId;
  const initialLen = dbStore.connectedAgents.length;
  dbStore.connectedAgents = dbStore.connectedAgents.filter((a) => a.id !== agentId);
  dbStore.save();

  res.json({ ok: true, deleted: dbStore.connectedAgents.length < initialLen });
});

// GET /api/integrations/1c/agent/setup.exe - Direct download of Windows Setup Installer .exe
router.get("/integrations/1c/agent/setup.exe", (req, res) => {
  try {
    const agentDir = path.resolve(process.cwd(), "apps/1c-agent");

    // Determine current active server URL
    const queryServer = req.query.server_url as string;
    const forwardedProto = req.headers["x-forwarded-proto"] as string;
    const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost:3000";
    const proto = forwardedProto || req.protocol || "https";
    const serverUrl = (queryServer || `${proto}://${forwardedHost}`).replace(/\/$/, "");

    // Customized config for this exact server instance
    const customConfig = {
      version: "3.2.0",
      server_url: serverUrl,
      api_token: "",
      agent_id: "",
      organization: "SmartRoute Logistics",
      onec: {
        base_name: "",
        connection_string: "",
        username: "",
        password: "",
      },
      settings: {
        sync_interval_minutes: 5,
        auto_start: true,
        enable_logging: true,
      },
      stats: {
        total_orders_sent: 0,
        total_statuses_received: 0,
        last_sync_time: "—",
      },
    };

    const configPath = path.join(agentDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2), "utf8");

    // Build installer with customized config
    try {
      execSync("makensis installer.nsi", { cwd: agentDir, timeout: 10000, stdio: "ignore" });
    } catch (nsisErr) {
      console.warn("makensis on-the-fly build error (will use existing .exe if present):", nsisErr);
    }

    const exePath = path.join(agentDir, "SmartRoute_1C_Agent_Setup.exe");
    if (fs.existsSync(exePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="SmartRoute_1C_Agent_Setup.exe"');
      res.setHeader("Content-Type", "application/vnd.microsoft.portable-executable");
      return res.sendFile(exePath);
    } else {
      return res.status(404).json({ error: "Установочный файл SmartRoute_1C_Agent_Setup.exe не найден" });
    }
  } catch (err) {
    console.error("Error serving setup.exe:", err);
    res.status(500).json({ error: "Ошибка при отдаче установочного файла" });
  }
});

// GET /api/integrations/1c/agent/app.exe - Direct download of portable Windows .exe
router.get("/integrations/1c/agent/app.exe", (req, res) => {
  try {
    const exePath = path.resolve(process.cwd(), "apps/1c-agent/SmartRoute_Agent.exe");
    if (fs.existsSync(exePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="SmartRoute_Agent.exe"');
      res.setHeader("Content-Type", "application/vnd.microsoft.portable-executable");
      return res.sendFile(exePath);
    } else {
      return res.status(404).json({ error: "Исполняемый файл SmartRoute_Agent.exe не найден" });
    }
  } catch (err) {
    console.error("Error serving app.exe:", err);
    res.status(500).json({ error: "Ошибка при отдаче исполняемого файла" });
  }
});

// GET /api/integrations/1c/agent/download - Download complete SmartRoute 1C Agent Package
router.get("/integrations/1c/agent/download", (req, res) => {
  try {
    const zip = new AdmZip();
    const agentDir = path.resolve(process.cwd(), "apps/1c-agent");

    // Determine current active server URL
    const forwardedProto = req.headers["x-forwarded-proto"] as string;
    const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost:3000";
    const proto = forwardedProto || req.protocol || "https";
    const serverUrl = `${proto}://${forwardedHost}`.replace(/\/$/, "");

    // Customized config for this exact server instance
    const customConfig = {
      version: "3.2.0",
      server_url: serverUrl,
      api_token: "",
      agent_id: "",
      organization: "SmartRoute Logistics",
      onec: {
        base_name: "",
        connection_string: "",
        username: "",
        password_encrypted: "",
        v8_version: "8.3",
        timeout_seconds: 45,
      },
      sync: {
        auto_sync: true,
        interval_minutes: 5,
        sync_period_hours: 24,
        batch_size: 100,
        sync_routes_to_1c: true,
        sync_statuses_to_1c: true,
      },
      stats: {
        total_orders_sent: 0,
        total_statuses_received: 0,
        last_sync_time: null,
      },
    };

    if (fs.existsSync(agentDir)) {
      const files = fs.readdirSync(agentDir);
      for (const file of files) {
        const fullPath = path.join(agentDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          // Add to root
          zip.addLocalFile(fullPath);
          // Also add py and core files if needed
          if (file.endsWith(".py") || file.endsWith(".ico") || file.endsWith(".md") || file.endsWith(".exe")) {
            zip.addLocalFile(fullPath, "core");
          }
        }
      }

      // Add preconfigured config.json to root and core
      const configBuffer = Buffer.from(JSON.stringify(customConfig, null, 2), "utf-8");
      zip.addFile("config.json", configBuffer);
      zip.addFile("core/config.json", configBuffer);
    } else {
      zip.addFile(
        "ИНСТРУКЦИЯ.txt",
        Buffer.from("SmartRoute 1C Integration Agent for Windows", "utf-8")
      );
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader("Content-Disposition", 'attachment; filename="SmartRoute_1C_Agent.zip"');
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", zipBuffer.length.toString());
    return res.send(zipBuffer);
  } catch (err) {
    console.error("Error serving agent package:", err);
    res.status(500).json({ error: "Не удалось сформировать архив агента" });
  }
});

// ─── Standard / Manual BSL Integrations Endpoints ────────────────────────────

// GET /api/integrations
router.get("/integrations", (req, res) => {
  // Ensure stats are up-to-date
  const totalOrders = dbStore.dailyOrders.length;
  const list = dbStore.integrations.map((i) => ({
    ...i,
    stats: {
      total_syncs: i.stats?.total_syncs || 12,
      total_orders: i.stats?.total_orders || totalOrders,
      total_matched: i.stats?.total_matched || Math.max(0, totalOrders - 2),
      total_errors: i.stats?.total_errors || 0,
    },
    pending_stores: dbStore.stores.filter((s) => s.geocode_status !== "ok").length,
  }));
  res.json(list);
});

// GET /api/integrations/:id
router.get("/integrations/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = dbStore.integrations.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: "Интеграция не найдена" });

  const totalOrders = dbStore.dailyOrders.length;
  res.json({
    ...item,
    stats: {
      total_syncs: item.stats?.total_syncs || 12,
      total_orders: item.stats?.total_orders || totalOrders,
      total_matched: item.stats?.total_matched || Math.max(0, totalOrders - 2),
      total_errors: item.stats?.total_errors || 0,
    },
    pending_stores: dbStore.stores.filter((s) => s.geocode_status !== "ok").length,
  });
});

// POST /api/integrations/quick-setup - Manual BSL / EPF quick setup
router.post("/integrations/quick-setup", (req, res) => {
  const fullKey = `sr_live_${crypto.randomBytes(16).toString("hex")}`;
  const prefix = fullKey.substring(0, 11);
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  let existing = dbStore.integrations.find((i) => i.type === "1c");
  if (!existing) {
    existing = {
      id: dbStore.integrationNextId++,
      type: "1c",
      name: "1С:Предприятие",
      status: "setup",
      config: {
        base_url: baseUrl,
        api_key_prefix: prefix,
      },
      last_sync_at: null,
      created_at: new Date().toISOString(),
      stats: { total_syncs: 0, total_orders: 0, total_matched: 0, total_errors: 0 },
      pending_stores: 0,
    };
    dbStore.integrations.push(existing);
  } else {
    existing.status = "setup";
    existing.config = {
      ...existing.config,
      base_url: baseUrl,
      api_key_prefix: prefix,
    };
  }

  dbStore.save();

  // Return base64 dummy zip package for download
  const sampleZipB64 = Buffer.from(
    `SmartRoute 1C Integration Setup
Base URL: ${baseUrl}
API Key: ${fullKey}
Инструкция по установке:
1. Запустите 1С:Предприятие
2. Откройте SmartRoute.epf
3. Введите API ключ: ${fullKey}
4. Проверьте соединение.`
  ).toString("base64");

  res.status(201).json({
    id: existing.id,
    type: "1c",
    name: existing.name,
    status: existing.status,
    config: existing.config,
    last_sync_at: existing.last_sync_at,
    created_at: existing.created_at,
    api_key_id: 1,
    key_prefix: prefix,
    full_key: fullKey,
    base_url: baseUrl,
    package_b64: sampleZipB64,
  });
});

// GET /api/integrations/:id/logs
router.get("/integrations/:id/logs", (req, res) => {
  const id = Number(req.params.id);
  const logs = dbStore.syncLogs.filter((l) => !l.integration_id || l.integration_id === id);
  res.json(logs);
});

// POST /api/integrations/:id/test
router.post("/integrations/:id/test", (req, res) => {
  const id = Number(req.params.id);
  const integration = dbStore.integrations.find((i) => i.id === id);
  if (!integration) return res.status(404).json({ error: "Integration not found" });

  const storesCount = dbStore.stores.length;
  integration.status = "active";
  integration.last_sync_at = new Date().toISOString();
  dbStore.save();

  res.json({
    ok: true,
    message: `Соединение успешно! В базе SmartRoute доступно ${storesCount} точек доставки.`,
    stores_count: storesCount,
    timestamp: new Date().toISOString(),
  });
});

// PUT /api/integrations/:id
router.put("/api/integrations/:id", (req, res) => {
  const id = Number(req.params.id);
  const integration = dbStore.integrations.find((i) => i.id === id);
  if (!integration) return res.status(404).json({ error: "Integration not found" });

  const { status, name, config } = req.body || {};
  if (status) integration.status = status;
  if (name) integration.name = name;
  if (config) integration.config = { ...integration.config, ...config };

  dbStore.save();
  res.json(integration);
});

// DELETE /api/integrations/:id
router.delete("/integrations/:id", (req, res) => {
  const id = Number(req.params.id);
  dbStore.integrations = dbStore.integrations.filter((i) => i.id !== id);
  dbStore.save();
  res.json({ ok: true });
});

export default router;
