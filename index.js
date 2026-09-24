require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");
const { DisTube } = require("distube");
const { YtDlpPlugin } = require("@distube/yt-dlp");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ตั้งค่า DisTube (ตัวจัดการเล่นเพลง)
const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin()],
});
client.distube = distube;

// เก็บสถานะปุ่ม toggle ต่อ guild (มิวต์ / สุ่มอัตโนมัติ)
const guildState = new Map(); // guildId -> { muted: bool, autoplay: bool }
function getState(guildId) {
  if (!guildState.has(guildId)) guildState.set(guildId, { muted: false, autoplay: true });
  return guildState.get(guildId);
}

// ---------- สร้างแถวปุ่มควบคุมเพลง (ตามภาพ) ----------
function buildControlRows(guildId) {
  const state = getState(guildId);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("play_pause").setEmoji("▶️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("mute")
      .setLabel(state.muted ? "เปิดเสียง" : "ปิดเสียง")
      .setEmoji("🔇")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("autoplay")
      .setLabel(`สุ่มเพลงอัตโนมัติ: ${state.autoplay ? "On" : "Off"}`)
      .setEmoji("🎯")
      .setStyle(ButtonStyle.Success)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reroll").setLabel("ไม่เอาเพลงนี้ (สุ่มใหม่)").setEmoji("🎲").setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("seek").setLabel("กอเพลง (ระบุวินาที)").setEmoji("⏩").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("settings").setLabel("ตั้งค่าเอง").setEmoji("🎛️").setStyle(ButtonStyle.Primary)
  );

  return [row1, row2, row3, row4];
}

function nowPlayingEmbed(song) {
  return new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("🎶 กำลังเล่นเพลง")
    .setDescription(`**${song.name}**`)
    .addFields(
      { name: "ความยาว", value: song.formattedDuration || "ไม่ทราบ", inline: true },
      { name: "ขอโดย", value: `${song.user}`, inline: true }
    )
    .setThumbnail(song.thumbnail || null);
}

// ---------- ลงทะเบียน slash command ----------
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("เล่นเพลงจากชื่อเพลงหรือลิงก์")
    .addStringOption((opt) => opt.setName("เพลง").setDescription("ชื่อเพลงหรือ URL").setRequired(true)),
].map((c) => c.toJSON());

client.once("ready", async () => {
  console.log(`บอทออนไลน์แล้ว: ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
});

// ---------- คำสั่ง /play ----------
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "play") {
    const query = interaction.options.getString("เพลง");
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.reply({ content: "เข้าห้องเสียงก่อนนะครับ", ephemeral: true });

    await interaction.deferReply();
    try {
      await distube.play(voiceChannel, query, {
        member: interaction.member,
        textChannel: interaction.channel,
      });
      await interaction.editReply(`🔎 กำลังค้นหา: **${query}**`);
    } catch (err) {
      console.error(err);
      await interaction.editReply("เล่นเพลงไม่สำเร็จ ลองใหม่อีกครั้งครับ");
    }
    return;
  }

  // ---------- ปุ่มกด seek ----------
  if (interaction.isButton() && interaction.customId === "seek") {
    const modal = new ModalBuilder().setCustomId("seek_modal").setTitle("กอเพลง (ระบุวินาที)");
    const input = new TextInputBuilder()
      .setCustomId("seek_seconds")
      .setLabel("ข้ามไปวินาทีที่เท่าไร")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น 60")
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // ---------- ปุ่มกด ตั้งค่าเอง ----------
  if (interaction.isButton() && interaction.customId === "settings") {
    const modal = new ModalBuilder().setCustomId("settings_modal").setTitle("ตั้งค่าเอง");
    const volume = new TextInputBuilder()
      .setCustomId("set_volume")
      .setLabel("ระดับเสียง (1-100)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น 50")
      .setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(volume));
    return interaction.showModal(modal);
  }

  // ---------- รับค่าจาก modal: seek ----------
  if (interaction.isModalSubmit() && interaction.customId === "seek_modal") {
    const seconds = parseInt(interaction.fields.getTextInputValue("seek_seconds"), 10);
    const queue = distube.getQueue(interaction.guildId);
    if (!queue) return interaction.reply({ content: "ไม่มีเพลงกำลังเล่นอยู่", ephemeral: true });
    if (isNaN(seconds)) return interaction.reply({ content: "กรุณาใส่ตัวเลขวินาที", ephemeral: true });
    await queue.seek(seconds);
    return interaction.reply({ content: `⏩ ข้ามไปที่วินาทีที่ ${seconds} แล้ว`, ephemeral: true });
  }

  // ---------- รับค่าจาก modal: settings ----------
  if (interaction.isModalSubmit() && interaction.customId === "settings_modal") {
    const volumeInput = interaction.fields.getTextInputValue("set_volume");
    const queue = distube.getQueue(interaction.guildId);
    if (!queue) return interaction.reply({ content: "ไม่มีเพลงกำลังเล่นอยู่", ephemeral: true });
    if (volumeInput) {
      const vol = Math.max(1, Math.min(100, parseInt(volumeInput, 10) || 50));
      queue.setVolume(vol);
    }
    return interaction.reply({ content: "✅ อัปเดตการตั้งค่าแล้ว", ephemeral: true });
  }

  // ---------- ปุ่มควบคุมหลัก ----------
  if (!interaction.isButton()) return;
  const queue = distube.getQueue(interaction.guildId);
  const state = getState(interaction.guildId);

  try {
    switch (interaction.customId) {
      case "play_pause":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        queue.paused ? queue.resume() : queue.pause();
        return interaction.reply({ content: queue.paused ? "⏸️ หยุดชั่วคราว" : "▶️ เล่นต่อ", ephemeral: true });

      case "skip":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        await queue.skip();
        return interaction.reply({ content: "⏭️ ข้ามเพลงแล้ว", ephemeral: true });

      case "stop":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        queue.stop();
        return interaction.reply({ content: "⏹️ หยุดเล่นเพลงแล้ว", ephemeral: true });

      case "loop":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        // 0 = ปิด, 1 = วนเพลงเดียว, 2 = วนทั้งคิว
        const next = (queue.repeatMode + 1) % 3;
        queue.setRepeatMode(next);
        const modeText = ["ปิดการวนเพลง", "วนเพลงเดียว", "วนทั้งคิว"][next];
        return interaction.reply({ content: `🔁 ${modeText}`, ephemeral: true });

      case "shuffle":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        await queue.shuffle();
        return interaction.reply({ content: "🔀 สลับลำดับเพลงแล้ว", ephemeral: true });

      case "mute":
        state.muted = !state.muted;
        if (queue) queue.setVolume(state.muted ? 0 : 100);
        await interaction.update({ components: buildControlRows(interaction.guildId) });
        return;

      case "autoplay":
        state.autoplay = !state.autoplay;
        if (queue) queue.toggleAutoplay();
        await interaction.update({ components: buildControlRows(interaction.guildId) });
        return;

      case "reroll":
        if (!queue) return interaction.reply({ content: "ไม่มีเพลงในคิว", ephemeral: true });
        await queue.skip(); // ข้ามเพลงปัจจุบัน แล้วให้ autoplay/คิวสุ่มเพลงถัดไป
        return interaction.reply({ content: "🎲 สุ่มเพลงใหม่แล้ว", ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) {
      interaction.reply({ content: "เกิดข้อผิดพลาด ลองใหม่อีกครั้งครับ", ephemeral: true });
    }
  }
});

// ---------- ส่งการ์ดเพลง + ปุ่ม เมื่อเริ่มเล่นเพลง ----------
distube.on("playSong", (queue, song) => {
  queue.textChannel.send({
    embeds: [nowPlayingEmbed(song)],
    components: buildControlRows(queue.textChannel.guildId),
  });
});

distube.on("error", (channel, error) => {
  console.error(error);
  if (channel) channel.send("❌ เกิดข้อผิดพลาดในการเล่นเพลง");
});

client.login(process.env.DISCORD_TOKEN);
