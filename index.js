require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField
} = require('discord.js');

const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});


// ===================== CRIAR DATABASE AO INICIAR =====================

if (!fs.existsSync('./database')) {
  fs.mkdirSync('./database');
}

if (!fs.existsSync('./database/ranking.json')) {
  fs.writeFileSync('./database/ranking.json', '{}');
}

if (!fs.existsSync('./database/proofs.json')) {
  fs.writeFileSync('./database/proofs.json', '{}');
}


// ===================== DATABASE FUNCTIONS =====================

function readDB(path) {
  return JSON.parse(fs.readFileSync(path));
}

function writeDB(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}


// ===================== UPDATE RANKING =====================

async function updateRanking(guild) {
  const ranking = readDB('./database/ranking.json');

  const rankingArray = Object.entries(ranking)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 10);

  const channel = guild.channels.cache.get(config.rankingChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🏆 Ranking Semanal - Streamers VIP')
    .setColor('Gold');

  if (rankingArray.length === 0) {
    embed.setDescription('Nenhum ponto registrado ainda.');
  } else {
    rankingArray.forEach((user, index) => {
      embed.addFields({
        name: `#${index + 1}`,
        value: `<@${user[0]}> — ${user[1].points} pontos`
      });
    });
  }

  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessage = messages.find(m => m.author.id === client.user.id);

  if (botMessage) {
    await botMessage.edit({ embeds: [embed] });
  } else {
    await channel.send({ embeds: [embed] });
  }

  const members = await guild.members.fetch();

  for (let pos = 1; pos <= 3; pos++) {
    const roleId = config.topRoles[pos];
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    members.forEach(member => {
      if (member.roles.cache.has(roleId)) {
        member.roles.remove(roleId).catch(() => {});
      }
    });

    if (rankingArray[pos - 1]) {
      const member = guild.members.cache.get(rankingArray[pos - 1][0]);
      if (member) member.roles.add(roleId).catch(() => {});
    }
  }
}


// ===================== RESET SEMANAL =====================

cron.schedule('0 0 * * 1', () => {
  writeDB('./database/ranking.json', {});
  console.log('Ranking resetado automaticamente.');
});


// ===================== SLASH COMMANDS =====================

const commands = [
  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Adicionar pontos')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuário').setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantidade').setDescription('Quantidade').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removepoints')
    .setDescription('Remover pontos')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuário').setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantidade').setDescription('Quantidade').setRequired(true))
].map(cmd => cmd.toJSON());


client.once('ready', async () => {
  console.log(`Bot online como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log('Slash commands registrados.');
});


// ===================== INTERACTIONS =====================

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
  }

  const ranking = readDB('./database/ranking.json');
  const user = interaction.options.getUser('usuario');
  const amount = interaction.options.getInteger('quantidade');

  if (amount <= 0) {
    return interaction.reply({ content: 'Quantidade inválida.', ephemeral: true });
  }

  if (!ranking[user.id]) ranking[user.id] = { points: 0 };

  if (interaction.commandName === 'addpoints') {
    ranking[user.id].points += amount;
  }

  if (interaction.commandName === 'removepoints') {
    ranking[user.id].points -= amount;
    if (ranking[user.id].points < 0) ranking[user.id].points = 0;
  }

  writeDB('./database/ranking.json', ranking);

  await interaction.reply({ content: 'Ranking atualizado.', ephemeral: true });

  updateRanking(interaction.guild);
});


// ===================== ERRO GLOBAL =====================

process.on('unhandledRejection', error => {
  console.error('Erro não tratado:', error);
});

client.login(process.env.TOKEN);
