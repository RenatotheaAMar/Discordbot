
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const schedule = require('node-schedule');
const { google } = require('googleapis');
require('dotenv').config();

// Google Sheets Setup
const auth = new google.auth.GoogleAuth({
  keyFile: './google-service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

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

// Test-Befehl zum sofortigen Testen
client.on('messageCreate', message => {
  if (message.content === '!test') {
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

    message.channel.send({
      content: '📋 **TEST** - Bitte tragt euch ein:',
      components: [row]
    });
  }
});

// Wenn ein Button gedrückt wird
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const user = interaction.user.username;
  const auswahl = interaction.customId;

  // In Google Sheets eintragen
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const now = new Date();
    const datum = now.toLocaleDateString('de-DE');
    const zeit = now.toLocaleTimeString('de-DE');

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A:D', // Spalten A bis D
      valueInputOption: 'RAW',
      requestBody: {
        values: [[datum, zeit, user, auswahl]]
      }
    });

    console.log(`📝 ${user} als "${auswahl}" in Google Sheets eingetragen`);
  } catch (error) {
    console.error('❌ Fehler beim Google Sheets eintragen:', error);
  }

  await interaction.reply({
    content: `✅ ${user} hat sich als **${auswahl}** eingetragen.`,
    ephemeral: true
  });
});

client.login(process.env.DISCORD_TOKEN);
