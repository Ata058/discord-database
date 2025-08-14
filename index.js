require('dotenv').config();
const { 
  Client, GatewayIntentBits, Partials, REST, Routes, 
  SlashCommandBuilder, PermissionFlagsBits 
} = require('discord.js');
const { Pool } = require('pg');

const { TOKEN, CLIENT_ID, GUILD_ID, DATABASE_URL } = process.env;
if (!TOKEN) throw new Error('❌ Fehlt TOKEN');
if (!CLIENT_ID) throw new Error('❌ Fehlt CLIENT_ID');
if (!DATABASE_URL) throw new Error('❌ Fehlt DATABASE_URL');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ===== Commands =====
const setAnnounceCmd = new SlashCommandBuilder()
  .setName('setannounce')
  .setDescription('Setzt den Announcement-Channel')
  .addChannelOption(o =>
    o.setName('channel')
     .setDescription('Channel für Ankündigungen')
     .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const addAnnounceRoleCmd = new SlashCommandBuilder()
  .setName('announce_role_add')
  .setDescription('Erlaubte Rolle zum /announce hinzufügen')
  .addRoleOption(o =>
    o.setName('role').setDescription('Rolle, die /announce nutzen darf').setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const announceCmd = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Sendet eine Ankündigung in den eingestellten Channel')
  .addStringOption(o =>
    o.setName('text').setDescription('Nachricht / Titel').setRequired(true)
  )
  .addBooleanOption(o =>
    o.setName('ping_everyone').setDescription('@everyone erwähnen?').setRequired(false)
  );

const commands = [setAnnounceCmd, addAnnounceRoleCmd, announceCmd];

// ===== Helper =====
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Guild-Commands registriert');
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Global registriert');
  }
}

async function memberCanAnnounce(interaction) {
  if (!interaction.inGuild()) return false;
  const guildId = interaction.guildId;
  const { rows } = await pool.query(
    'SELECT role_id FROM guild_announce_roles WHERE guild_id = $1',
    [guildId]
  );
  if (rows.length === 0) return false;
  const memberRoleIds = interaction.member.roles.cache.keys();
  const allowed = new Set(rows.map(r => r.role_id));
  for (const r of memberRoleIds) if (allowed.has(r)) return true;
  return false;
}

// ===== Bot Events =====
client.once('ready', () => console.log(`✅ Eingeloggt als ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /setannounce
  if (interaction.commandName === 'setannounce') {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.options.getChannel('channel', true);
    if (!ch.isTextBased()) {
      await interaction.editReply('❌ Bitte einen Text-Channel wählen.');
      return;
    }
    await pool.query(
      `CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        announce_channel_id TEXT
      )`
    );
    await pool.query(
      `INSERT INTO guild_settings (guild_id, announce_channel_id)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET announce_channel_id = EXCLUDED.announce_channel_id`,
      [interaction.guildId, ch.id]
    );
    await interaction.editReply(`✅ Announcement-Channel gesetzt: <#${ch.id}>`);
    return;
  }

  // /announce_role_add
  if (interaction.commandName === 'announce_role_add') {
    await interaction.deferReply({ ephemeral: true });
    const role = interaction.options.getRole('role', true);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS guild_announce_roles (
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      )`
    );
    await pool.query(
      `INSERT INTO guild_announce_roles (guild_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [interaction.guildId, role.id]
    );
    await interaction.editReply(`✅ Rolle <@&${role.id}> darf nun **/announce** nutzen.`);
    return;
  }

  // /announce
  if (interaction.commandName === 'announce') {
    await interaction.deferReply({ ephemeral: true });
    if (!await memberCanAnnounce(interaction)) {
      await interaction.editReply('❌ Du darfst diesen Command nicht verwenden.');
      return;
    }
    const cfg = await pool.query(
      'SELECT announce_channel_id FROM guild_settings WHERE guild_id = $1',
      [interaction.guildId]
    );
    if (cfg.rowCount === 0 || !cfg.rows[0].announce_channel_id) {
      await interaction.editReply('❌ Kein Announcement-Channel gesetzt. Nutze `/setannounce`.');
      return;
    }
    const channelId = cfg.rows[0].announce_channel_id;
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('❌ Der gespeicherte Channel ist nicht mehr gültig.');
      return;
    }
    const text = interaction.options.getString('text', true);
    const pingEveryone = interaction.options.getBoolean('ping_everyone') || false;
    const embed = {
      title: '📣 Ankündigung',
      description: text,
      color: 0x5865F2,
      timestamp: new Date().toISOString(),
      footer: { text: `von ${interaction.user.tag}` }
    };
    const content = pingEveryone ? '@everyone' : undefined;
    await channel.send({ 
      content, 
      embeds: [embed], 
      allowedMentions: { parse: pingEveryone ? ['everyone'] : [] } 
    });
    await interaction.editReply('✅ Announcement wurde gesendet.');
    return;
  }
});

// ===== Start Bot =====
(async () => {
  try { await registerCommands(); } catch (e) { console.error(e); }
  await client.login(TOKEN);
})();
