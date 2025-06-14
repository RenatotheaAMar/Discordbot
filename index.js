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
        .setCustomId('Teilnahme')
        .setLabel('🟢 Teilnahme')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('Abgemeldet')
        .setLabel('🔴 Abgemeldet')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('Kommt später')
        .setLabel('🟡 Kommt später')
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
        .setCustomId('Teilnahme')
        .setLabel('🟢 Teilnahme')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('Abgemeldet')
        .setLabel('🔴 Abgemeldet')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('Kommt später')
        .setLabel('🟡 Kommt später')
        .setStyle(ButtonStyle.Secondary)
    );

    message.channel.send({
      content: '📋 **TEST** - Bitte tragt euch ein:',
      components: [row]
    });
  }
});

// Funktion um zu prüfen wer noch nicht reagiert hat
async function updateResponseStatus() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    // Alle Daten aus dem Sheet lesen
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A:E' // Alle Spalten lesen
    });
    
    const rows = response.data.values || [];
    
    // Heute reagierte Personen finden
    const heute = new Date().toLocaleDateString('de-DE');
    const heuteReagiert = new Set();
    
    for (let i = 1; i < rows.length; i++) { // Zeile 0 überspringen (Header)
      const [name, status, abmeldedatum, reagiert, autoLoeschen] = rows[i];
      if (name && status && rows[i].includes(heute)) {
        heuteReagiert.add(name);
      }
    }
    
    // Alle Personen durchgehen und "Reagiert?" Status aktualisieren
    const updates = [];
    for (let i = 1; i < rows.length; i++) {
      const [name] = rows[i];
      if (name && name.trim() !== '') {
        const hatReagiert = heuteReagiert.has(name) ? 'Ja' : 'Nein';
        updates.push([`D${i + 1}`, hatReagiert]); // Spalte D = "Reagiert?"
      }
    }
    
    // Batch-Update für alle "Reagiert?" Spalten
    if (updates.length > 0) {
      const batchUpdate = {
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates.map(([range, value]) => ({
            range,
            values: [[value]]
          }))
        }
      };
      
      await sheets.spreadsheets.values.batchUpdate(batchUpdate);
      console.log(`📊 ${updates.length} Antwort-Status aktualisiert`);
    }
    
  } catch (error) {
    console.error('❌ Fehler beim Status-Update:', error);
  }
}

// Wenn ein Button gedrückt wird
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  // Display Name (Server-Nickname) verwenden
  const userName = interaction.member?.displayName || interaction.user.username;
  const auswahl = interaction.customId;

  // In Google Sheets eintragen - exakt wie deine Excel-Struktur
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    // Prüfen ob Person bereits in der Liste steht
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A:E'
    });
    
    const rows = response.data.values || [];
    let zeilenfunden = false;
    
    // Suche nach der Person in der Liste
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === userName) { // Spalte A = Name
        // Person gefunden - Status in Spalte B aktualisieren
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `B${i + 1}`, // Spalte B = Status
          valueInputOption: 'RAW',
          requestBody: {
            values: [[auswahl]]
          }
        });
        zeilenfunden = true;
        break;
      }
    }
    
    // Falls Person nicht in der Liste steht, neue Zeile hinzufügen
    if (!zeilenfunden) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A:E',
        valueInputOption: 'RAW',
        requestBody: {
          values: [[userName, auswahl, '', '', '']] // Name, Status, leer, leer, leer
        }
      });
    }
    
    // "Reagiert?" Status für alle aktualisieren
    await updateResponseStatus();

    console.log(`📝 ${userName} als "${auswahl}" eingetragen`);
  } catch (error) {
    console.error('❌ Fehler beim Google Sheets eintragen:', error);
  }

  await interaction.reply({
    content: `✅ ${userName} hat sich als **${auswahl}** eingetragen.`,
    ephemeral: true
  });
});

client.login(process.env.DISCORD_TOKEN);