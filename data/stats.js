const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function load(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function save(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath); // écriture atomique
}

let stats = load(STATS_PATH, {});   // { guildId: { userId: { username, messageCount, voiceSeconds } } }
let config = load(CONFIG_PATH, {}); // { guildId: { messages: {channelId,messageId}, voice: {channelId,messageId} } }

const activeVoiceSessions = new Map(); // `${guildId}:${userId}` -> timestamp

function guildStats(guildId) {
  if (!stats[guildId]) stats[guildId] = {};
  return stats[guildId];
}

function ensureUser(guildId, userId, username) {
  const g = guildStats(guildId);
  if (!g[userId]) {
    g[userId] = { username: username ?? 'Inconnu', messageCount: 0, voiceSeconds: 0 };
  } else if (username) {
    g[userId].username = username;
  }
  return g[userId];
}

function addMessage(guildId, userId, username) {
  const user = ensureUser(guildId, userId, username);
  user.messageCount += 1;
  save(STATS_PATH, stats);
}

function startVoiceSession(guildId, userId) {
  activeVoiceSessions.set(`${guildId}:${userId}`, Date.now());
}

function getUserStats(guildId, userId) {
  return guildStats(guildId)[userId] ?? { username: null, messageCount: 0, voiceSeconds: 0 };
}

function endVoiceSession(guildId, userId, username) {
  const key = `${guildId}:${userId}`;
  const start = activeVoiceSessions.get(key);
  if (!start) return;
  activeVoiceSessions.delete(key);
  const seconds = Math.floor((Date.now() - start) / 1000);
  if (seconds <= 0) return;
  const user = ensureUser(guildId, userId, username);
  user.voiceSeconds += seconds;
  save(STATS_PATH, stats);
}

// Ajoute le temps écoulé aux sessions vocales en cours et retourne les users affectés
function flushActiveSessions() {
  const now = Date.now();
  const affected = [];
  for (const [key, start] of activeVoiceSessions.entries()) {
    const [guildId, userId] = key.split(':');
    const seconds = Math.floor((now - start) / 1000);
    if (seconds > 0) {
      const user = ensureUser(guildId, userId);
      user.voiceSeconds += seconds;
      affected.push({ guildId, userId });
    }
    activeVoiceSessions.set(key, now);
  }
  save(STATS_PATH, stats);
  return affected;
}

function getTopMessages(guildId, limit = 10) {
  return Object.entries(guildStats(guildId))
    .sort((a, b) => b[1].messageCount - a[1].messageCount)
    .slice(0, limit)
    .map(([userId, data]) => ({ userId, ...data }));
}

function getTopVoice(guildId, limit = 10) {
  return Object.entries(guildStats(guildId))
    .sort((a, b) => b[1].voiceSeconds - a[1].voiceSeconds)
    .slice(0, limit)
    .map(([userId, data]) => ({ userId, ...data }));
}

// --- Config par panel (type = "messages" | "voice") ---
function ensureGuildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      messages: { channelId: null, messageId: null },
      voice: { channelId: null, messageId: null },
      roleTiers: {}, // { tierKey: roleId }
    };
  }
  if (!config[guildId].roleTiers) config[guildId].roleTiers = {};
  return config[guildId];
}

function getRoleTiers(guildId) {
  return ensureGuildConfig(guildId).roleTiers;
}

function setRoleTier(guildId, tierKey, roleId) {
  const g = ensureGuildConfig(guildId);
  g.roleTiers[tierKey] = roleId;
  save(CONFIG_PATH, config);
}

function getPanelConfig(guildId, type) {
  return ensureGuildConfig(guildId)[type];
}

function setPanelConfig(guildId, type, updates) {
  const g = ensureGuildConfig(guildId);
  g[type] = { ...g[type], ...updates };
  save(CONFIG_PATH, config);
}

// Retourne [{ guildId, type }] pour chaque panel configuré (channelId défini)
function getAllConfiguredPanels() {
  const result = [];
  for (const [guildId, g] of Object.entries(config)) {
    for (const type of ['messages', 'voice']) {
      if (g[type]?.channelId) result.push({ guildId, type });
    }
  }
  return result;
}

module.exports = {
  addMessage,
  startVoiceSession,
  endVoiceSession,
  flushActiveSessions,
  getTopMessages,
  getTopVoice,
  getUserStats,
  getPanelConfig,
  setPanelConfig,
  getAllConfiguredPanels,
  getRoleTiers,
  setRoleTier,
};
