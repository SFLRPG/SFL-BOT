// raffle-system.js - 獨立的抽獎系統模塊
// 使用方法：在 bot.js 中引入 const RaffleSystem = require('./raffle-system');

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const MAX_TIMEOUT = 2147483647;

class RaffleSystem {
    constructor(config = {}) {
        this.adminChannelId = config.adminChannelId;
        this.firestore = config.firestore || null;
        this.db = config.db;
        this.client = null;
        this.timers = new Map();
        this.commands = this.createCommands();
        this.initDatabase();
    }

    initDatabase() {
        this.db.run(`CREATE TABLE IF NOT EXISTS raffles (
            message_id TEXT PRIMARY KEY,
            channel_id TEXT,
            guild_id TEXT,
            prize TEXT,
            quantity INTEGER,
            winner_count INTEGER,
            emoji TEXT,
            end_time INTEGER,
            host_id TEXT,
            ended INTEGER DEFAULT 0
        )`);
    }

    createCommands() {
        const raffleCommand = new SlashCommandBuilder()
            .setName('raffle')
            .setDescription('[管理員] 開始一場抽獎')
            .addStringOption(o => o.setName('抽獎內容').setDescription('獎勵道具名稱').setRequired(true))
            .addIntegerOption(o => o.setName('道具數量').setDescription('每位中獎者獲得的數量').setRequired(true).setMinValue(1))
            .addStringOption(o => o.setName('抽獎時長').setDescription('例如 30m、3h、2d').setRequired(true))
            .addIntegerOption(o => o.setName('抽取人數').setDescription('中獎人數').setRequired(true).setMinValue(1))
            .addStringOption(o => o.setName('表情符號').setDescription('參加用的表情符號（預設 🎉）').setRequired(false));
        return [raffleCommand];
    }

    getCommands() {
        return this.commands;
    }

    init(client) {
        this.client = client;
        this.resumePending();
    }

    formatEndTime(ts) {
        return new Date(ts).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    // 支援 m(分) / h(時) / d(天)，回傳毫秒；格式錯誤回傳 null
    parseDuration(str) {
        const m = String(str).trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
        if (!m) return null;
        const value = parseInt(m[1], 10);
        if (value <= 0) return null;
        const unit = { m: 60000, h: 3600000, d: 86400000 }[m[2]];
        return value * unit;
    }

    // setTimeout 上限約 24.8 天，超過時分段重排
    scheduleEnd(messageId, delay) {
        if (delay > MAX_TIMEOUT) {
            const t = setTimeout(() => this.scheduleEnd(messageId, delay - MAX_TIMEOUT), MAX_TIMEOUT);
            this.timers.set(messageId, t);
        } else {
            const t = setTimeout(() => this.endRaffle(messageId), Math.max(delay, 0));
            this.timers.set(messageId, t);
        }
    }

    resumePending() {
        this.db.all(`SELECT message_id, end_time FROM raffles WHERE ended = 0`, [], (err, rows) => {
            if (err || !rows) return;
            for (const row of rows) {
                this.scheduleEnd(row.message_id, row.end_time - Date.now());
            }
            if (rows.length) console.log(`🎁 已恢復 ${rows.length} 場進行中的抽獎`);
        });
    }

    async fetchAllReactors(reaction) {
        const users = [];
        let after;
        while (true) {
            const batch = await reaction.users.fetch({ limit: 100, after });
            if (batch.size === 0) break;
            users.push(...batch.values());
            after = batch.last().id;
            if (batch.size < 100) break;
        }
        return users.filter(u => !u.bot);
    }

    pickWinners(users, count) {
        const pool = [...users];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count);
    }

    // discordLink.userId 即遊戲帳號信箱；未綁定回傳 null
    async lookupGameEmail(discordId) {
        if (!this.firestore) return null;
        try {
            const snap = await this.firestore.collection('discordLink').where('discordId', '==', discordId).get();
            if (snap.empty) return null;
            return snap.docs[0].data().userId || null;
        } catch (error) {
            console.error('查詢遊戲信箱失敗:', error);
            return null;
        }
    }

    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand() || interaction.commandName !== 'raffle') return false;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: '❌ 你沒有權限使用此指令！', ephemeral: true });
            return true;
        }

        const prize = interaction.options.getString('抽獎內容');
        const quantity = interaction.options.getInteger('道具數量');
        const durationStr = interaction.options.getString('抽獎時長');
        const winnerCount = interaction.options.getInteger('抽取人數');
        const emoji = (interaction.options.getString('表情符號') || '🎉').trim();

        const durationMs = this.parseDuration(durationStr);
        if (!durationMs) {
            await interaction.reply({ content: '❌ 時長格式錯誤，請使用例如 `30m`、`3h`、`2d`。', ephemeral: true });
            return true;
        }

        const endTime = Date.now() + durationMs;
        const hostName = interaction.member?.displayName || interaction.user.username;

        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`[抽獎] ${prize} x ${quantity}`)
            .setDescription(`**中獎名額：** ${winnerCount} 人\n\n按下 ${emoji} 即可參加！\n\n⚠️ 參加抽獎前，請務必先前往 <#1404808567885795358> 連結 Discord 帳號才可進行抽獎。未連結中獎將視為棄權。`)
            .addFields({ name: '⏰ 結束時間', value: this.formatEndTime(endTime), inline: false })
            .setFooter({ text: `主辦：${hostName}` })
            .setTimestamp();

        await interaction.reply({ content: '✅ 抽獎已開始！', ephemeral: true });

        const notifyRole = interaction.guild.roles.cache.find(r => r.name === '抽獎通知');
        const sendOptions = { embeds: [embed] };
        if (notifyRole) {
            sendOptions.content = `<@&${notifyRole.id}>`;
            sendOptions.allowedMentions = { roles: [notifyRole.id] };
        }
        const message = await interaction.channel.send(sendOptions);

        try {
            await message.react(emoji);
        } catch (error) {
            await interaction.followUp({ content: `⚠️ 無法自動加上 ${emoji}，請玩家手動按反應。`, ephemeral: true });
        }

        this.db.run(
            `INSERT INTO raffles (message_id, channel_id, guild_id, prize, quantity, winner_count, emoji, end_time, host_id, ended) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [message.id, interaction.channel.id, interaction.guild.id, prize, quantity, winnerCount, emoji, endTime, interaction.user.id]
        );
        this.scheduleEnd(message.id, durationMs);
        return true;
    }

    async endRaffle(messageId) {
        this.timers.delete(messageId);
        this.db.get(`SELECT * FROM raffles WHERE message_id = ? AND ended = 0`, [messageId], async (err, row) => {
            if (err || !row) return;
            this.db.run(`UPDATE raffles SET ended = 1 WHERE message_id = ?`, [messageId]);

            try {
                const channel = await this.client.channels.fetch(row.channel_id);
                const message = await channel.messages.fetch(row.message_id);
                const reaction = message.reactions.cache.find(r => r.emoji.toString() === row.emoji || r.emoji.name === row.emoji);

                let reactors = [];
                if (reaction) reactors = await this.fetchAllReactors(reaction);
                const winners = this.pickWinners(reactors, row.winner_count);

                if (winners.length === 0) {
                    const emptyEmbed = new EmbedBuilder()
                        .setColor(0x95a5a6)
                        .setTitle(`[結果公布] ${row.prize} x ${row.quantity}`)
                        .setDescription('本次抽獎沒有人參加，未產生中獎者。')
                        .setTimestamp();
                    await channel.send({ embeds: [emptyEmbed] });
                    await this.sendAdminResult(row, []);
                    return;
                }

                const winnerInfos = await Promise.all(winners.map(async user => ({
                    user,
                    email: await this.lookupGameEmail(user.id)
                })));

                const mentions = winners.map(u => `<@${u.id}>`).join(' ');
                const winnerLines = winnerInfos
                    .map(w => w.email ? `<@${w.user.id}>` : `<@${w.user.id}> (棄權/未連結帳號)`)
                    .join('\n');
                const publicEmbed = new EmbedBuilder()
                    .setColor(0xf1c40f)
                    .setTitle(`[結果公布] ${row.prize} x ${row.quantity}`)
                    .setDescription(`**🏆 中獎者：**\n${winnerLines}\n\n📬 **中獎獎勵將在一週內透過信箱發送**\n獎品將在發信後一週內過期，未領取將視為放棄`)
                    .setTimestamp();
                await channel.send({ content: mentions, embeds: [publicEmbed] });

                await this.sendAdminResult(row, winnerInfos);
            } catch (error) {
                console.error('結束抽獎失敗:', error);
            }
        });
    }

    async sendAdminResult(row, winnerInfos) {
        try {
            const adminChannel = await this.client.channels.fetch(this.adminChannelId);
            const list = winnerInfos.length
                ? winnerInfos.map((w, i) => `${i + 1}. <@${w.user.id}>（${w.user.username}）\n　信箱：${w.email || '(未綁定)'}`).join('\n')
                : '（本次無人參加）';

            const adminEmbed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('🎁 抽獎中獎名單（管理員）')
                .setDescription(`**獎勵：** ${row.prize} ×${row.quantity}\n**中獎人數：** ${winnerInfos.length}\n\n${list}`)
                .setTimestamp();
            await adminChannel.send({ embeds: [adminEmbed] });
        } catch (error) {
            console.error('發送抽獎管理員名單失敗:', error);
        }
    }
}

module.exports = RaffleSystem;
