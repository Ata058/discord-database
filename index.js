require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Pool } = require('pg');

const { TOKEN, CLIENT_ID, GUILD_ID, DATABASE_URL } = process.env;
if (!TOKEN) throw new Error('Fehlt TOKEN');
if (!CLIENT_ID) throw new Error('Fehlt CLIENT_ID');
if (!DATABASE_URL) throw new Error('Fehlt DATABASE_URL');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const claimCmd = new SlashCommandBuilder()
  .setName('claim')
  .setDescription('Holt einen Account und schickt ihn per DM.')
  .addStringOption(o =>
    o.setName('type').setDescription('fivem/steam/discord').setRequired(true)
     .addChoices({ name: 'fivem', value: 'fivem' }, { name: 'steam', value: 'steam' }, { name: 'discord', value: 'discord' })
  );

const dmtestCmd = new SlashCommandBuilder().setName('dmtest').setDescription('Schickt dir eine Test-DM');

const commands = [claimCmd.toJSON(), dmtestCmd.toJSON()];

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

client.once('ready', () => console.log(`✅ Eingeloggt als ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'dmtest') {
    await interaction.deferReply({ ephemeral: true });
    try { await interaction.user.send('👋 DM-Test OK'); await interaction.editReply('✅ DM gesendet.'); }
    catch { await interaction.editReply('❌ DMs sind blockiert.'); }
    return;
  }

  if (interaction.commandName === 'claim') {
    const service = interaction.options.getString('type');
    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await pool.query(
        `UPDATE accounts
           SET is_used = TRUE, claimed_by = $1, claimed_at = NOW()
         WHERE id = (
           SELECT id FROM accounts WHERE is_used = FALSE AND service = $2 ORDER BY id ASC LIMIT 1
         )
         RETURNING id, username, password, email, email_pass, service`,
        [interaction.user.id, service]
      );

      if (res.rowCount === 0) { await interaction.editReply(`❌ Keine freien **${service}**-Accounts.`); return; }

      const acc = res.rows[0];
      const lines = [
        `🎁 **${acc.service.toUpperCase()} Account**`,
        `• Benutzername: \`${acc.username}\``,
        `• Passwort: \`${acc.password}\``,
      ];
      if (acc.email)      lines.push(`• E-Mail: \`${acc.email}\``);
      if (acc.email_pass) lines.push(`• E-Mail-Passwort: \`${acc.email_pass}\``);

      try {
        await interaction.user.send(lines.join('\n'));
        await interaction.editReply(`✅ ${service}-Account per DM geschickt.`);
      } catch {
        await pool.query('UPDATE accounts SET is_used = FALSE, claimed_by = NULL, claimed_at = NULL WHERE id = $1', [acc.id]);
        await interaction.editReply('❌ Konnte dir keine DM senden. DMs aktivieren und erneut versuchen.');
      }
    } catch (e) {
      console.error(e);
      try { await interaction.editReply('❌ Fehler.'); } catch {}
    }
  }
});

(async () => {
  try { await registerCommands(); } catch (e) { console.error(e); }
  await client.login(TOKEN);
})();
