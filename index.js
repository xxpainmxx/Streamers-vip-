require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= DATABASE UTILS =================

function readDB(path) {
  return JSON.parse(fs.readFileSync(path));
}

function writeDB(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ================= RANKING UPDATE =================

async function updateRanking(guild) {
  const ranking = readDB('./database/ranking.json');
  const rankingArray = Object.entries(ranking)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 10);

  const channel = guild.channels.cache.get(config.rankingChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🏆 Ranking Semanal')
    .setColor('Gold');

  rankingArray.forEach((user, index) => {
    embed.addFields({
      name: `#${index + 1}`,
      value: `<@${user[0]}> — ${user[1].points} pontos`
    });
  });

  await channel.messages.fetch().then(msgs => channel.bulkDelete(msgs));
  await channel.send({ embeds: [embed] });

  // Atualizar cargos Top 3
  const members = await guild.members.fetch();
  for (let pos = 1; pos <= 3; pos++) {
    const roleId = config.topRoles[pos];
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    members.forEach(member => {
      if (member.roles.cache.has(roleId)) {
        member.roles.remove(roleId);
      }
    });

    if (rankingArray[pos - 1]) {
      const member = guild.members.cache.get(rankingArray[pos - 1][0]);
      if (member) member.roles.add(roleId);
    }
  }
}

// ================= RESET SEMANAL =================

cron.schedule('0 0 * * 1', () => {
  writeDB('./database/ranking.json', {});
  console.log('Ranking resetado.');
});

// ================= EVENTOS =================

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('messageCreate', async message => {
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
    .setDescription(`Usuário: <@${message.author.id}>`);

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
  staffChannel.send({ embeds: [embed], components: [row] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const proofs = readDB('./database/proofs.json');
  const ranking = readDB('./database/ranking.json');

  const [action, msgId] = interaction.customId.split('_');
  const proof = proofs[msgId];
  if (!proof || proof.status !== 'pending') return;

  if (action === 'approve') {
    proof.status = 'approved';
    if (!ranking[proof.userId]) {
      ranking[proof.userId] = { points: 0 };
    }
    ranking[proof.userId].points += 3;

    writeDB('./database/ranking.json', ranking);
    writeDB('./database/proofs.json', proofs);

    await interaction.reply({ content: 'Prova aprovada.', ephemeral: true });
    updateRanking(interaction.guild);
  }

  if (action === 'reject') {
    proof.status = 'rejected';
    writeDB('./database/proofs.json', proofs);
    await interaction.reply({ content: 'Prova rejeitada.', ephemeral: true });
  }
});

client.login(process.env.TOKEN);