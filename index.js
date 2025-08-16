// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // für guildMemberAdd (Auto-Role)
    GatewayIntentBits.GuildMessages,     // für messageCreate
    GatewayIntentBits.MessageContent     // damit "!pp" gelesen werden darf
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
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
  // Bots ignorieren
  if (message.author.bot) return;

  // exakt !pp (case-insensitive)
  if (message.content.trim().toLowerCase() === '!pp') {
    message.reply('💳 our PayPal-Adress: **fliegerselling@gmail.com**');
  }
});

client.login(process.env.TOKEN);
