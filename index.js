// ====================
// BOT SETUP & IMPORTS
// ====================

const keep_alive = require('./keep_alive.js'); // Falls du das als Keep-Alive nutzt
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const schedule = require('node-schedule');
const { google } = require('googleapis');
const express = require('express');
const fs = require('fs');
require('dotenv').config();

// ====================
// GOOGLE SHEETS SETUP
// ====================

const auth = new google.auth.GoogleAuth({
  keyFile: './google-service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ====================
// DISCORD CLIENT SETUP
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ====================
// GLOBAL VARIABLES
// ====================

let lastEmbedMessageId = null; // Speichert die ID der zuletzt gesendeten Tabelle für Editierung

// Datei zum Speichern der letzten Message-ID
const LAST_MSG_FILE = './lastMessage.json';

// ====================
// HILFSFUNKTIONEN ZUM SPEICHERN/LADEN DER MESSAGE-ID
// ====================

function saveLastMessageId(id) {
  try {
    fs.writeFileSync(LAST_MSG_FILE, JSON.stringify({ id }));
  } catch (e) {
    console.error('❌ Fehler beim Speichern der Message-ID:', e);
  }
}

function loadLastMessageId() {
  try {
    if (!fs.existsSync(LAST_MSG_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(LAST_MSG_FILE));
    return data.id;
  } catch (e) {
    console.error('❌ Fehler beim Laden der Message-ID:', e);
    return null;
  }
}

// ====================
// SLASH COMMANDS DEFINIEREN
// ====================

const commands = [
  new SlashCommandBuilder().setName('reset').setDescription('🧹 Reset Tabelle'),
  new SlashCommandBuilder().setName('tabelle').setDescription('📋 Zeige Tabelle erneut'),
  new SlashCommandBuilder().setName('erinnerung').setDescription('🔔 Sende Erinnerung')
].map(cmd => cmd.toJSON());

// ====================
// READY EVENT
// ====================

client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  // Mitglieder mit Rolle 'Member' in Google Sheet eintragen
  await syncMembersWithSheet();

  // Slash Commands beim Discord API registrieren
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  // Zeitgesteuerte Aufgabe um 7 Uhr - Neue Tabelle senden (immer neue Nachricht)
  schedule.scheduleJob({ hour: 7, minute: 0, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) {
      await sendTeilnehmerTabelle(ch, true); // forceNew = true -> neue Nachricht
    }
  });

  // Erinnerung um 19:45
  schedule.scheduleJob({ hour: 19, minute: 45, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) {
      await sendErinnerung(ch);
    }
  });

  // Direkt beim Start eine Tabelle senden (hier auch als neue Nachricht)
  const initCh = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
  if (initCh) {
    await sendTeilnehmerTabelle(initCh, true);
  }
});

// ====================
// INTERACTION CREATE EVENT (Slash Commands, Buttons, Modals)
// ====================

client.on(Events.InteractionCreate, async interaction => {

  if (interaction.isCommand()) {
    // Slash Commands ausführen
    const { commandName } = interaction;

    if (commandName === 'reset') {
      await interaction.reply({ content: '🧹 Zurücksetzen...', ephemeral: true });
      await resetSheetValues();
      await sendTeilnehmerTabelle(interaction.channel);
    }
    else if (commandName === 'tabelle') {
      await interaction.reply({ content: '📋 Sende Tabelle...', ephemeral: true });
      await sendTeilnehmerTabelle(interaction.channel);
    }
    else if (commandName === 'erinnerung') {
      await interaction.reply({ content: '🔔 Erinnerung wird gesendet...', ephemeral: true });
      await sendErinnerung(interaction.channel);
    }

    return;
  }

  if (interaction.isButton()) {
    // Button-Interaktion: Reaktion der Mitglieder

    const userName = interaction.member?.displayName || interaction.user.username;
    const auswahl = interaction.customId;

    if (auswahl === 'Langzeit') {
      if (interaction.replied || interaction.deferred) return;

      const modal = new ModalBuilder()
        .setCustomId('langzeitModal')
        .setTitle('Langzeit-Abmeldung');

      const dateInput = new TextInputBuilder()
        .setCustomId('langzeitDatum')
        .setLabel('Bis wann bist du abgemeldet? (TT.MM.JJJJ)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const reasonInput = new TextInputBuilder()
        .setCustomId('langzeitGrund')
        .setLabel('Grund deiner Abmeldung')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(reasonInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // Update der Google Sheet Werte bei Button-Klick
    try {
      const spreadsheetId = process.env.SHEET_ID;

      // Werte abrufen
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
      const rows = response.data.values || [];

      let updated = false;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === userName) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `B${i + 2}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[auswahl]] }
          });
          updated = true;
          break;
        }
      }

      if (!updated) {
        // Neuer Eintrag
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Status!A:C',
          valueInputOption: 'RAW',
          requestBody: { values: [[userName, auswahl, '']] }
        });
      }

      await interaction.deferUpdate();

      // Tabelle neu senden/aktualisieren - aber hier KEINE neue Nachricht, nur editieren
      const msgChannel = await client.channels.fetch(process.env.LINEUP_CHANNEL_ID);
      if (msgChannel) {
        await sendTeilnehmerTabelle(msgChannel, false); // forceNew = false -> editieren
      }
    } catch (error) {
      console.error('❌ Fehler beim Verarbeiten der Reaktion:', error);
    }

    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'langzeitModal') {
    // Modal mit Langzeit-Abmeldung wurde abgeschickt

    const userName = interaction.member?.displayName || interaction.user.username;
    const datumInput = interaction.fields.getTextInputValue('langzeitDatum');
    const grund = interaction.fields.getTextInputValue('langzeitGrund');

    try {
      const spreadsheetId = process.env.SHEET_ID;
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
      const rows = response.data.values || [];

      let updated = false;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === userName) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `B${i + 2}:C${i + 2}`,
            valueInputOption: 'RAW',
            requestBody: { values: [['Langzeitabmeldung', datumInput]] }
          });
          updated = true;
          break;
        }
      }

      if (!updated) {
        // Neuer Eintrag
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Status!A:C',
          valueInputOption: 'RAW',
          requestBody: { values: [[userName, 'Langzeitabmeldung', datumInput]] }
        });
      }

      await interaction.reply({ content: '✅ Deine Langzeit-Abmeldung wurde gespeichert.', ephemeral: true });

      // Tabelle aktualisieren, ohne neue Nachricht zu senden
      const ch = await client.channels.fetch(process.env.LINEUP_CHANNEL_ID);
      if (ch) {
        await sendTeilnehmerTabelle(ch, false);
      }
    } catch (e) {
      console.error('❌ Fehler bei Langzeit-Abmeldung:', e);
      await interaction.reply({ content: '❌ Fehler beim Speichern deiner Abmeldung.', ephemeral: true });
    }

    return;
  }
});

// ====================
// FUNKTION: Mitgieder synchronisieren (Rollen-Check und Sheet-Eintrag)
// ====================

async function syncMembersWithSheet() {
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) {
      console.warn('⚠️ Guild nicht gefunden!');
      return;
    }

    const role = guild.roles.cache.find(r => r.name === 'Member');
    if (!role) {
      console.warn('⚠️ Rolle "Member" nicht gefunden!');
      return;
    }

    const members = await guild.members.fetch();
    const memberNames = members.filter(m => m.roles.cache.has(role.id)).map(m => m.displayName);

    // Sheet lesen, um bestehende Einträge zu holen
    const spreadsheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:A' });
    const sheetNames = (response.data.values || []).flat();

    // Neue Member, die noch nicht im Sheet sind
    const newMembers = memberNames.filter(name => !sheetNames.includes(name));

    // Neue Mitglieder eintragen
    if (newMembers.length > 0) {
      const values = newMembers.map(name => [name, '', '']);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Status!A:C',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
      console.log(`✅ Neue Mitglieder hinzugefügt: ${newMembers.join(', ')}`);
    }
  } catch (e) {
    console.error('❌ Fehler bei Member-Sync:', e);
  }
}

// ====================
// FUNKTION: Tabelle senden / aktualisieren
// forceNew: Wenn true, immer neue Nachricht senden, sonst vorhandene editieren
// ====================

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
    const rows = response.data.values || [];

    // Sortieren alphabetisch nach Name
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    // Teilnehmer-Tabelle als Text bauen
    let tableText = 'Teilnehmerliste:\n\n';
    tableText += 'Name | Status | Datum\n';
    tableText += '---------------------------\n';
    for (const row of rows) {
      const name = row[0] || '-';
      const status = row[1] || '-';
      const datum = row[2] || '-';
      tableText += `${name} | ${status} | ${datum}\n`;
    }

    // Buttons für Reaktionen
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('Anwesend').setLabel('Anwesend').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('Abwesend').setLabel('Abwesend').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('Langzeit').setLabel('Langzeit').setStyle(ButtonStyle.Secondary)
      );

    if (forceNew || !lastEmbedMessageId) {
      // Neue Nachricht senden
      const message = await channel.send({ content: tableText, components: [buttons] });
      lastEmbedMessageId = message.id;
      saveLastMessageId(lastEmbedMessageId);
    } else {
      // Vorhandene Nachricht editieren
      try {
        const message = await channel.messages.fetch(lastEmbedMessageId);
        await message.edit({ content: tableText, components: [buttons] });
      } catch (e) {
        // Wenn Nachricht nicht gefunden, neue senden
        const message = await channel.send({ content: tableText, components: [buttons] });
        lastEmbedMessageId = message.id;
        saveLastMessageId(lastEmbedMessageId);
      }
    }
  } catch (e) {
    console.error('❌ Fehler beim Senden der Teilnehmer-Tabelle:', e);
  }
}

// ====================
// FUNKTION: Tabelle Werte auf Standard zurücksetzen (Reset)
// ====================

async function resetSheetValues() {
  try {
    const spreadsheetId = process.env.SHEET_ID;

    // Lösche Werte in Status!B2:C (Status und Datum)
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Status!B2:C'
    });

    console.log('✅ Tabelle zurückgesetzt.');
  } catch (e) {
    console.error('❌ Fehler beim Zurücksetzen der Tabelle:', e);
  }
}

// ====================
// FUNKTION: Erinnerung senden
// ====================

async function sendErinnerung(channel) {
  try {
    const reminderText = '🔔 **Erinnerung:** Bitte denkt daran, euch für morgen anzumelden oder euren Status zu aktualisieren!';
    await channel.send(reminderText);
  } catch (e) {
    console.error('❌ Fehler beim Senden der Erinnerung:', e);
  }
}

// ====================
// EXPRESS WEB SERVER (für Keep-Alive)
// ====================

const app = express();

app.get('/', (req, res) => {
  res.send('Bot läuft!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Express Server läuft auf Port ${PORT}`);
});

// ====================
// BOT LOGIN
// ====================

client.login(process.env.DISCORD_TOKEN);

