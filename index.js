require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= BANCO =================

let db = {};

if (fs.existsSync('database.json')) {
  db = JSON.parse(fs.readFileSync('database.json'));
}

function saveDB() {
  fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
}

// ================= SLASH COMMANDS =================

const commands = [
  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Adicionar pontos a um membro')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuário')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantidade')
        .setDescription('Quantidade de pontos')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ver ranking atual'),

  new SlashCommandBuilder()
    .setName('resetranking')
    .setDescription('Resetar ranking semanal')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
  console.log('✅ Slash commands registrados');
})();

// ================= RANKING =================

async function updateRanking(guild) {
  const rankingArray = Object.entries(db)
    .filter(([key]) => key !== '_rankingMessageId')
    .sort((a, b) => b[1] - a[1]);

  const channel = guild.channels.cache.get(config.rankingChannelId);
  if (!channel) return;

  let content = `🏆 **Ranking Semanal - Streamers VIP**\n\n`;

  if (rankingArray.length === 0) {
    content += `Nenhum ponto registrado ainda.`;
  } else {
    rankingArray.slice(0, 10).forEach((user, index) => {
      content += `**${index + 1}º** <@${user[0]}> — ${user[1]} pts\n`;
    });
  }

  // ===== Mensagem fixa =====
  if (!db._rankingMessageId) {
    const msg = await channel.send(content);
    db._rankingMessageId = msg.id;
    saveDB();
  } else {
    try {
      const msg = await channel.messages.fetch(db._rankingMessageId);
      await msg.edit(content);
    } catch {
      const msg = await channel.send(content);
      db._rankingMessageId = msg.id;
      saveDB();
    }
  }

  // ===== Atualizar Top 3 =====
  for (let pos = 1; pos <= 3; pos++) {

    const roleId = config.topRoles[pos];
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    // remove de quem tem
    role.members.forEach(member => {
      member.roles.remove(roleId).catch(() => {});
    });

    // adiciona ao novo top
    if (rankingArray[pos - 1]) {
      const member = await guild.members.fetch(rankingArray[pos - 1][0]).catch(() => null);
      if (member) {
        await member.roles.add(roleId).catch(() => {});
      }
    }
  }
}

// ================= INTERAÇÕES =================

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addpoints') {
    const user = interaction.options.getUser('usuario');
    const amount = interaction.options.getInteger('quantidade');

    if (!db[user.id]) db[user.id] = 0;
    db[user.id] += amount;

    saveDB();

    await interaction.reply({
      content: `✅ ${amount} pontos adicionados para ${user.username}`,
      ephemeral: true
    });

    await updateRanking(interaction.guild);
  }

  if (interaction.commandName === 'ranking') {
    const rankingArray = Object.entries(db)
      .filter(([key]) => key !== '_rankingMessageId')
      .sort((a, b) => b[1] - a[1]);

    let content = `🏆 **Ranking Atual**\n\n`;

    if (rankingArray.length === 0) {
      content += `Nenhum ponto registrado ainda.`;
    } else {
      rankingArray.slice(0, 10).forEach((user, index) => {
        content += `**${index + 1}º** <@${user[0]}> — ${user[1]} pts\n`;
      });
    }

    await interaction.reply({ content, ephemeral: true });
  }

  if (interaction.commandName === 'resetranking') {
    db = {};
    saveDB();

    await interaction.reply('♻️ Ranking resetado com sucesso!');
    await updateRanking(interaction.guild);
  }
});

// ================= RESET SEMANAL AUTOMÁTICO =================

setInterval(() => {
  db = {};
  saveDB();
  console.log('♻️ Reset semanal automático executado');
}, 1000 * 60 * 60 * 24 * 7);

// ================= READY =================

client.once('ready', () => {
  console.log(`🚀 Bot online como ${client.user.tag}`);
});

client.login(token);
