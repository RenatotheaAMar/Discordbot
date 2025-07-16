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

let status = {}; // { userId: { status: 'Teilnahme'|'Abgemeldet'|'KommtSpäter'|'Langzeitabmeldung', datum?: string } }

const commands = [
  new SlashCommandBuilder().setName('reset').setDescription('🧹 Setzt alle Status zurück'),
  new SlashCommandBuilder().setName('tabelle').setDescription('📋 Zeigt die Teilnehmer-Tabelle'),
  new SlashCommandBuilder().setName('erinnerung').setDescription('🔔 Sendet Erinnerung an Teilnehmer')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);

  // Slash Commands registrieren
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  // Status zurücksetzen beim Start
  status = {};

  // Mitgliederdaten neu einlesen
  await scanMembers();

  // Tabelle senden beim Start
  const channel = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
  if (channel) await sendTeilnehmerTabelle(channel, true);

  // Zeitpläne
  // 7:00 Uhr Tabelle senden
  schedule.scheduleJob({ hour: 7, minute: 0, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) {
      await scanMembers(); // Mitglieder updaten
      await sendTeilnehmerTabelle(ch, true);
    }
  });

  // 19:45 Erinnerung senden
  schedule.scheduleJob({ hour: 19, minute: 45, tz: 'Europe/Berlin' }, async () => {
    const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
    if (ch) {
      await sendErinnerung(ch);
    }
  });
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isCommand()) {
    if (interaction.commandName === 'reset') {
      status = {};
      await interaction.reply({ content: '🧹 Status wurde zurückgesetzt.', ephemeral: true });
      const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch, true);
      return;
    }

    if (interaction.commandName === 'tabelle') {
      const ch = interaction.channel;
      await sendTeilnehmerTabelle(ch);
      await interaction.reply({ content: '📋 Tabelle gesendet.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'erinnerung') {
      const ch = interaction.channel;
      await sendErinnerung(ch);
      await interaction.reply({ content: '🔔 Erinnerung gesendet.', ephemeral: true });
      return;
    }
  }

  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const userName = interaction.member?.displayName || interaction.user.username;
    const choice = interaction.customId;

    if (choice === 'Langzeit') {
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

    // Status aktualisieren (Teilnahme, Abgemeldet, KommtSpäter)
    if (['Teilnahme', 'Abgemeldet', 'KommtSpäter'].includes(choice)) {
      status[userId] = { status: choice };
      await interaction.deferUpdate();

      const ch = client.channels.cache.get(process.env.LINEUP_CHANNEL_ID);
      if (ch) await sendTeilnehmerTabelle(ch);
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'langzeitModal') {
    const userId = interaction.user.id;
    const userName = interaction.member?.displayName || interaction.user.username;
    const datumInput = interaction.fields.getTextInputValue('langzeitDatum');
    const grund = interaction.fields.getTextInputValue('langzeitGrund');

    status[userId] = { status: 'Langzeitabmeldung', datum: datumInput };

    const excuseChannel = client.channels.cache.get(process.env.EXCUSE_CHANNEL_ID);
    if (excuseChannel) {
      await excuseChannel.send(`📌 **Langzeit-Abmeldung**\n👤 **${userName}**\n📅 Bis: **${datumInput}**\n📝 Grund: ${grund}`);
    }

    await interaction.reply({ content: '✅ Deine Abmeldung wurde erfasst.', ephemeral: true });
    return;
  }
});

async function scanMembers() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // Alle Member mit Role "Member"
  const memberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');
  if (!memberRole) return;

  await guild.members.fetch(); // Cache füllen

  // Alle Member mit Member-Role
  const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(memberRole.id));

  // Neue Mitglieder hinzufügen (wenn noch kein Status)
  for (const [id, member] of membersWithRole) {
    if (!status[id]) {
      status[id] = { status: '' }; // noch kein Status gesetzt
    }
  }

  // Alte Status löschen, wenn Member nicht mehr da oder Rolle verloren
  for (const userId of Object.keys(status)) {
    if (!membersWithRole.has(userId)) {
      delete status[userId];
    }
  }
}

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  const guild = channel.guild;

  const teilnahme = [];
  const abgemeldet = [];
  const spaeter = [];
  const langzeit = [];
  const reagiertIds = new Set();

  // Sortieren nach Status
  for (const [userId, entry] of Object.entries(status)) {
    const member = guild.members.cache.get(userId);
    const name = member?.displayName || member?.user.username || 'Unbekannt';

    switch (entry.status) {
      case 'Teilnahme':
        teilnahme.push(name);
        reagiertIds.add(userId);
        break;
      case 'Abgemeldet':
        abgemeldet.push(name);
        reagiertIds.add(userId);
        break;
      case 'KommtSpäter':
        spaeter.push(name);
        reagiertIds.add(userId);
        break;
      case 'Langzeitabmeldung':
        langzeit.push(`${name} (${entry.datum || 'kein Datum'})`);
        break;
    }
  }

  // Mitglieder mit Rolle "Member"
  const memberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');
  const alleMitglieder = memberRole
    ? guild.members.cache.filter(m => m.roles.cache.has(memberRole.id))
    : [];

  // Nicht reagiert (hat Status nicht gesetzt und nicht Langzeit)
  const nichtReagiert = alleMitglieder
    .filter(m => !reagiertIds.has(m.id) && !langzeit.some(l => l.startsWith(m.displayName)))
    .map(m => m.displayName);

  const embed = new EmbedBuilder()
    .setTitle('📋 Bitte Status wählen:')
    .setDescription('🕗 **Aufstellung 20 Uhr! Reagierpflicht!**')
    .setColor('#00b0f4')
    .addFields(
      { name: `✅ Teilnahme (${teilnahme.length})`, value: teilnahme.length ? teilnahme.join('\n') : '–', inline: true },
      { name: `❌ Abgemeldet (${abgemeldet.length})`, value: abgemeldet.length ? abgemeldet.join('\n') : '–', inline: true },
      { name: `⏰ Kommt später (${spaeter.length})`, value: spaeter.length ? spaeter.join('\n') : '–', inline: true },
      { name: `⚠️ Noch nicht reagiert (${nichtReagiert.length})`, value: nichtReagiert.length ? nichtReagiert.join('\n') : '–', inline: true },
      { name: `📆 Langzeitabmeldungen (${langzeit.length})`, value: langzeit.length ? langzeit.join('\n') : '–', inline: true }
    )
    .setFooter({ text: 'Bitte tragt euch rechtzeitig ein!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('Teilnahme').setLabel('🟢 Teilnahme').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('Abgemeldet').setLabel('❌ Abgemeldet').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('KommtSpäter').setLabel('⏰ Später').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('Langzeit').setLabel('📆 Langzeit').setStyle(ButtonStyle.Primary)
  );

  // Nachricht senden oder updaten (speichern der ID in Datei)
  const lastMessageFile = './lastMessage.json';
  if (!forceNew) {
    try {
      if (fs.existsSync(lastMessageFile)) {
        const data = JSON.parse(fs.readFileSync(lastMessageFile, 'utf8'));
        if (data.id) {
          const oldMsg = await channel.messages.fetch(data.id);
          await oldMsg.edit({ embeds: [embed], components: [row] });
          return;
        }
      }
    } catch {
      // Ignorieren, falls alte Nachricht nicht gefunden
    }
  }

  const newMsg = await channel.send({ embeds: [embed], components: [row] });
  fs.writeFileSync(lastMessageFile, JSON.stringify({ id: newMsg.id }));
}

async function sendErinnerung(channel) {
  const guild = channel.guild;

  // Alle mit Status Teilnahme
  const teilnehmer = Object.entries(status)
    .filter(([_, entry]) => entry.status === 'Teilnahme')
    .map(([userId]) => userId);

  const mentions = [];

  for (const userId of teilnehmer) {
    const member = guild.members.cache.get(userId);
    if (member) mentions.push(`<@${member.id}>`);
  }

  if (mentions.length > 0) {
    await channel.send(`🔔 **Erinnerung:** Aufstellung in 15 Minuten!\n${mentions.join(', ')}`);
  } else {
    await channel.send('ℹ️ Keine gültigen Teilnehmer zum Erinnern gefunden.');
  }
}

client.login(process.env.DISCORD_TOKEN);
