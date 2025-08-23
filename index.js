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
const { Pool } = require('pg');

/* ---------- Postgres ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Railway
});

/* ---------- Discord Client ---------- */
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

/* NEW: /claim – jetzt nur für Admins */
const claimCmd = new SlashCommandBuilder()
  .setName('claim')
  .setDescription('Hole einen Account und erhalte ihn per DM')
  .addStringOption(opt =>
    opt.setName('service')
      .setDescription('Account-Typ')
      .setRequired(true)
      .addChoices(
        { name: 'steam', value: 'steam' },
        { name: 'fivem', value: 'fivem' },
        { name: 'discord', value: 'discord' },
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // <— WICHTIG

/* ---------- Ready ---------- */
client.once('ready', async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: [banIdCmd, setLogsCmd, claimCmd],
  });
  console.log('✅ Slash-Commands /banid, /setlogs, /claim registriert');
});

/* ---------- Auto-Role beim Join + Join-Log ---------- */
client.on('guildMemberAdd', async (member) => {
  const roleId = process.env.AUTO_ROLE_ID;
  if (roleId) {
    const role = member.guild.roles.cache.get(roleId)
      ?? await member.guild.roles.fetch(roleId).catch(() => null);
    if (role) {
      try { await member.roles.add(role, 'Auto-Role bei Serverbeitritt'); }
      catch (e) { console.warn('Auto-Role Fehler:', e.message); }
    }
  }
  if (logChannels.join) {
    const ch = member.guild.channels.cache.get(logChannels.join);
    ch?.isTextBased() && ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle('📥 Member Join')
        .setDescription(`**${member.user.tag}** ist beigetreten.`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setColor(0x57F287)
        .setTimestamp()
    ]}).catch(()=>{});
  }
});

/* ---------- Leave-Log ---------- */
client.on('guildMemberRemove', (member) => {
  const ch = logChannels.leave && member.guild.channels.cache.get(logChannels.leave);
  ch?.isTextBased() && ch.send({ embeds: [
    new EmbedBuilder()
      .setTitle('📤 Member Leave')
      .setDescription(`**${member.user.tag}** hat den Server verlassen.`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setColor(0xED4245)
      .setTimestamp()
  ]}).catch(()=>{});
});

/* ---------- Ban-Log (serverseitig) ---------- */
client.on('guildBanAdd', (ban) => {
  const ch = logChannels.ban && ban.guild.channels.cache.get(logChannels.ban);
  ch?.isTextBased() && ch.send({ embeds: [
    new EmbedBuilder()
      .setTitle('⛔ Benutzer gebannt (Server)')
      .addFields({ name: 'User', value: `${ban.user.tag} (${ban.user.id})` })
      .setThumbnail(ban.user.displayAvatarURL({ size: 256 }))
      .setColor(0xED4245)
      .setTimestamp()
  ]}).catch(()=>{});
});

/* ---------- Timeout- / Nickname-Logs ---------- */
client.on('guildMemberUpdate', (oldMember, newMember) => {
  // Timeout
  if (logChannels.timeout) {
    const was = oldMember.communicationDisabledUntilTimestamp ?? 0;
    const now = newMember.communicationDisabledUntilTimestamp ?? 0;
    if (was !== now) {
      const ch = newMember.guild.channels.cache.get(logChannels.timeout);
      ch?.isTextBased() && ch.send({ embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Timeout geändert')
          .setDescription(`**${newMember.user.tag}** Timeout: ${now ? `<t:${Math.floor(now/1000)}:f>` : 'entfernt'}`)
          .setColor(0xFEE75C)
          .setTimestamp()
      ]}).catch(()=>{});
    }
  }
  // Nickname
  if (logChannels.nickname) {
    const before = oldMember.nickname ?? oldMember.user.username;
    const after  = newMember.nickname ?? newMember.user.username;
    if (before !== after) {
      const ch = newMember.guild.channels.cache.get(logChannels.nickname);
      ch?.isTextBased() && ch.send({ embeds: [
        new EmbedBuilder()
          .setTitle('✏️ Nickname geändert')
          .setDescription(`**${newMember.user.tag}**\n\`${before}\` → \`${after}\``)
          .setColor(0x5865F2)
          .setTimestamp()
      ]}).catch(()=>{});
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

/* ---------- Interactions ---------- */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  /* /banid */
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
      if (logChannels.ban) {
        const ch = interaction.guild.channels.cache.get(logChannels.ban);
        ch?.isTextBased() && ch.send({ embeds: [embed] }).catch(()=>{});
      }
    } catch (err) {
      await interaction.reply({ content: `❌ Fehler: ${err.message}`, ephemeral: true });
    }
    return;
  }

  /* /setlogs */
  if (interaction.commandName === 'setlogs') {
    const typ = interaction.options.getString('typ');
    const channel = interaction.options.getChannel('channel');
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: '❌ Bitte einen Text-Channel auswählen.', ephemeral: true });
    }
    logChannels[typ] = channel.id;
    return interaction.reply({ content: `✅ **${typ}**-Logs werden nun in ${channel} gesendet.`, ephemeral: true });
  }

  /* /claim */
  if (interaction.commandName === 'claim') {
    // **Runtime-Schutz**: Nur Admins
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '🚫 Du brauchst **Administrator**-Rechte, um diesen Befehl zu verwenden.',
        ephemeral: true
      });
    }

    const service = interaction.options.getString('service'); // steam|fivem|discord

    // Check: DMs offen?
    try { await interaction.user.createDM(); }
    catch { return interaction.reply({ content: '❌ Ich kann dir keine DM senden. Bitte DMs aktivieren und erneut versuchen.', ephemeral: true }); }

    const pgClient = await pool.connect();
    try {
      await pgClient.query('BEGIN');

      // Nächster freier Account dieses Services (Zeile sperren)
      const sel = await pgClient.query(
        `SELECT id, username, password, email, email_pass
           FROM accounts
          WHERE is_used = false AND service = $1
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [service]
      );

      if (sel.rows.length === 0) {
        await pgClient.query('ROLLBACK');
        return interaction.reply({ content: `❌ Keine verfügbaren **${service}**-Accounts.`, ephemeral: true });
      }

      const acc = sel.rows[0];

      // Reservieren/markieren
      await pgClient.query(
        `UPDATE accounts
            SET is_used = true,
                claimed_by = $1,
                claimed_at = NOW()
          WHERE id = $2`,
        [interaction.user.id, acc.id]
      );

      // DM senden
      const embed = new EmbedBuilder()
        .setTitle(`✅ Dein ${service}-Account`)
        .addFields(
          { name: 'Username', value: acc.username || '—', inline: true },
          { name: 'Passwort', value: acc.password || '—', inline: true },
          ...(acc.email ? [{ name: 'E-Mail', value: acc.email, inline: true }] : []),
          ...(acc.email_pass ? [{ name: 'E-Mail-Passwort', value: acc.email_pass, inline: true }] : []),
        )
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.user.send({ embeds: [embed] });

      await pgClient.query('COMMIT');
      return interaction.reply({ content: '📬 Ich habe dir den Account per DM geschickt.', ephemeral: true });

    } catch (err) {
      try { await pgClient.query('ROLLBACK'); } catch {}
      return interaction.reply({ content: `❌ Fehler beim Claim: ${err.message}`, ephemeral: true });
    } finally {
      pgClient.release();
    }
  }
});

client.login(process.env.TOKEN);
