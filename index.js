const keep_alive = require('./keep_alive.js');
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

// 🔐 Google Sheets Setup
require('dotenv').config();
const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });


const sheets = google.sheets({ version: 'v4', auth });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

let lastEmbedMessageId = null;

function saveLastMessageId(id) {
  fs.writeFileSync('./lastMessage.json', JSON.stringify({ id }));
}

function loadLastMessageId() {
  try {
    const data = JSON.parse(fs.readFileSync('./lastMessage.json'));
    return data.id;
  } catch {
    return null;
  }
}

// Slash Commands
const commands = [
  new SlashCommandBuilder().setName('reset').setDescription('🧹 Reset Tabelle'),
  new SlashCommandBuilder().setName('tabelle').setDescription('📋 Zeige Tabelle erneut'),
  new SlashCommandBuilder().setName('erinnerung').setDescription('🔔 Sende Erinnerung')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  // Zeitgesteuerte Aufgaben

  schedule.scheduleJob({ hour: 7, minute: 0, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) await sendTeilnehmerTabelle(ch, true);
  });

  schedule.scheduleJob({ hour: 19, minute: 45, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) await sendErinnerung(ch);
  });

  const initCh = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
  if (initCh) sendTeilnehmerTabelle(initCh, true);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isCommand()) {
    const { commandName } = interaction;

    if (commandName === 'reset') {
      await interaction.reply({ content: '🧹 Zurücksetzen...', ephemeral: true });
      await resetSheetValues();
      await sendTeilnehmerTabelle(interaction.channel);
    } else if (commandName === 'tabelle') {
      await interaction.reply({ content: '📋 Sende Tabelle...', ephemeral: true });
      await sendTeilnehmerTabelle(interaction.channel);
    } else if (commandName === 'erinnerung') {
      await interaction.reply({ content: '🔔 Erinnerung wird gesendet...', ephemeral: true });
      await sendErinnerung(interaction.channel);
    }
    return;
  }

  if (interaction.isButton()) {
    const userName = interaction.member?.displayName || interaction.user.username;
    const auswahl = interaction.customId;

    if (auswahl === 'Langzeit') {
      if (interaction.replied || interaction.deferred) return;

      const modal = new ModalBuilder().setCustomId('langzeitModal').setTitle('Langzeit-Abmeldung');
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

    try {
      const spreadsheetId = process.env.SHEET_ID;
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
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Status!A:C',
          valueInputOption: 'RAW',
          requestBody: { values: [[userName, auswahl, '']] }
        });
      }

      await interaction.deferUpdate();
      const msgChannel = await client.channels.fetch(process.env.LINEUP_CHANNEL_ID);
      if (msgChannel) await sendTeilnehmerTabelle(msgChannel);
    } catch (error) {
      console.error('❌ Fehler:', error);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'langzeitModal') {
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
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Status!A:C',
          valueInputOption: 'RAW',
          requestBody: { values: [[userName, 'Langzeitabmeldung', datumInput]] }
        });
      }

      const excuseChannel = client.channels.cache.get(process.env.EXCUSE_CHANNEL_ID);
      if (excuseChannel) {
        await excuseChannel.send(`📌 **Langzeit-Abmeldung**\n👤 **${userName}**\n📅 Bis: **${datumInput}**\n📝 Grund: ${grund}`);
      }

      await interaction.reply({
        content: `✅ Deine Abmeldung wurde erfasst.`,
        ephemeral: true
      });
    } catch (err) {
      console.error('❌ Fehler:', err);
      await interaction.reply({ content: '⚠️ Fehler beim Eintragen.', ephemeral: true });
    }
    return;
  }
});

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
    const rows = response.data.values || [];

    const teilnahme = [], abgemeldet = [], spaeter = [], langzeit = [], reagiert = new Set();

    for (const row of rows) {
      const [name, status, datum] = row;
      if (!name) continue;

      switch (status) {
        case 'Teilnahme':
          teilnahme.push(name);
          reagiert.add(name);
          break;
        case 'Abgemeldet':
          abgemeldet.push(name);
          reagiert.add(name);
          break;
        case 'Kommt später':
          spaeter.push(name);
          reagiert.add(name);
          break;
        case 'Langzeitabmeldung':
          langzeit.push(`${name} (${datum || 'kein Datum'})`);
          break;
        default:
          // keine Reaktion, wird unten gelistet
          break;
      }
    }

    const alleNamen = rows.filter(r => r[0]).map(r => r[0]);
    const nichtReagiert = alleNamen.filter(name => !reagiert.has(name) && !langzeit.some(l => l.startsWith(name)));

    const embed = new EmbedBuilder()
      .setTitle('📋 Bitte Status wählen:')
      .setDescription('🕗 **Aufstellung 20 Uhr! Reagierpflicht!**')

.addFields(
  { name: `✅ Teilnahme (${teilnahme.length})`, value: teilnahme.length ? teilnahme.join('\n') : '–', inline: true },
  { name: `❌ Abgemeldet (${abgemeldet.length})`, value: abgemeldet.length ? abgemeldet.join('\n') : '–', inline: true },
  { name: `⏰ Kommt später (${spaeter.length})`, value: spaeter.length ? spaeter.join('\n') : '–', inline: true },

  { name: `⚠️ Noch nicht reagiert (${nichtReagiert.length})`, value: nichtReagiert.length ? nichtReagiert.join('\n') : '–', inline: true },
  { name: `📆 Langzeitabmeldungen (${langzeit.length})`, value: langzeit.length ? langzeit.join('\n') : '–', inline: true }
)

      .setColor('#00b0f4')
      .setFooter({ text: 'Bitte tragt euch rechtzeitig ein!' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('Teilnahme').setLabel('🟢 Teilnahme').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('Abgemeldet').setLabel('❌ Abgemeldet').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('Kommt später').setLabel('⏰ Später').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('Langzeit').setLabel('📆 Langzeit').setStyle(ButtonStyle.Primary)
    );

    if (!forceNew) {
      const savedId = loadLastMessageId();
      if (savedId) {
        try {
          const oldMsg = await channel.messages.fetch(savedId);
          await oldMsg.edit({ embeds: [embed], components: [row] });
          return;
        } catch (e) {
          console.log('⚠️ Vorherige Nachricht nicht gefunden.');
        }
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    saveLastMessageId(newMsg.id);
  } catch (error) {
    console.error('❌ Fehler beim Senden der Tabelle:', error);
  }
}


async function resetSheetValues() {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
    const rows = response.data.values || [];

    const updates = rows.map(row => {
      return row[1] === 'Langzeitabmeldung' ? ['Langzeitabmeldung', row[2] || ''] : ['', ''];
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Status!B2:C',
      valueInputOption: 'RAW',
      requestBody: { values: updates }
    });
  } catch (error) {
    console.error('❌ Fehler beim Zurücksetzen der Tabelle:', error);
  }
}

async function sendErinnerung(channel) {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!A2:C' });
    const rows = response.data.values || [];

    const teilnehmerNamen = rows.filter(row => row[1] === 'Teilnahme').map(row => row[0]);
    const guild = channel.guild;
    const mentions = [];

    for (const name of teilnehmerNamen) {
      const member = guild.members.cache.find(m => m.displayName === name || m.user.username === name);
      if (member) mentions.push(`<@${member.id}>`);
    }

    if (mentions.length > 0) {
      await channel.send(`🔔 **Erinnerung:** Aufstellung in 15 Minuten!\n${mentions.join(', ')}`);
    } else {
      await channel.send('ℹ️ Keine gültigen Teilnehmer zum Erinnern gefunden.');
    }
  } catch (err) {
    console.error('❌ Fehler bei der Erinnerung:', err);
  }
}

const app = express();
app.get('/', (req, res) => {
  res.send('✅ Bot läuft!');
});
app.listen(3000, () => {
  console.log('🌐 Webserver läuft auf Port 3000');
});

client.login(process.env.DISCORD_TOKEN);
