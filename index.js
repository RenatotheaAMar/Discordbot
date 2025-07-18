const express = require('express');
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
} = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const GUILD_ID = process.env.GUILD_ID;
const LINEUP_CHANNEL_ID = process.env.LINEUP_CHANNEL_ID;
const EXCUSE_CHANNEL_ID = process.env.EXCUSE_CHANNEL_ID;

let memberStatus = new Map(); // userId => { name, status, datum, grund }
let lastMessageId = null;

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
  new SlashCommandBuilder().setName('erinnerung').setDescription('🔔 Sende Erinnerung'),
  new SlashCommandBuilder().setName('scan').setDescription('🔍 Mitglieder neu scannen'),
].map((cmd) => cmd.toJSON());

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
        memberStatus.set(member.user.id, { name: member.displayName, status: null, datum: null, grund: null });
      }
    });
    console.log(`✅ ${memberStatus.size} Mitglieder mit "Member"-Rolle gefunden.`);
  } catch (err) {
    console.error('Fehler beim Mitglieder scannen:', err);
  }
}

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  try {
    const teilnahme = [], abgemeldet = [], spaeter = [], langzeit = [], reagiert = new Set();

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
          langzeit.push(`${info.name} (${info.datum || 'kein Datum'})`);
          break;
      }
    }

    const alleIds = Array.from(memberStatus.keys());
    const nichtReagiert = alleIds.filter(
      (id) => !reagiert.has(id) && !langzeit.some((l) => l.startsWith(memberStatus.get(id).name))
    );

    const embed = new EmbedBuilder()
      .setTitle('📋 Bitte Status wählen:')
      .setDescription('🕗 **Aufstellung 20 Uhr! Reagierpflicht!**')
      .addFields(
        { name: `✅ Teilnahme (${teilnahme.length})`, value: teilnahme.length ? teilnahme.join('\n') : '–', inline: true },
        { name: `❌ Abgemeldet (${abgemeldet.length})`, value: abgemeldet.length ? abgemeldet.join('\n') : '–', inline: true },
        { name: `⏰ Kommt später (${spaeter.length})`, value: spaeter.length ? spaeter.join('\n') : '–', inline: true },
        {
          name: `⚠️ Noch nicht reagiert (${nichtReagiert.length})`,
          value: nichtReagiert.length ? nichtReagiert.map((id) => memberStatus.get(id).name).join('\n') : '–',
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
      new ButtonBuilder().setCustomId('Teilnahme').setLabel('🟢 Teilnahme').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('Abgemeldet').setLabel('❌ Abgemeldet').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('KommtSpaeter').setLabel('⏰ Später').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('Langzeit').setLabel('📆 Langzeit').setStyle(ButtonStyle.Primary)
    );

    const savedId = loadLastMessageId();
    if (savedId && !forceNew) {
      try {
        const oldMsg = await channel.messages.fetch(savedId);
        await oldMsg.edit({ embeds: [embed], components: [row] });
        return;
      } catch {
        console.log('⚠️ Vorherige Nachricht nicht gefunden, sende neu.');
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    saveLastMessageId(newMsg.id);
  } catch (error) {
    console.error('❌ Fehler beim Senden der Tabelle:', error);
  }
}

async function sendErinnerung(channel) {
  try {
    await channel.send('🔔 **Erinnerung:** Bitte tragt euren Status in der Tabelle ein!');
  } catch (e) {
    console.error('Fehler bei Erinnerung senden:', e);
  }
}

function setMemberStatus(userId, status, datum = null, grund = null) {
  if (!memberStatus.has(userId)) return;
  const old = memberStatus.get(userId);
  memberStatus.set(userId, { ...old, status, datum, grund });
}

async function handleLangzeitAbmeldung(userId, datum, grund) {
  setMemberStatus(userId, 'Langzeitabmeldung', datum, grund);
  const excuseChannel = client.channels.cache.get(EXCUSE_CHANNEL_ID);
  if (!excuseChannel) {
    console.error('EXCUSE_CHANNEL_ID nicht gefunden!');
    return;
  }
  await excuseChannel.send({
    content: `📌 **Langzeit-Abmeldung**\n👤 <@${userId}>\n📅 Bis: **${datum}**\n📝 Grund: ${grund || '–'}`,
  });
}

// Bot ready
client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  await scanMembers();

  const cron = require('node-cron');

  // Täglicher Reset um 6:59 Uhr
  cron.schedule('59 6 * * *', () => {
    memberStatus.forEach((val, key) => {
      if (val.status !== 'Langzeitabmeldung') {
        memberStatus.set(key, { ...val, status: null, datum: null, grund: null });
      }
    });
    console.log('🧹 Täglicher Reset durchgeführt.');
  });

  // Tägliche Tabelle + Erinnerung um 7:00 Uhr
  cron.schedule('0 7 * * *', async () => {
    const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
    if (ch) {
      await sendErinnerung(ch);
      await sendTeilnehmerTabelle(ch, true);
    }
  });
});

// Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isCommand()) {
      const { commandName } = interaction;

      if (commandName === 'reset') {
        memberStatus.forEach((val, key) => memberStatus.set(key, { ...val, status: null, datum: null, grund: null }));
        await interaction.reply({ content: '🧹 Status aller Mitglieder zurückgesetzt.', ephemeral: true });
        const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
        if (ch) await sendTeilnehmerTabelle(ch);
      } else if (commandName === 'tabelle') {
        await interaction.reply({ content: '📋 Tabelle wird gesendet...', ephemeral: true });
        const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
        if (ch) await sendTeilnehmerTabelle(ch);
      } else if (commandName === 'erinnerung') {
        await interaction.reply({ content: '🔔 Erinnerung wird gesendet...', ephemeral: true });
        const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
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
          const modal = new ModalBuilder().setCustomId('modalLangzeit').setTitle('Langzeit-Abmeldung');

          const datumInput = new TextInputBuilder()
            .setCustomId('datumInput')
            .setLabel('Bis wann? (TT.MM.JJJJ)')
            .setStyle(1)
            .setPlaceholder('z.B. 05.10.2025')
            .setRequired(true);

          const grundInput = new TextInputBuilder()
            .setCustomId('grundInput')
            .setLabel('Grund')
            .setStyle(2)
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

      const reply = `Status gesetzt: ${
        interaction.customId === 'Abgemeldet'
          ? '❌ Abgemeldet'
          : interaction.customId === 'Teilnahme'
          ? '🟢 Teilnahme'
          : interaction.customId === 'KommtSpaeter'
          ? '⏰ Kommt später'
          : ''
      }`;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: reply, ephemeral: true });
      } else {
        await interaction.reply({ content: reply, ephemeral: true });
      }

      const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modalLangzeit') {
      const datum = interaction.fields.getTextInputValue('datumInput');
      const grund = interaction.fields.getTextInputValue('grundInput');

      await interaction.deferReply({ ephemeral: true });
      await handleLangzeitAbmeldung(interaction.user.id, datum, grund);
      await interaction.editReply({ content: '📆 Langzeit-Abmeldung eingetragen.' });

      const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch);
    }
  } catch (error) {
    console.error('Fehler bei Interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Fehler bei der Verarbeitung.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// EXPRESS Webserver
const app = express();
app.get('/', (req, res) => res.send('Bot läuft ✅'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🌐 Webserver läuft auf Port ${port}`));
