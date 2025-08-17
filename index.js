// index.js
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder,
  REST,
  Routes
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // guildMemberAdd / Update (Auto-Role, Timeout/Nickname)
    GatewayIntentBits.GuildMessages,     
    GatewayIntentBits.MessageContent,    // "!pp"
    GatewayIntentBits.GuildBans          // Ban-Logs
  ],
  partials: [Partials.Channel],
});

/* ---------------- In-Memory Log-Config (pro Bot-Laufzeit) ---------------- */
const logChannels = {
  join: null,
  leave: null,
  ban: null,
  timeout: null,
  nickname: null,
};

/* ---------------- Slash-Commands definieren ---------------- */
const banIdCmd = new SlashCommandBuilder()
  .setName('banid')
  .setDescription('Banne einen User per Discord-ID mit Grund')
  .addStringOption(opt =>
    opt.setName('userid')
       .setDescription('Die Discord-ID des Users')
       .setRequired(true))
  .addStringOption(opt =>
    opt.setName('grund')
       .setDescription('Der Grund für den Bann')
       .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

const setLogsCmd = new SlashCommandBuilder()
  .setName('setlogs')
  .setDescription('Setze den Log-Channel für einen Log-Typ')
  .addStringOption(opt =>
    opt.setName('typ')
      .setDescription('Welcher Log-Typ?')
      .setRequired(true)
      .addChoices(
        { name: 'join', value: 'join' },
        { name: 'leave', value: 'leave' },
        { name: 'ban', value: 'ban' },
        { name: 'timeout', value: 'timeout' },
        { name: 'nickname', value: 'nickname' },
      )
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Ziel-Channel für diesen Log-Typ')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

client.once('ready', async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);

  // Commands global registrieren (Propagationszeit bis ~1h möglich)
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: [banIdCmd, setLogsCmd],
  });
  console.log('✅ Slash-Commands /banid und /setlogs registriert');
});

/* ---------- Auto-Role beim Join ---------- */
client.on('guildMemberAdd', async (member) => {
  const roleId = process.env.AUTO_ROLE_ID;
  if (!roleId) return console.warn('⚠️ AUTO_ROLE_ID fehlt in den Env Vars.');

  const role = member.guild.roles.cache.get(roleId)
            ?? await member.guild.roles.fetch(roleId).catch(() => null);

  if (!role) {
    console.warn(`⚠️ Rolle mit ID ${roleId} nicht gefunden in Guild ${member.guild.name}`);
    return;
  }

  try {
    await member.roles.add(role, 'Auto-Role bei Serverbeitritt');
    console.log(`✅ ${member.user.tag} hat die Rolle "${role.name}" erhalten.`);
  } catch (err) {
    console.error('❌ Konnte Rolle nicht vergeben:', err.message);
  }

  // JOIN-Log
  if (logChannels.join) {
    const ch = member.guild.channels.cache.get(logChannels.join);
    if (ch?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('📥 Member Join')
        .setDescription(`**${member.user.tag}** ist beigetreten.`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setColor(0x57F287)
        .setTimestamp();
      ch.send({ embeds: [embed] }).catch(() => {});
    }
  }
});

/* ---------- LEAVE-Log ---------- */
client.on('guildMemberRemove', (member) => {
  if (!logChannels.leave) return;
  const ch = member.guild.channels.cache.get(logChannels.leave);
  if (!ch?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('📤 Member Leave')
    .setDescription(`**${member.user.tag}** hat den Server verlassen.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setColor(0xED4245)
    .setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
});

/* ---------- BAN-Log (Serverseitig) ---------- */
client.on('guildBanAdd', (ban) => {
  if (!logChannels.ban) return;
  const ch = ban.guild.channels.cache.get(logChannels.ban);
  if (!ch?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('⛔ Benutzer gebannt (Server)')
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})` }
    )
    .setThumbnail(ban.user.displayAvatarURL({ size: 256 }))
    .setColor(0xED4245)
    .setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
});

/* ---------- TIMEOUT- / NICKNAME-Logs ---------- */
client.on('guildMemberUpdate', (oldMember, newMember) => {
  // TIMEOUT
  if (logChannels.timeout) {
    const was = oldMember.communicationDisabledUntilTimestamp ?? 0;
    const now = newMember.communicationDisabledUntilTimestamp ?? 0;
    if (was !== now) {
      const ch = newMember.guild.channels.cache.get(logChannels.timeout);
      if (ch?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('⏳ Timeout geändert')
          .setDescription(`**${newMember.user.tag}** Timeout: ${now ? `<t:${Math.floor(now/1000)}:f>` : 'entfernt'}`)
          .setColor(0xFEE75C)
          .setTimestamp();
        ch.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }

  // NICKNAME
  if (logChannels.nickname) {
    const before = oldMember.nickname ?? oldMember.user.username;
    const after  = newMember.nickname ?? newMember.user.username;
    if (before !== after) {
      const ch = newMember.guild.channels.cache.get(logChannels.nickname);
      if (ch?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('✏️ Nickname geändert')
          .setDescription(`**${newMember.user.tag}**\n\`${before}\` → \`${after}\``)
          .setColor(0x5865F2)
          .setTimestamp();
        ch.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }
});

/* ---------- Message-Listener: !pp ---------- */
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() === '!pp') {
    message.reply('💳 our PayPal-Adress: **fliegerselling@gmail.com**');
  }
});

/* ---------- Slash-Command Handler ---------- */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /banid
  if (interaction.commandName === 'banid') {
    const userId = interaction.options.getString('userid');
    const grund = interaction.options.getString('grund');

    try {
      await interaction.guild.members.ban(userId, { reason: grund });

      const embed = new EmbedBuilder()
        .setTitle('🚫 User Banned')
        .addFields(
          { name: 'User-ID', value: userId, inline: true },
          { name: 'Grund', value: grund, inline: true }
        )
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // zusätzlich: falls Log-Channel für BAN gesetzt → auch dort posten
      if (logChannels.ban) {
        const ch = interaction.guild.channels.cache.get(logChannels.ban);
        if (ch?.isTextBased()) ch.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (err) {
      console.error('❌ Fehler beim Bannen:', err.message);
      await interaction.reply({ content: `❌ Fehler: ${err.message}`, ephemeral: true });
    }
    return;
  }

  // /setlogs
  if (interaction.commandName === 'setlogs') {
    const typ = interaction.options.getString('typ');
    const channel = interaction.options.getChannel('channel');

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: '❌ Bitte einen Text-Channel auswählen.', ephemeral: true });
      return;
    }

    logChannels[typ] = channel.id;
    await interaction.reply({ content: `✅ **${typ}**-Logs werden nun in ${channel} gesendet.`, ephemeral: true });
    return;
  }
});

client.login(process.env.TOKEN);
