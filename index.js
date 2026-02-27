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

// ===== Banco simples JSON =====
let db = {};
if (fs.existsSync('database.json')) {
  db = JSON.parse(fs.readFileSync('database.json'));
}

function saveDB() {
  fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
}

// ===== Registrar Slash Commands =====
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

// ===== Atualizar Ranking e Cargos =====
async function updateRanking(guild) {
  const rankingArray = Object.entries(db)
    .sort((a, b) => b[1] - a[1]);

  const rankingChannel = guild.channels.cache.get(config.rankingChannelId);
  if (rankingChannel) {
    let message = `🏆 **Ranking Streamers VIP**\n\n`;
    rankingArray.slice(0, 10).forEach((user, index) => {
      message += `**${index + 1}º** <@${user[0]}> — ${user[1]} pts\n`;
    });
    rankingChannel.send(message);
  }

  // Atualizar Top 3
  for (let pos = 1; pos <= 3; pos++) {
    const roleId = config.topRoles[pos];
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    // Remove cargo de quem tem
    role.members.forEach(member => {
      member.roles.remove(roleId).catch(() => {});
    });

    // Dá para novo top
    if (rankingArray[pos - 1]) {
      const member = await guild.members.fetch(rankingArray[pos - 1][0]).catch(() => null);
      if (member) {
        member.roles.add(roleId).catch(() => {});
      }
    }
  }
}

// ===== Interações =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'addpoints') {
    const user = interaction.options.getUser('usuario');
    const amount = interaction.options.getInteger('quantidade');

    if (!db[user.id]) db[user.id] = 0;
    db[user.id] += amount;
    saveDB();

    await interaction.reply(`✅ ${amount} pontos adicionados para ${user.username}`);

    await updateRanking(interaction.guild);
  }

  if (commandName === 'ranking') {
    const rankingArray = Object.entries(db)
      .sort((a, b) => b[1] - a[1]);

    let message = `🏆 **Ranking Atual**\n\n`;
    rankingArray.slice(0, 10).forEach((user, index) => {
      message += `**${index + 1}º** <@${user[0]}> — ${user[1]} pts\n`;
    });

    await interaction.reply(message);
  }

  if (commandName === 'resetranking') {
    db = {};
    saveDB();
    await interaction.reply('♻️ Ranking resetado com sucesso!');
  }
});

// ===== Reset Automático Semanal =====
setInterval(() => {
  db = {};
  saveDB();
  console.log('♻️ Reset semanal automático executado');
}, 1000 * 60 * 60 * 24 * 7);

client.once('ready', () => {
  console.log(`🚀 Bot online como ${client.user.tag}`);
});

client.login(token);
