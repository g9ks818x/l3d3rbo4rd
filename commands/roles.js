const {
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const stats = require('../utils/stats');

const OWNER_ID = '1518434083133460652';

// Seuils repris du screenshot. Condition = messages OU heures vocal (le premier atteint suffit).
const TIERS = [
  { key: 'novice', label: 'Novice', messages: 500, voiceHours: 1 },
  { key: 'amateur', label: 'Amateur', messages: 1000, voiceHours: 2 },
  { key: 'avance', label: 'Avancé', messages: 1500, voiceHours: 5 },
  { key: 'expert', label: 'Expert', messages: 2000, voiceHours: 10 },
  { key: 'maitre', label: 'Maître', messages: 3000, voiceHours: 20 },
  { key: 'legende', label: 'Légende', messages: 5000, voiceHours: 50 },
  { key: 'ultime', label: 'Rôle ultime', messages: 10000, voiceHours: 100 },
];

function isOwner(userId) {
  return userId === OWNER_ID;
}

// Renvoie l'index du palier atteint (ou -1) pour ce user, en prenant le meilleur entre messages et vocal
function computeTierIndex(userStats) {
  const voiceHours = userStats.voiceSeconds / 3600;
  let best = -1;
  TIERS.forEach((tier, i) => {
    if (userStats.messageCount >= tier.messages || voiceHours >= tier.voiceHours) {
      best = i;
    }
  });
  return best;
}

// À appeler après chaque nouveau message / fin de session vocale pour un user donné
async function syncMemberRole(client, guildId, userId) {
  const roleTiers = stats.getRoleTiers(guildId);
  const configuredTierRoleIds = new Set(Object.values(roleTiers).filter(Boolean));
  if (configuredTierRoleIds.size === 0) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const userStats = stats.getUserStats(guildId, userId);
  const tierIndex = computeTierIndex(userStats);
  const targetRoleId = tierIndex >= 0 ? roleTiers[TIERS[tierIndex].key] : null;

  const rolesToRemove = member.roles.cache
    .filter((r) => configuredTierRoleIds.has(r.id) && r.id !== targetRoleId)
    .map((r) => r.id);

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove).catch(() => {});
  }
  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId).catch(() => {});
  }
}

// --- Setup owner : un palier à la fois, avec sélecteur de rôle natif ---
function buildTierSetupComponents(guildId, index) {
  const tier = TIERS[index];
  const roleTiers = stats.getRoleTiers(guildId);
  const currentRoleId = roleTiers[tier.key];

  const text = new TextDisplayBuilder().setContent(
    [
      `**Configuration des paliers (${index + 1}/${TIERS.length})**`,
      `Palier : **${tier.label}** — ${tier.messages} messages ou ${tier.voiceHours}h+ vocal`,
      `Rôle actuel : ${currentRoleId ? `<@&${currentRoleId}>` : '_non configuré_'}`,
    ].join('\n')
  );

  const selectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`rt_select_${index}`)
      .setPlaceholder(`Choisir le rôle pour "${tier.label}"`)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rt_prev_${index}`)
      .setLabel('◀ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`rt_next_${index}`)
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === TIERS.length - 1),
    new ButtonBuilder()
      .setCustomId('rt_done')
      .setLabel('Terminer')
      .setStyle(ButtonStyle.Success),
  );

  return [text, selectRow, navRow];
}

async function handleCommand(message) {
  if (!isOwner(message.author.id)) {
    await message.reply("Tu n'as pas la permission d'utiliser cette commande.");
    return;
  }
  await message.reply({
    components: buildTierSetupComponents(message.guild.id, 0),
    flags: MessageFlags.IsComponentsV2,
  });
}

async function handleInteraction(interaction) {
  const id = interaction.customId ?? '';
  const isRolesAction = id.startsWith('rt_');
  if (!isRolesAction) return;

  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true }).catch(() => {});
    return;
  }

  const guildId = interaction.guild.id;

  if (id === 'rt_done') {
    await interaction.update({
      components: [new TextDisplayBuilder().setContent('**Configuration des paliers terminée.**')],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (id.startsWith('rt_prev_') || id.startsWith('rt_next_')) {
    const currentIndex = parseInt(id.split('_')[2], 10);
    const nextIndex = id.startsWith('rt_prev_') ? currentIndex - 1 : currentIndex + 1;
    await interaction.update({
      components: buildTierSetupComponents(guildId, nextIndex),
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (id.startsWith('rt_select_')) {
    const index = parseInt(id.split('_')[2], 10);
    const roleId = interaction.values[0];
    stats.setRoleTier(guildId, TIERS[index].key, roleId);
    await interaction.update({
      components: buildTierSetupComponents(guildId, index),
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

module.exports = { TIERS, syncMemberRole, handleCommand, handleInteraction };
