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

/* ---------- Konstante: erlaubte Guild ---------- */
const ALLOWED_GUILD_ID = '1405633884598829227';

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
  claim: null,
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
        { name: 'claim', value: 'claim' },
      )
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Ziel-Channel für diesen Log-Typ')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/* /claim – nur für Admins, optional mehrere */
const claimCmd = new SlashCommandBuilder()
  .setName('claim')
  .setDescription('Hole einen oder mehrere Accounts und erhalte sie per DM')
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
  .addIntegerOption(opt =>
    opt.setName('count')
      .setDescription('Wie viele? (Standard 1, max. 50)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(50)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/* NEW: /setstock – legt den Bestandskanal fest und erstellt/merkt die Nachricht */
const setStockCmd = new SlashCommandBuilder()
  .setName('setstock')
  .setDescription('Setzt den Kanal für das Bestands-Board (wird als eine Nachricht gehalten)')
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Kanal für das Bestands-Board')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/* NEW: /restock – aktualisiert das Board & pingt @everyone */
const restockCmd = new SlashCommandBuilder()
  .setName('restock')
  .setDescription('Aktualisiert das Bestands-Board und pingt @everyone')
  .addStringOption(o =>
    o.setName('service')
     .setDescription('Welcher Service wurde restocked? (optional)')
     .setRequired(false)
     .addChoices(
       { name: 'steam', value: 'steam' },
       { name: 'fivem', value: 'fivem' },
       { name: 'discord', value: 'discord' },
     ))
  .addStringOption(o =>
    o.setName('note')
     .setDescription('Zusätzliche Info (optional)')
     .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/* ---------- Ready ---------- */
client.once('ready', async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: [banIdCmd, setLogsCmd, claimCmd, setStockCmd, restockCmd],
  });
  console.log('✅ Slash-Commands registriert');
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

/* ---------- Message-Listener: !pp ---------- */
if (message.content.trim().toLowerCase() === '!webmail') {
  const embed = new EmbedBuilder()
    .setTitle('🔗 Webmail Links')
    .setDescription([
      '• **FiveM Ready**: https://30kbatch.com/',
      '• **Discord**: https://rambler.ru/',
      '• **Steam**: http://tb.dcmya.cn/'
    ].join('\n'))
    .setColor(0x5865F2)
    .setTimestamp();
  message.reply({ embeds: [embed] });
  }
});

/* ---------- Helpers: Stock ---------- */
async function ensureStockTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_stock_message (
      guild_id    BIGINT PRIMARY KEY,
      channel_id  BIGINT NOT NULL,
      message_id  BIGINT NOT NULL
    );
  `);
}

async function getStockCounts() {
  const services = ['steam','fivem','discord'];
  const base = Object.fromEntries(services.map(s => [s, 0]));
  const { rows } = await pool.query(
    `SELECT service, COUNT(*)::int AS free
       FROM accounts
      WHERE is_used = false
      GROUP BY service;`
  );
  for (const r of rows) if (base[r.service] !== undefined) base[r.service] = r.free;
  base.total = services.reduce((a,s)=>a+base[s],0);
  return base;
}

function buildStockEmbed(counts) {
  return new EmbedBuilder()
    .setTitle('📦 Bestand (freie Accounts)')
    .setDescription('Live-Bestand aller Services')
    .addFields(
      { name: 'Steam', value: String(counts.steam ?? 0), inline: true },
      { name: 'FiveM', value: String(counts.fivem ?? 0), inline: true },
      { name: 'Discord', value: String(counts.discord ?? 0), inline: true },
      { name: 'Gesamt', value: String(counts.total ?? 0), inline: true },
    )
    .setColor(0x5865F2)
    .setTimestamp();
}

async function updateStockMessage(guild, { ping = false, pingText = '' } = {}) {
  await ensureStockTable();

  const { rows } = await pool.query(
    'SELECT channel_id, message_id FROM guild_stock_message WHERE guild_id = $1',
    [guild.id]
  );
  if (rows.length === 0) return; // nicht konfiguriert

  const { channel_id, message_id } = rows[0];
  const channel = await guild.channels.fetch(channel_id).catch(()=>null);
  if (!channel?.isTextBased()) return;

  const counts = await getStockCounts();
  const embed = buildStockEmbed(counts);

  // Versuche, vorhandene Nachricht zu editieren – wenn weg, neu erstellen
  try {
    const msg = await channel.messages.fetch(message_id);
    await msg.edit({ embeds: [embed] });
  } catch {
    const newMsg = await channel.send({ embeds: [embed] });
    await pool.query(
      `INSERT INTO guild_stock_message (guild_id, channel_id, message_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
      [guild.id, channel.id, newMsg.id]
    );
  }

  if (ping) {
    const content = `@everyone ${pingText || 'Restock ist live!'}`;
    await channel.send({ content, allowedMentions: { parse: ['everyone'] } }).catch(()=>{});
  }
}

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

  /* /setstock */
  if (interaction.commandName === 'setstock') {
    // ✅ Guild-Check
    if (interaction.guild?.id !== ALLOWED_GUILD_ID) {
      return interaction.reply({ content: '🚫 Dieser Command ist nur im autorisierten Server erlaubt.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: '❌ Bitte einen Text-Channel angeben.', ephemeral: true });
    }
    await ensureStockTable();
    const counts = await getStockCounts();
    const embed = buildStockEmbed(counts);

    const msg = await channel.send({ embeds: [embed] });
    await pool.query(
      `INSERT INTO guild_stock_message (guild_id, channel_id, message_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
      [interaction.guild.id, channel.id, msg.id]
    );
    return interaction.reply({ content: `✅ Bestands-Board gesetzt: ${channel}`, ephemeral: true });
  }

  /* /restock */
  if (interaction.commandName === 'restock') {
    // ✅ Guild-Check
    if (interaction.guild?.id !== ALLOWED_GUILD_ID) {
      return interaction.reply({ content: '🚫 Dieser Command ist nur im autorisierten Server erlaubt.', ephemeral: true });
    }

    const service = interaction.options.getString('service') || '';
    const note = interaction.options.getString('note') || '';
    const extra = [service && `**${service}**`, note && `— ${note}`].filter(Boolean).join(' ');
    await updateStockMessage(interaction.guild, { ping: true, pingText: `Restock ist live! ${extra}` });
    return interaction.reply({ content: '✅ Bestand aktualisiert & @everyone gepingt.', ephemeral: true });
  }

  /* /claim */
  if (interaction.commandName === 'claim') {
    // ✅ Guild-Check
    if (interaction.guild?.id !== ALLOWED_GUILD_ID) {
      return interaction.reply({ content: '🚫 Dieser Command ist nur im autorisierten Server erlaubt.', ephemeral: true });
    }

    // Nur Admins
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '🚫 Du brauchst **Administrator**-Rechte, um diesen Befehl zu verwenden.',
        ephemeral: true
      });
    }

    const service = interaction.options.getString('service'); // steam|fivem|discord
    const count = interaction.options.getInteger('count') || 1;
    const MAX_PER_CALL = 50;
    const wanted = Math.min(Math.max(count, 1), MAX_PER_CALL);

    // Check: DMs offen?
    try { await interaction.user.createDM(); }
    catch { return interaction.reply({ content: '❌ Ich kann dir keine DM senden. Bitte DMs aktivieren und erneut versuchen.', ephemeral: true }); }

    const pgClient = await pool.connect();
    try {
      await pgClient.query('BEGIN');

      // Nächste freien Accounts (Zeilen sperren)
      const sel = await pgClient.query(
        `SELECT id, username, password, email, email_pass
           FROM accounts
          WHERE is_used = false AND service = $1
          ORDER BY id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [service, wanted]
      );

      if (sel.rows.length === 0) {
        await pgClient.query('ROLLBACK');
        return interaction.reply({ content: `❌ Keine verfügbaren **${service}**-Accounts.`, ephemeral: true });
      }

      const accs = sel.rows;
      const ids = accs.map(a => a.id);

      // Reservieren/markieren in einem Rutsch
      await pgClient.query(
        `UPDATE accounts
            SET is_used = true,
                claimed_by = $1,
                claimed_at = NOW()
          WHERE id = ANY($2::int[])`,
        [interaction.user.id, ids]
      );

      // DM bauen: Übersicht + Liste als Codeblock
      const header = new EmbedBuilder()
        .setTitle(`✅ Deine ${service}-Accounts`)
        .setDescription(`Anzahl: **${accs.length}**`)
        .setColor(0x57F287)
        .setTimestamp();

      const lines = accs.map((a, i) => {
        const email = a.email || a.username || '—';
        const epass = a.email_pass || a.password || '—';
        return `${String(i+1).padStart(2,'0')}. ${a.username || '—'} | ${a.password || '—'}${a.email ? ` | ${email} | ${epass}` : ''}`;
      });

      const chunks = [];
      let current = '```';
      for (const line of lines) {
        if ((current + '\n' + line + '```').length > 1900) {
          current += '```';
          chunks.push(current);
          current = '```' + line;
        } else {
          current += (current === '```' ? '' : '\n') + line;
        }
      }
      current += '```';
      chunks.push(current);

      await interaction.user.send({ embeds: [header] });
      for (const c of chunks) {
        await interaction.user.send({ content: c });
      }

      await pgClient.query('COMMIT');
      await interaction.reply({ content: `📬 Ich habe dir **${accs.length}** ${service}-Account(s) per DM geschickt.`, ephemeral: true });

      // Claim loggen (optional)
      if (logChannels.claim) {
        const logCh = interaction.guild.channels.cache.get(logChannels.claim);
        if (logCh?.isTextBased()) {
          const preview = accs.slice(0, 3).map(a => a.username).filter(Boolean).join(', ') || '—';
          const logEmbed = new EmbedBuilder()
            .setTitle('📥 Accounts geclaimt')
            .addFields(
              { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` },
              { name: 'Service', value: service, inline: true },
              { name: 'Anzahl', value: String(accs.length), inline: true },
              { name: 'Erste(n) Username(s)', value: preview, inline: false },
              { name: 'Zeitpunkt', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }
            )
            .setColor(0x2F3136)
            .setTimestamp();
          logCh.send({ embeds: [logEmbed] }).catch(()=>{});
        }
      }

      // Bestandsboard aktualisieren (ohne Ping)
      await updateStockMessage(interaction.guild);

    } catch (err) {
      try { await pgClient.query('ROLLBACK'); } catch {}
      return interaction.reply({ content: `❌ Fehler beim Claim: ${err.message}`, ephemeral: true });
    } finally {
      pgClient.release();
    }
  }
});

client.login(process.env.TOKEN);
