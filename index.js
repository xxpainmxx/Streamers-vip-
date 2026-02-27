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

// ================= DATABASE =================

function readDB(path) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, '{}');
  return JSON.parse(fs.readFileSync(path));
}

function writeDB(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ================= UPDATE RANKING =================

async function updateRanking(guild) {
  const ranking = readDB('./database/ranking.json');

  const rankingArray = Object.entries(ranking)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 10);

  const channel = guild.channels.cache.get(config.rankingChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🏆 Ranking Semanal - Streamers VIP')
    .setColor('Gold')
    .setDescription('Atualizado automaticamente');

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

  // ===== Atualizar Top 3 =====
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

// ================= RESET SEMANAL =================

cron.schedule('0 0 * * 1', () => {
  writeDB('./database/ranking.json', {});
  console.log('Ranking resetado automaticamente.');
});

// ================= REGISTRAR SLASH COMMANDS =================

const commands = [
  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Adicionar pontos a um usuário')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuário').setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantidade').setDescription('Quantidade').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removepoints')
    .setDescription('Remover pontos de um usuário')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuário').setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantidade').setDescription('Quantidade').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`Bot online como ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('Slash commands registrados.');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }
});

// ================= EVENTO PROVA =================

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.id !== config.proofChannelId) return;
  if (!message.attachments.size) return;

  const proofs = readDB('./database/proofs.json');

  proofs[message.id] = {
    userId: message.author.id,
    status: 'pending'
  };

  writeDB('./database/proofs.json', proofs);

  const embed = new EmbedBuilder()
    .setTitle('Nova prova enviada')
    .setDescription(`Usuário: <@${message.author.id}>`)
    .setColor('Blue');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${message.id}`)
      .setLabel('Aprovar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject_${message.id}`)
      .setLabel('Rejeitar')
      .setStyle(ButtonStyle.Danger)
  );

  const staffChannel = message.guild.channels.cache.get(config.staffChannelId);
  if (staffChannel) {
    staffChannel.send({ embeds: [embed], components: [row] });
  }
});

// ================= INTERACTIONS =================

client.on('interactionCreate', async interaction => {

  // BOTÕES
  if (interaction.isButton()) {

    const proofs = readDB('./database/proofs.json');
    const ranking = readDB('./database/ranking.json');

    const [action, msgId] = interaction.customId.split('_');
    const proof = proofs[msgId];

    if (!proof || proof.status !== 'pending') {
      return interaction.reply({ content: 'Prova já processada.', ephemeral: true });
    }

    if (action === 'approve') {
      proof.status = 'approved';

      if (!ranking[proof.userId]) ranking[proof.userId] = { points: 0 };
      ranking[proof.userId].points += 3;

      writeDB('./database/ranking.json', ranking);
      writeDB('./database/proofs.json', proofs);

      await interaction.reply({ content: 'Prova aprovada +3 pontos.', ephemeral: true });
      updateRanking(interaction.guild);
    }

    if (action === 'reject') {
      proof.status = 'rejected';
      writeDB('./database/proofs.json', proofs);

      await interaction.reply({ content: 'Prova rejeitada.', ephemeral: true });
    }
  }

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {

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
  }

});

client.login(process.env.TOKEN);
