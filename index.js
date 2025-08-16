const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", () => {
    console.log(`✅ Eingeloggt als ${client.user.tag}`);
});

// Event Listener für Nachrichten
client.on("messageCreate", (message) => {
    // Bot soll nicht auf sich selbst reagieren
    if (message.author.bot) return;

    // Wenn jemand "!pp" schreibt
    if (message.content.toLowerCase() === "!pp") {
        message.reply("💳 Our PayPal-Adress: **fliegerselling@gmail.com**");
    }
});

client.login(process.env.TOKEN);
