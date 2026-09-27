const {
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const stats = require('../utils/stats');

const OWNER_ID = '1518434083133460652';

const PANEL_TITLES = {
  messages: 'Top Messages',
  voice: 'Top Vocal',
};

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0 && m === 0) return '< 1 min';
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

function entryLine(rank, mention, valueLabel) {
  return `\`#${rank}\` ${mention}\n${valueLabel}`;
}

// --- Construction des panels affichés dans les salons (style sobre, sans emoji, sans bordure) ---
function buildPanelComponents(guildId, type) {
  const entries = type === 'messages'
    ? stats.getTopMessages(guildId, 10)
    : stats.getTopVoice(guildId, 10);

  const title = new TextDisplayBuilder().setContent(
    `**${PANEL_TITLES[type]} · ${entries.length}**`
  );
  const separator = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);

  const body = entries.length
    ? entries
      .map((u, i) => entryLine(
        i + 1,
        `<@${u.userId}>`,
        type === 'messages' ? `${u.messageCount} messages` : formatDuration(u.voiceSeconds)
      ))
      .join('\n\n')
    : '_Aucune donnée pour le moment._';

  const bodyDisplay = new TextDisplayBuilder().setContent(body);

  return [title, separator, bodyDisplay];
}

async function postOrUpdatePanel(client, guildId, type) {
  const cfg = stats.getPanelConfig(guildId, type);
  if (!cfg.channelId) return null;

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel) return null;

  const payload = {
    components: buildPanelComponents(guildId, type),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };

  if (cfg.messageId) {
    const existing = await channel.messages.fetch(cfg.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => {});
      return channel;
    }
  }

  const sent = await channel.send(payload).catch(() => null);
  if (sent) stats.setPanelConfig(guildId, type, { messageId: sent.id });
  return channel;
}

async function refreshAll(client) {
  for (const { guildId, type } of stats.getAllConfiguredPanels()) {
    await postOrUpdatePanel(client, guildId, type);
  }
}

// --- Menu owner (accessible uniquement par OWNER_ID) ---
function buildOwnerMenuComponents(guildId) {
  const msgCfg = stats.getPanelConfig(guildId, 'messages');
  const vocCfg = stats.getPanelConfig(guildId, 'voice');

  const status = [
    '**Panel Leaderboard — Menu owner**',
    `Top Messages : ${msgCfg.channelId ? `<#${msgCfg.channelId}>` : '_non configuré_'}`,
    `Top Vocal : ${vocCfg.channelId ? `<#${vocCfg.channelId}>` : '_non configuré_'}`,
  ].join('\n');

  const text = new TextDisplayBuilder().setContent(status);
  const separator = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lb_owner_pick_messages')
      .setLabel('Envoyer · Top Messages')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lb_owner_pick_voice')
      .setLabel('Envoyer · Top Vocal')
      .setStyle(ButtonStyle.Secondary),
  );

  return [text, separator, row];
}

function buildChannelSelectComponents(type) {
  const text = new TextDisplayBuilder().setContent(
    `Choisis le salon où envoyer le panel **${PANEL_TITLES[type]}**.`
  );
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`lb_owner_channel_${type}`)
      .setPlaceholder('Sélectionner un salon')
      .addChannelTypes(ChannelType.GuildText)
  );
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lb_owner_back')
      .setLabel('Retour')
      .setStyle(ButtonStyle.Secondary),
  );

  return [text, row, backRow];
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

async function handleCommand(message) {
  if (!isOwner(message.author.id)) {
    await message.reply("Tu n'as pas la permission d'utiliser cette commande.");
    return;
  }
  await message.reply({
    components: buildOwnerMenuComponents(message.guild.id),
    flags: MessageFlags.IsComponentsV2,
  });
}

async function handleInteraction(interaction) {
  const isOwnerAction = interaction.customId?.startsWith('lb_owner_');
  if (!isOwnerAction) return;

  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true }).catch(() => {});
    return;
  }

  const guildId = interaction.guild.id;

  if (interaction.customId === 'lb_owner_back') {
    await interaction.update({
      components: buildOwnerMenuComponents(guildId),
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (interaction.customId === 'lb_owner_pick_messages' || interaction.customId === 'lb_owner_pick_voice') {
    const type = interaction.customId.endsWith('messages') ? 'messages' : 'voice';
    await interaction.update({
      components: buildChannelSelectComponents(type),
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (interaction.customId === 'lb_owner_channel_messages' || interaction.customId === 'lb_owner_channel_voice') {
    const type = interaction.customId.endsWith('messages') ? 'messages' : 'voice';
    const channelId = interaction.values[0];
    stats.setPanelConfig(guildId, type, { channelId, messageId: null });
    await postOrUpdatePanel(interaction.client, guildId, type);
    await interaction.update({
      components: buildOwnerMenuComponents(guildId),
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

module.exports = {
  postOrUpdatePanel,
  refreshAll,
  handleCommand,
  handleInteraction,
};
