// index.js
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder 
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // für guildMemberAdd (Auto-Role)
    GatewayIntentBits.GuildMessages,     // für messageCreate
    GatewayIntentBits.MessageContent     // damit "!pp" gelesen werden darf
  ],
  partials: [Partials.Channel],
});

client.once('ready', async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);

  // Slash Command für Ban registrieren
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

  // Befehl global registrieren (kann bis zu 1h dauern)
  await client.application.commands.set([banIdCmd]);
  console.log('✅ Slash-Command /banid registriert');
});

/* ---------- Auto-Role beim Join ---------- */
client.on('guildMemberAdd', async (member) => {
  const roleId = process.env.AUTO_ROLE_ID;
  if (!roleId) return console.warn('⚠️ AUTO_ROLE_ID fehlt in den Env Vars.');

  // Rolle holen
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

  if (interaction.commandName === 'banid') {
    const userId = interaction.options.getString('userid');
    const grund = interaction.options.getString('grund');

    try {
      await interaction.guild.members.ban(userId, { reason: grund });

      // Embed im Channel posten
      const embed = new EmbedBuilder()
        .setTitle('🚫 Benutzer gebannt')
        .addFields(
          { name: 'User-ID', value: userId, inline: true },
          { name: 'Grund', value: grund, inline: true }
        )
        .setColor('Red')
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      console.log(`✅ User ${userId} gebannt mit Grund: ${grund}`);
    } catch (err) {
      console.error('❌ Fehler beim Bannen:', err.message);
      await interaction.reply({ content: `❌ Fehler: ${err.message}`, ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);
