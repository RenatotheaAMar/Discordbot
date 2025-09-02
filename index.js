// ==========================================
// 📦 Module
// ==========================================
const express = require('express');
const fs = require('fs');
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

// ==========================================
// 🧠 Initialisierung
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const GUILD_ID      = process.env.GUILD_ID;
const LINEUP_CHANNEL_ID = process.env.LINEUP_CHANNEL_ID;
const EXCUSE_CHANNEL_ID = process.env.EXCUSE_CHANNEL_ID;

let memberStatus = new Map(); // userId => { name, status, datum, grund }
let lastMessageId = null;

// ==========================================
// 🔧 Helferlein
// ==========================================
function saveLastMessageId(id) {
  try {
    fs.writeFileSync('./lastMessage.json', JSON.stringify({ id }));
  } catch (err) {
    console.error('Fehler beim Speichern der lastMessage.json:', err);
  }
}

function loadLastMessageId() {
  try {
    return JSON.parse(fs.readFileSync('./lastMessage.json')).id;
  } catch {
    return null;
  }
}

// ==========================================
// 🛠️ Slash-Commands registrieren
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('🧹 Reset Status aller Mitglieder (außer Langzeitabmeldungen)'),
  new SlashCommandBuilder()
    .setName('tabelle')
    .setDescription('📋 Zeige Tabelle erneut'),
  new SlashCommandBuilder()
    .setName('erinnerung')
    .setDescription('🔔 Sende Erinnerung'),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('🔍 Mitglieder neu scannen'),
].map((c) => c.toJSON());

// ==========================================
// 🔍 Mitgliederscan
// ==========================================
async function scanMembers() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();

    const role = guild.roles.cache.find((r) => r.name === 'Member');
    if (!role) {
      console.error('Rolle "Member" nicht gefunden!');
      return;
    }

    memberStatus.clear();
    guild.members.cache.forEach((member) => {
      if (!member.user.bot && member.roles.cache.has(role.id)) {
        memberStatus.set(member.user.id, {
          name: member.displayName,
          status: null,
          datum: null,
          grund: null,
        });
      }
    });

    console.log(
      `✅ ${memberStatus.size} gültige Mitglieder mit "Member"-Rolle gefunden (ohne Bots).`
    );
  } catch (err) {
    console.error('Fehler beim Mitglieder scannen:', err);
  }
}

// ==========================================
// 📋 Tabelle senden / aktualisieren
// ==========================================
async function sendTeilnehmerTabelle(channel, forceNew = false) {
  try {
    const teilnahme = [];
    const abgemeldet = [];
    const spaeter = [];
    const langzeit = [];
    const reagiert = new Set();

    for (const [id, info] of memberStatus.entries()) {
      switch (info.status) {
        case 'Teilnahme':
          teilnahme.push(info.name);
          reagiert.add(id);
          break;
        case 'Abgemeldet':
          abgemeldet.push(info.name);
          reagiert.add(id);
          break;
        case 'Kommt später':
          spaeter.push(info.name);
          reagiert.add(id);
          break;
        case 'Langzeitabmeldung':
          langzeit.push(`${info.name} (bis ${info.datum || '?'})`);
          break;
      }
    }

    const nichtReagiert = [...memberStatus.keys()].filter(
      (id) =>
        !reagiert.has(id) &&
        !langzeit.some((l) => l.startsWith(memberStatus.get(id).name))
    );

    const embed = new EmbedBuilder()
      .setTitle('📋 Status für heute – bitte auswählen!')
      .setDescription('🕗 Aufstellung 20 Uhr! Reagierpflicht!')
      .addFields(
        {
          name: `✅ Teilnahme (${teilnahme.length})`,
          value: teilnahme.length ? teilnahme.join('\n') : '–',
          inline: true,
        },
        {
          name: `❌ Abgemeldet (${abgemeldet.length})`,
          value: abgemeldet.length ? abgemeldet.join('\n') : '–',
          inline: true,
        },
        {
          name: `⏰ Kommt später (${spaeter.length})`,
          value: spaeter.length ? spaeter.join('\n') : '–',
          inline: true,
        },
        {
          name: `⚠️ Noch nicht reagiert (${nichtReagiert.length})`,
          value:
            nichtReagiert.length ?
              nichtReagiert.map((id) => memberStatus.get(id).name).join('\n') :
              '–',
          inline: true,
        },
        {
          name: `📆 Langzeitabmeldungen (${langzeit.length})`,
          value: langzeit.length ? langzeit.join('\n') : '–',
          inline: true,
        }
      )
      .setColor('#00b0f4')
      .setFooter({ text: 'Bitte tragt euch rechtzeitig ein!' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('Teilnahme')
        .setLabel('🟢 Teilnahme')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('Abgemeldet')
        .setLabel('❌ Abgemeldet')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('KommtSpaeter')
        .setLabel('⏰ Später')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('Langzeit')
        .setLabel('📆 Langzeit')
        .setStyle(ButtonStyle.Primary)
    );

    const savedId = loadLastMessageId();
    if (savedId && !forceNew) {
      try {
        const oldMsg = await channel.messages.fetch(savedId);
        await oldMsg.edit({ embeds: [embed], components: [row] });
        return;
      } catch {
        console.log('⚠️ Vorherige Nachricht nicht gefunden, sende neu…');
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    saveLastMessageId(newMsg.id);
  } catch (error) {
    console.error('❌ Fehler beim Senden der Tabelle:', error);
  }
}

// ==========================================
// 🔔 Erinnerung
// ==========================================
async function sendErinnerung(channel) {
  try {
    await channel.send(
      '🔔 **Erinnerung:** Bitte tragt euren Status in der Tabelle ein!'
    );
  } catch (e) {
    console.error('Fehler beim Senden der Erinnerung:', e);
  }
}

// ==========================================
// 📝 Status setzen
// ==========================================
function setMemberStatus(userId, status, datum = null, grund = null) {
  if (!memberStatus.has(userId)) return;
  const old = memberStatus.get(userId);
  memberStatus.set(userId, { ...old, status, datum, grund });
}

// ==========================================
// 📆 Langzeit-Abmeldung
// ==========================================
async function handleLangzeitAbmeldung(userId, datum, grund) {
  setMemberStatus(userId, 'Langzeitabmeldung', datum, grund);

  const excuseChannel = client.channels.cache.get(EXCUSE_CHANNEL_ID);
  if (excuseChannel) {
    await excuseChannel.send({
      content:
        `📌 **Langzeit-Abmeldung**\n👤 <@${userId}>\n📅 Bis: **${datum}**\n📝 Grund: ${grund || '–'}`,
    });
  }

  const lineupChannel = client.channels.cache.get(LINEUP_CHANNEL_ID);
  if (lineupChannel) await sendTeilnehmerTabelle(lineupChannel, false);
}

// ==========================================
// 🚀 Ready-Event
// ==========================================
client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  } catch (e) {
    console.error('Fehler beim Registrieren der Slash-Commands:', e);
  }

  await scanMembers();

  // Cronjob nur laden, wenn node-cron vorhanden ist
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('⚠️ node-cron nicht installiert – Cronjobs deaktiviert.');
  }

  if (cron) {
    cron.schedule('0 7 * * *', async () => {
      const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
      if (!ch) return;

      await scanMembers();
      memberStatus.forEach((val, key) => {
        if (val.status !== 'Langzeitabmeldung') {
          memberStatus.set(key, { ...val, status: null, datum: null, grund: null });
        }
      });

      await sendErinnerung(ch);
      await sendTeilnehmerTabelle(ch, true);
    });
  }
});

// ==========================================
// 💬 Interaktionen
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'reset') {
        memberStatus.forEach((val, key) => {
          if (val.status !== 'Langzeitabmeldung') {
            memberStatus.set(key, { ...val, status: null, datum: null, grund: null });
          }
        });
        await interaction.reply({
          content: '🧹 Status aller Mitglieder zurückgesetzt (außer Langzeitabmeldungen).',
          ephemeral: true,
        });
        const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
        if (ch) await sendTeilnehmerTabelle(ch);
      } else if (commandName === 'tabelle') {
        await interaction.reply({ content: '📋 Tabelle wird gesendet...', ephemeral: true });
        const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
        if (ch) await sendTeilnehmerTabelle(ch);
      } else if (commandName === 'erinnerung') {
        await interaction.reply({ content: '🔔 Erinnerung wird gesendet...', ephemeral: true });
        const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
        if (ch) await sendErinnerung(ch);
      } else if (commandName === 'scan') {
        await scanMembers();
        await interaction.reply({ content: '🔍 Mitglieder wurden neu gescannt.', ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      const userId = interaction.user.id;
      switch (interaction.customId) {
        case 'Teilnahme':
          setMemberStatus(userId, 'Teilnahme');
          break;
        case 'Abgemeldet':
          setMemberStatus(userId, 'Abgemeldet');
          break;
        case 'KommtSpaeter':
          setMemberStatus(userId, 'Kommt später');
          break;
        case 'Langzeit': {
          const modal = new ModalBuilder()
            .setCustomId('modal_langzeit_abmeldung')
            .setTitle('Langzeit-Abmeldung');

          const datumInput = new TextInputBuilder()
            .setCustomId('datumInput')
            .setLabel('Bis wann? (TT.MM.JJJJ)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 05.10.2025')
            .setRequired(true);

          const grundInput = new TextInputBuilder()
            .setCustomId('grundInput')
            .setLabel('Grund')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('z.B. Krankheit')
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(datumInput),
            new ActionRowBuilder().addComponents(grundInput)
          );

          await interaction.showModal(modal);
          return;
        }
      }

      await interaction.reply({
        content: `Status gesetzt: ${
          interaction.customId === 'Abgemeldet'
            ? '❌ Abgemeldet'
            : interaction.customId === 'Teilnahme'
            ? '🟢 Teilnahme'
            : '⏰ Kommt später'
        }`,
        ephemeral: true,
      });

      const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
      if (ch) await sendTeilnehmerTabelle(ch);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_langzeit_abmeldung') {
        const datum = interaction.fields.getTextInputValue('datumInput');
        const grund = interaction.fields.getTextInputValue('grundInput');

        await interaction.deferReply({ ephemeral: true }).catch(console.error);
        await handleLangzeitAbmeldung(interaction.user.id, datum, grund);
        await interaction.editReply({ content: '📆 Langzeit-Abmeldung eingetragen.' });
      }
      return;
    }
  } catch (error) {
    console.error('Fehler bei Interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Fehler bei der Verarbeitung.', ephemeral: true });
    }
  }
});

// ==========================================
// 🔑 Login
// ==========================================
client.login(process.env.DISCORD_TOKEN).catch(console.error);

// ==========================================
// 🌐 Express Webserver
// ==========================================
const app = express();
app.get('/', (_req, res) => res.send('Bot läuft ✅'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🌐 Webserver läuft auf Port ${port}`));
