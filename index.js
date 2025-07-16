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
const express = require('express');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let lastEmbedMessageId = null;
let memberStatus = new Map(); // key: user ID, value: { name: displayName, status, datum? }

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

const commands = [
  new SlashCommandBuilder().setName('reset').setDescription('🧹 Reset Status aller Mitglieder'),
  new SlashCommandBuilder().setName('tabelle').setDescription('📋 Zeige Tabelle erneut'),
  new SlashCommandBuilder().setName('erinnerung').setDescription('🔔 Sende Erinnerung')
].map(cmd => cmd.toJSON());

async function scanMembers() {
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) {
      console.error('Guild nicht gefunden!');
      return;
    }

    await guild.members.fetch(); // lädt alle Mitglieder komplett (nur mit Server Members Intent)

    memberStatus.clear();

    const role = guild.roles.cache.find(r => r.name === 'Member');
    if (!role) {
      console.error('Rolle "Member" nicht gefunden!');
      return;
    }

    // Alle Mitglieder mit Rolle 'Member' aufnehmen, Status erstmal leer (nicht reagiert)
    guild.members.cache.forEach(member => {
      if (member.user.bot) return; // Bots ignorieren
      if (member.roles.cache.has(role.id)) {
        memberStatus.set(member.user.id, {
          name: member.displayName,
          status: null,
          datum: null
        });
      }
    });

    console.log(`✅ ${memberStatus.size} Mitglieder mit "Member"-Rolle gefunden.`);
  } catch (err) {
    console.error('Fehler beim Mitglieder scannen:', err);
  }
}

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  try {
    // Teilnehmer-Listen vorbereiten
    const teilnahme = [];
    const abgemeldet = [];
    const spaeter = [];
    const langzeit = [];
    const reagiert = new Set();

    for (const [id, info] of memberStatus.entries()) {
      const name = info.name;
      switch (info.status) {
        case 'Teilnahme':
          teilnahme.push(name);
          reagiert.add(id);
          break;
        case 'Abgemeldet':
          abgemeldet.push(name);
          reagiert.add(id);
          break;
        case 'Kommt später':
          spaeter.push(name);
          reagiert.add(id);
          break;
        case 'Langzeitabmeldung':
          langzeit.push(`${name} (${info.datum || 'kein Datum'})`);
          break;
        default:
          // nicht reagiert
          break;
      }
    }

    const alleIds = Array.from(memberStatus.keys());
    const nichtReagiert = alleIds.filter(id => !reagiert.has(id) && !langzeit.some(l => l.startsWith(memberStatus.get(id).name)));

    const embed = new EmbedBuilder()
      .setTitle('📋 Bitte Status wählen:')
      .setDescription('🕗 **Aufstellung 20 Uhr! Reagierpflicht!**')
      .addFields(
        { name: `✅ Teilnahme (${teilnahme.length})`, value: teilnahme.length ? teilnahme.join('\n') : '–', inline: true },
        { name: `❌ Abgemeldet (${abgemeldet.length})`, value: abgemeldet.length ? abgemeldet.join('\n') : '–', inline: true },
        { name: `⏰ Kommt später (${spaeter.length})`, value: spaeter.length ? spaeter.join('\n') : '–', inline: true },
        { name: `⚠️ Noch nicht reagiert (${nichtReagiert.length})`, value: nichtReagiert.length ? nichtReagiert.map(id => memberStatus.get(id).name).join('\n') : '–', inline: true },
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
        } catch {
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

client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  // Mitglieder scannen beim Start
  await scanMembers();

  // Zeitgesteuerte Aufgaben
  schedule.scheduleJob({ hour: 7, minute: 0, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) await sendTeilnehmerTabelle(ch, true);
  });

  schedule.scheduleJob({ hour: 19, minute: 45, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) await sendErinnerung(ch);
  });

  // Tabelle gleich beim Start im Channel senden (erstellt einmalig die Nachricht)
  const initCh = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
  if (initCh) sendTeilnehmerTabelle(initCh, true);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isCommand()) {
      const { commandName } = interaction;

      if (commandName === 'reset') {
        memberStatus.forEach((val, key) => {
          memberStatus.set(key, { name: val.name, status: null, datum: null });
        });
        await interaction.reply({ content: '🧹 Status aller Mitglieder zurückgesetzt.', ephemeral: true });
        const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
        if (ch) await sendTeilnehmerTabelle(ch, true);
      } else if (commandName === 'tabelle') {
        await interaction.reply({ content: '📋 Tabelle wird gesendet...', ephemeral: true });
        const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
        if (ch) await sendTeilnehmerTabelle(ch, true);
      } else if (commandName === 'erinnerung') {
        await interaction.reply({ content: '🔔 Erinnerung wird gesendet...', ephemeral: true });
        const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
        if (ch) await sendErinnerung(ch);
      }
      return;
    }

    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const userName = interaction.member?.displayName || interaction.user.username;
      const auswahl = interaction.customId;

      // Update memberStatus mit UserID als Key
      const oldInfo = memberStatus.get(userId);
      memberStatus.set(userId, {
        name: oldInfo?.name || userName,
        status: auswahl,
        datum: null
      });

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
          .setLabel('Grund deiner Abmeldung (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(dateInput);
        const row2 = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row1, row2);

        await interaction.showModal(modal);
        return;
      }

      await interaction.reply({ content: `Dein Status wurde auf **${auswahl}** gesetzt.`, ephemeral: true });

      // Tabelle aktualisieren (nach Button-Klick wird embed editiert, keine neue Nachricht)
      const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch);

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'langzeitModal') {
      const userId = interaction.user.id;
      const userName = interaction.member?.displayName || interaction.user.username;
      const datumInput = interaction.fields.getTextInputValue('langzeitDatum');
      const grund = interaction.fields.getTextInputValue('langzeitGrund');

      const oldInfo = memberStatus.get(userId);
      memberStatus.set(userId, {
        name: oldInfo?.name || userName,
        status: 'Langzeitabmeldung',
        datum: datumInput
      });

      // In den Langzeit-Abmelde-Channel posten
      const excuseChannel = client.channels.cache.get(process.env.EXCUSE_CHANNEL_ID);
      if (excuseChannel) {
        const memberMention = interaction.member.toString();
        await excuseChannel.send(
          `📌 **Langzeit-Abmeldung**\n👤 ${memberMention}\n📅 Bis: **${datumInput}**\n📝 Grund: ${grund}`
        );
      }

      await interaction.reply({
        content: `✅ Deine Abmeldung wurde erfasst.`,
        ephemeral: true
      });

      // Tabelle im LINEUP_CHANNEL_ID aktualisieren
      const lineupChannel = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
      if (lineupChannel) sendTeilnehmerTabelle(lineupChannel, false);

      return;
    }
  } catch (err) {
    console.error('❌ Fehler bei Interaction:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '⚠️ Ein Fehler ist aufgetreten.', ephemeral: true });
    }
  }
});

async function sendErinnerung(channel) {
  if (!channel) return;

  // Nur an Teilnehmer (Status Teilnahme und Kommt später)
  const reminderIds = [];
  for (const [id, info] of memberStatus.entries()) {
    if (info.status === 'Teilnahme' || info.status === 'Kommt später') reminderIds.push(id);
  }

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  const mentionStr = reminderIds.map(id => {
    if (!guild) return id;
    const member = guild.members.cache.get(id);
    return member ? `<@${member.id}>` : id;
  }).join(' ');

  await channel.send(`🔔 Erinnerung: Bitte denkt an die Aufstellung um 20 Uhr! ${mentionStr}`);
}

client.login(process.env.DISCORD_TOKEN);

const app = express();
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`🌐 Webserver läuft auf Port ${port}`);
});
