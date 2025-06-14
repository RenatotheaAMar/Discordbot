const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const schedule = require('node-schedule');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  // Jeden Tag um 7 Uhr morgens (05:00 UTC)
  schedule.scheduleJob('0 5 * * *', () => {
    const channelId = process.env.CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    if (!channel) return console.log('❌ Channel nicht gefunden.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('anwesend')
        .setLabel('🟢 Anwesend')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('abgemeldet')
        .setLabel('🔴 Abgemeldet')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('spaeter')
        .setLabel('🟡 Später')
        .setStyle(ButtonStyle.Secondary)
    );

    channel.send({
      content: '📋 Guten Morgen! Bitte tragt euch ein:',
      components: [row]
    });
  });
});

// Wenn ein Button gedrückt wird
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const user = interaction.user.username;
  const auswahl = interaction.customId;

  await interaction.reply({
    content: `✅ ${user} hat sich als **${auswahl}** eingetragen.`,
    ephemeral: true
  });

  // Hier könnte man Daten in Google Sheets eintragen (später)
});

client.login(process.env.DISCORD_TOKEN);
