require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const { google } = require('googleapis');
const fs = require('fs');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Google Sheets Setup
const auth = new google.auth.GoogleAuth({
  keyFile: 'google-service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Anwesenheit'; // Name deiner Tabelle

async function appendAttendance(userTag) {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const now = new Date();
  const formattedDate = now.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:B`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[userTag, formattedDate]],
    },
  });
}

client.once('ready', () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);
});

// Beispiel: Reagiere auf "!anwesend"
client.on('messageCreate', async message => {
  if (message.content === '!anwesend') {
    await appendAttendance(message.author.tag);
    message.reply('✅ Deine Anwesenheit wurde eingetragen!');
  }
});

// Tägliche Aufgabe um 8:00 Uhr
cron.schedule('0 8 * * *', async () => {
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  if (channel && channel.isTextBased()) {
    channel.send('👋 Guten Morgen! Bitte schreibt `!anwesend`, um eure Anwesenheit zu registrieren.');
  }
}, {
  timezone: "Europe/Berlin"
});

client.login(process.env.DISCORD_TOKEN);
