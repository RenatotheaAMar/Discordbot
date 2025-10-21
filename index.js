// Discord Lineup Bot mit festen IDs und Token

const express = require("express");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
} = require("discord.js");

// Feste Variablen (statt env)
const DISCORD_TOKEN = "MTM4MzIzMDc4OTI4MTUxNzcxMQ.G0ej5m.otE0K3VtGUt-AH7gF0UuTjAt6o3EakPyVqOIl8";
const GUILD_ID = "1238804639546343454";
const LINEUP_CHANNEL_ID = "1383523237631098880";
const EXCUSE_CHANNEL_ID = "1290999989480198176";
const PORT = 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let memberStatus = new Map();
let cronRunning = false;

const LAST_SENT_DAY_FILE = path.join(__dirname, "lastSentDay.json");
const LAST_MESSAGE_FILE = path.join(__dirname, "lastMessage.json");

function saveLastMessageId(id) {
  fs.writeFileSync(LAST_MESSAGE_FILE, JSON.stringify({ id }, null, 2));
}

function loadLastMessageId() {
  try {
    return JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE)).id;
  } catch {
    return null;
  }
}

function saveLastSentDay(date) {
  fs.writeFileSync(LAST_SENT_DAY_FILE, JSON.stringify({ date }, null, 2));
}
function loadLastSentDay() {
  try {
    return JSON.parse(fs.readFileSync(LAST_SENT_DAY_FILE)).date;
  } catch {
    return null;
  }
}

function getCurrentDate() {
  return new Date().toISOString().split("T")[0];
}

async function scanMembers() {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.members.fetch();
  const role = guild.roles.cache.find((r) => r.name === "Member");
  if (!role) return;
  memberStatus.clear();
  guild.members.cache.forEach((m) => {
    if (!m.user.bot && m.roles.cache.has(role.id)) {
      memberStatus.set(m.user.id, {
        name: m.displayName,
        status: null,
        datum: null,
        grund: null,
      });
    }
  });
}

async function sendTeilnehmerTabelle(channel, forceNew = false) {
  const teilnahme = [];
  const abgemeldet = [];
  const spaeter = [];
  const langzeit = [];
  const reagiert = new Set();

  for (const [id, info] of memberStatus.entries()) {
    switch (info.status) {
      case "Teilnahme":
        teilnahme.push(info.name);
        reagiert.add(id);
        break;
      case "Abgemeldet":
        abgemeldet.push(info.name);
        reagiert.add(id);
        break;
      case "Kommt später":
        spaeter.push(info.name);
        reagiert.add(id);
        break;
      case "Langzeitabmeldung":
        langzeit.push(`${info.name} (bis ${info.datum || "?"})`);
        break;
    }
  }

  const nichtReagiert = [...memberStatus.keys()].filter(
    (id) =>
      !reagiert.has(id) &&
      !langzeit.some((n) => n.startsWith(memberStatus.get(id).name))
  );

  const embed = new EmbedBuilder()
    .setTitle("📋 Status für heute – bitte auswählen!")
    .setDescription("🕗 Aufstellung 20 Uhr! Reagierpflicht!")
    .addFields(
      {
        name: `✅ Teilnahme (${teilnahme.length})`,
        value: teilnahme.length ? teilnahme.join("\n") : "–",
        inline: true,
      },
      {
        name: `❌ Abgemeldet (${abgemeldet.length})`,
        value: abgemeldet.length ? abgemeldet.join("\n") : "–",
        inline: true,
      },
      {
        name: `⏰ Kommt später (${spaeter.length})`,
        value: spaeter.length ? spaeter.join("\n") : "–",
        inline: true,
      },
      {
        name: `⚠ Noch nicht reagiert (${nichtReagiert.length})`,
        value: nichtReagiert.length
          ? nichtReagiert.map((id) => memberStatus.get(id).name).join("\n")
          : "–",
        inline: true,
      },
      {
        name: `📆 Langzeitabmeldungen (${langzeit.length})`,
        value: langzeit.length ? langzeit.join("\n") : "–",
        inline: true,
      }
    )
    .setColor("#00b0f4")
    .setFooter({ text: "Bitte tragt euch rechtzeitig ein!" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("Teilnahme")
      .setLabel("🟢 Teilnahme")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("Abgemeldet")
      .setLabel("❌ Abgemeldet")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("KommtSpaeter")
      .setLabel("⏰ Später")
      .setStyle(ButtonStyle.Secondary)
  );

  const savedId = loadLastMessageId();
  if (savedId && !forceNew) {
    try {
      const oldMsg = await channel.messages.fetch(savedId);
      await oldMsg.edit({ embeds: [embed], components: [row] });
      return;
    } catch {
      console.log("⚠ Alte Nachricht nicht gefunden.");
    }
  }

  const newMsg = await channel.send({ embeds: [embed], components: [row] });
  saveLastMessageId(newMsg.id);
}

client.once("ready", async () => {
  console.log(`✅ Bot aktiv als: ${client.user.tag}`);
  await scanMembers();

  if (!cronRunning) {
    cronRunning = true;
    cron.schedule(
      "0 9 * * *",
      async () => {
        const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
        if (!ch) return;
        const today = getCurrentDate();
        const lastSentDay = loadLastSentDay();
        if (lastSentDay === today) return;
        await scanMembers();
        await sendTeilnehmerTabelle(ch, true);
        saveLastSentDay(today);
        console.log("📆 Tabelle heute gesendet");
      },
      { timezone: "Europe/Berlin" }
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;
  const today = getCurrentDate();

  const old = memberStatus.get(userId);
  const statusName =
    interaction.customId === "Teilnahme"
      ? "🟢 Teilnahme"
      : interaction.customId === "Abgemeldet"
      ? "❌ Abgemeldet"
      : "⏰ Kommt später";

  memberStatus.set(userId, { ...old, status: statusName, datum: today });
  await interaction.reply({ content: `Status gesetzt: ${statusName}`, ephemeral: true });

  const ch = await client.channels.fetch(LINEUP_CHANNEL_ID).catch(() => null);
  if (ch) await sendTeilnehmerTabelle(ch);
});

client.login(DISCORD_TOKEN);

const app = express();
app.get("/", (_, res) => res.send("Bot läuft ✅"));
app.listen(PORT, () => console.log(`🌐 Webserver auf Port ${PORT}`));
