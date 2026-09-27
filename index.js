require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const stats = require('./utils/stats');
const leaderboard = require('./commands/leaderboard');
const roles = require('./commands/roles');

const PREFIX = '*';
const REFRESH_INTERVAL_MS = 10 * 1000; // 1 minute
const AUTOSAVE_INTERVAL_MS = 60 * 1000;     // sauvegarde le temps vocal en cours toutes les minutes

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN manquant. Copie .env.example vers .env et renseigne ton token.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased());
    for (const voiceChannel of voiceChannels.values()) {
      for (const member of voiceChannel.members.values()) {
        if (!member.user.bot) stats.startVoiceSession(guild.id, member.id);
      }
    }
  }

  leaderboard.refreshAll(client).catch(console.error);
  setInterval(() => leaderboard.refreshAll(client).catch(console.error), REFRESH_INTERVAL_MS);
  setInterval(() => {
    const affected = stats.flushActiveSessions();
    for (const { guildId, userId } of affected) {
      roles.syncMemberRole(client, guildId, userId).catch(console.error);
    }
  }, AUTOSAVE_INTERVAL_MS);
});

// --- Suivi des messages + commande owner ---
client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild) return;
  stats.addMessage(message.guild.id, message.author.id, message.author.username);
  roles.syncMemberRole(client, message.guild.id, message.author.id).catch(console.error);

  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === 'leaderboard') {
      leaderboard.handleCommand(message).catch(console.error);
    } else if (command === 'roles') {
      roles.handleCommand(message).catch(console.error);
    }
  }
});

// --- Boutons et select menu du panel owner ---
client.on('interactionCreate', (interaction) => {
  if (interaction.isButton() || interaction.isChannelSelectMenu()) {
    leaderboard.handleInteraction(interaction).catch(console.error);
  }
  if (interaction.isButton() || interaction.isRoleSelectMenu()) {
    roles.handleInteraction(interaction).catch(console.error);
  }
});

// --- Suivi du temps en vocal ---
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guildId = newState.guild.id;
  const userId = member.id;
  const username = member.user.username;

  const wasInVoice = Boolean(oldState.channelId);
  const isInVoice = Boolean(newState.channelId);

  if (!wasInVoice && isInVoice) {
    stats.startVoiceSession(guildId, userId);
  } else if (wasInVoice && !isInVoice) {
    stats.endVoiceSession(guildId, userId, username);
    roles.syncMemberRole(client, guildId, userId).catch(console.error);
  }
});

// --- Robustesse ---
client.on('error', (err) => console.error('Erreur client Discord :', err));
process.on('unhandledRejection', (err) => console.error('Rejet non géré :', err));

function shutdown() {
  console.log('Arrêt en cours, sauvegarde des sessions vocales...');
  stats.flushActiveSessions();
  client.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(process.env.DISCORD_TOKEN);
