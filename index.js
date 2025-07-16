// index.js

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
  SlashCommandBuilder,
  InteractionType,
} = require('discord.js');

const schedule = require('node-schedule');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let memberStatus = new Map(); // userId => { name, status, datum, grund }
let lastEmbedMessageId = null;

const GUILD_ID = process.env.GUILD_ID;
const LINEUP_CHANNEL_ID = process.env.LINEUP_CHANNEL_ID;
const EXCUSE_CHANNEL_ID = process.env.EXCUSE_CHANNEL_ID;

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
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('🧹 Reset Status aller Mitglieder'),
  new SlashCommandBuilder()
    .setName('tabelle')
    .setDescription('📋 Zeige Tabelle erneut'),
  new SlashCommandBuilder()
    .setName('erinnerung')
    .setDescription('🔔 Sende Erinnerung'),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('🔍 Mitglieder neu scannen'),
].map((cmd) => cmd.toJSON());

async function scanMembers() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('Guild nicht gefunden!');

    await guild.members.fetch();
    memberStatus.clear();

    const role = guild.roles.cache.find((r) => r.name === 'Member');
    if (!role) return console.error('Rolle "Member" nicht gefunden!');

    guild.members.cache.forEach((member) => {
      if (member.user.bot) return;
      if (member.roles.cache.has(role.id)) {
        memberStatus.set(member.user.id, {
          name: member.displayName,
          status: null,
          datum: null,
          grund: null,
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
      }
    }

    const alleIds = Array.from(memberStatus.keys());
    const nichtReagiert = alleIds.filter(
      (id) =>
        !reagiert.has(id) &&
        !langzeit.some((l) => l.startsWith(memberStatus.get(id).name))
    );

    const embed = new EmbedBuilder()
      .setTitle('📋 Bitte Status wählen:')
      .setDescription('🕗 **Aufstellung 20 Uhr! Reagierpflicht!**')
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
          value: nichtReagiert.length
            ? nichtReagiert.map((id) => memberStatus.get(id).name).join('\n')
            : '–',
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
        .setCustomId('KommtSpäter')
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
    await channel.send('🔔 Erinnerung: Bitte tragt rechtzeitig euren Status ein!');
  } catch (error) {
    console.error('Fehler beim Senden der Erinnerung:', error);
  }
}

function setMemberStatus(userId, status, datum = null, grund = null) {
  if (!memberStatus.has(userId)) return;
  const info = memberStatus.get(userId);
  memberStatus.set(userId, {
    name: info.name,
    status,
    datum,
    grund,
  });
}

client.once('ready', async () => {
  console.log(`✅ Bot ist online als: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  await scanMembers();

  const initCh = client.channels.cache.get(LINEUP_CHANNEL_ID);
  if (initCh) await sendTeilnehmerTabelle(initCh, true);

  // Beispiel: Erinnerung um 7 Uhr morgens (Cron: "0 7 * * *")
  schedule.scheduleJob('0 7 * * *', async () => {
    const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
    if (ch) await sendErinnerung(ch);
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Slash-Commands
  if (interaction.isCommand()) {
    const { commandName } = interaction;

    if (commandName === 'reset') {
      memberStatus.forEach((val, key) =>
        memberStatus.set(key, { name: val.name, status: null, datum: null, grund: null })
      );
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

  // Button Interactions
  if (interaction.isButton()) {
    const userId = interaction.user.id;
    switch (interaction.customId) {
      case 'Teilnahme':
        setMemberStatus(userId, 'Teilnahme');
        await interaction.reply({ content: 'Status gesetzt: 🟢 Teilnahme', ephemeral: true });
        break;
      case 'Abgemeldet':
        setMemberStatus(userId, 'Abgemeldet');
        await interaction.reply({ content: 'Status gesetzt: ❌ Abgemeldet', ephemeral: true });
        break;
      case 'KommtSpäter':
        setMemberStatus(userId, 'Kommt später');
        await interaction.reply({ content: 'Status gesetzt: ⏰ Kommt später', ephemeral: true });
        break;
      case 'Langzeit':
        // Modal zeigen um Datum & Grund zu erfassen
        const modal = new ModalBuilder()
          .setCustomId('langzeitModal')
          .setTitle('Langzeit-Abmeldung');

        const datumInput = new TextInputBuilder()
          .setCustomId('datumInput')
          .setLabel('Bis wann (Datum)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('z.B. 05.10.2025')
          .setRequired(true);

        const grundInput = new TextInputBuilder()
          .setCustomId('grundInput')
          .setLabel('Grund')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Grund der Abmeldung')
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(datumInput);
        const row2 = new ActionRowBuilder().addComponents(grundInput);

        modal.addComponents(row1, row2);

        await interaction.showModal(modal);
        return; // Wichtig: Kein weiteres Reply hier!
    }
    // Nach Statusänderung Tabelle aktualisieren
    const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
    if (ch) await sendTeilnehmerTabelle(ch);
    return;
  }

  // Modal Submit (z.B. für Langzeitabmeldung)
  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'langzeitModal') {
      const datum = interaction.fields.getTextInputValue('datumInput');
      const grund = interaction.fields.getTextInputValue('grundInput');
      const userId = interaction.user.id;

      setMemberStatus(userId, 'Langzeitabmeldung', datum, grund);

      await interaction.reply({ content: 'Langzeit-Abmeldung wurde gespeichert.', ephemeral: true });

      // Nachricht im Entschuldigungs-Channel senden
      const excuseChannel = client.channels.cache.get(EXCUSE_CHANNEL_ID);
      if (excuseChannel) {
        await excuseChannel.send({
          content: `📌 **Langzeit-Abmeldung**
👤 <@${userId}>
📅 Bis: **${datum}**
📝 Grund: ${grund || '–'}`,
        });
      }

      // Tabelle aktualisieren
      const ch = client.channels.cache.get(LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
