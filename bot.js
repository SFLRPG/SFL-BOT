// SFL-BOT 升級版 - 自動監控版本
// 管理員指令 → 頻道ID: 1402338913258836108
// 一般指令 → 頻道ID: 1402341842023878697
// 自動監控 → 頻道ID: 1402338913258836108 (刪除記錄、離開記錄)

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// 建立 Discord 客戶端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// SQLite 資料庫設定
const db = new sqlite3.Database('./sfl_bot.db');

// 配置設定
const CONFIG = {
    XP_PER_MESSAGE: 15,
    XP_COOLDOWN: 60000,
    LEVEL_MULTIPLIER: 100,
    
    // 指定頻道ID
    ADMIN_CHANNEL_ID: '1402338913258836108',   // 管理員指令頻道 + 自動監控
    USER_CHANNEL_ID: '1402341842023878697',    // 一般使用者指令頻道
    LOG_CHANNEL_NAME: 'bot-日誌',              // 備用日誌頻道
    
    LEVEL_ROLES: {
        5: '活躍成員',
        10: '資深成員', 
        20: '核心成員',
        50: '傳奇成員'
    }
};

// 初始化資料庫
function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS user_levels (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            messages_count INTEGER DEFAULT 0,
            last_message_time INTEGER DEFAULT 0,
            join_date INTEGER,
            guild_id TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS deleted_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            user_id TEXT,
            username TEXT,
            channel_id TEXT,
            channel_name TEXT,
            content TEXT,
            deleted_at INTEGER,
            attachments TEXT,
            guild_id TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS member_leaves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            discriminator TEXT,
            join_date INTEGER,
            leave_date INTEGER,
            roles TEXT,
            guild_id TEXT,
            reason TEXT
        )`);
    });
    console.log('✅ 資料庫初始化完成');
}

// 工具函數
function getXPForLevel(level) {
    return level * CONFIG.LEVEL_MULTIPLIER;
}

function calculateLevel(xp) {
    return Math.floor(xp / CONFIG.LEVEL_MULTIPLIER) + 1;
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 取得管理員頻道（用於自動監控）
function getAdminChannel(guild) {
    return guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
}

// 取得日誌頻道（備用）
async function getLogChannel(guild) {
    if (CONFIG.LOG_CHANNEL_NAME) {
        return guild.channels.cache.find(ch => ch.name === CONFIG.LOG_CHANNEL_NAME && ch.type === ChannelType.GuildText);
    }
    return guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
}

// 取得指定頻道
function getTargetChannel(guild, isAdminCommand) {
    const channelId = isAdminCommand ? CONFIG.ADMIN_CHANNEL_ID : CONFIG.USER_CHANNEL_ID;
    return guild.channels.cache.get(channelId);
}

// 檢查是否為管理員指令
function isAdminCommand(commandName) {
    const adminCommands = ['刪除記錄', '離開記錄', '伺服器統計', '重置等級'];
    return adminCommands.includes(commandName);
}

// 機器人啟動
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 已成功啟動！`);
    console.log(`🔗 在 ${client.guilds.cache.size} 個伺服器中運行`);
    console.log(`📋 管理員指令頻道: ${CONFIG.ADMIN_CHANNEL_ID}`);
    console.log(`👤 一般使用者指令頻道: ${CONFIG.USER_CHANNEL_ID}`);
    console.log(`🔍 自動監控頻道: ${CONFIG.ADMIN_CHANNEL_ID}`);
    
    initDatabase();
    client.user.setActivity('自動監控伺服器活動', { type: 'WATCHING' });
    
    // 註冊斜線命令
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('等級')
                .setDescription('查看等級和經驗值')
                .addUserOption(option =>
                    option.setName('用戶')
                        .setDescription('查看指定用戶的等級')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('排行榜')
                .setDescription('查看等級排行榜')
                .addIntegerOption(option =>
                    option.setName('數量')
                        .setDescription('顯示前幾名 (1-20)')
                        .setMinValue(1)
                        .setMaxValue(20)
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('刪除記錄')
                .setDescription('查看最近的刪除訊息記錄（管理員限定）')
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
                .addIntegerOption(option =>
                    option.setName('數量')
                        .setDescription('顯示記錄數量 (1-10)')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('離開記錄')
                .setDescription('查看最近的成員離開記錄（管理員限定）')
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .addIntegerOption(option =>
                    option.setName('數量')
                        .setDescription('顯示記錄數量 (1-10)')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('伺服器統計')
                .setDescription('查看伺服器統計資料（管理員限定）')
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
            
            new SlashCommandBuilder()
                .setName('重置等級')
                .setDescription('重置指定用戶的等級（管理員限定）')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                .addUserOption(option =>
                    option.setName('用戶')
                        .setDescription('要重置等級的用戶')
                        .setRequired(true)
                )
        ];

        for (const command of commands) {
            await client.application.commands.create(command);
        }
        
        console.log('✅ 斜線命令註冊完成');
    } catch (error) {
        console.error('❌ 命令註冊失敗:', error);
    }
});

// 處理斜線命令
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // 確定目標頻道
    const targetChannel = getTargetChannel(interaction.guild, isAdminCommand(commandName));
    
    if (!targetChannel) {
        await interaction.reply({ 
            content: '❌ 找不到指定的指令頻道！請聯繫管理員。', 
            ephemeral: true 
        });
        return;
    }

    try {
        switch (commandName) {
            case '等級':
                await handleLevelCommand(interaction, targetChannel);
                break;
            case '排行榜':
                await handleLeaderboardCommand(interaction, targetChannel);
                break;
            case '刪除記錄':
                await handleDeletedLogsCommand(interaction, targetChannel);
                break;
            case '離開記錄':
                await handleLeaveLogs(interaction, targetChannel);
                break;
            case '伺服器統計':
                await handleServerStats(interaction, targetChannel);
                break;
            case '重置等級':
                await handleResetLevel(interaction, targetChannel);
                break;
        }
    } catch (error) {
        console.error(`命令執行錯誤 [${commandName}]:`, error);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ 執行命令時發生錯誤！', ephemeral: true });
        }
    }
});

// 等級命令處理（修改版）
async function handleLevelCommand(interaction, targetChannel) {
    const targetUser = interaction.options.getUser('用戶') || interaction.user;
    const guildId = interaction.guild.id;

    // 先回應用戶，表示正在處理
    await interaction.reply({ 
        content: '📊 正在查詢等級資訊...', 
        ephemeral: true 
    });

    db.get('SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?', 
        [targetUser.id, guildId], async (err, row) => {
        if (err) {
            await targetChannel.send('❌ 資料庫錯誤！');
            return;
        }

        if (!row) {
            await targetChannel.send(`${targetUser.username} 還沒有等級記錄！`);
            return;
        }

        const nextLevelXP = getXPForLevel(row.level + 1);
        const progress = row.xp - getXPForLevel(row.level);
        const needed = nextLevelXP - getXPForLevel(row.level);
        const percentage = Math.floor((progress / needed) * 100);

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`🎮 ${targetUser.username} 的等級資訊`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '📊 等級', value: `${row.level}`, inline: true },
                { name: '⭐ 經驗值', value: `${row.xp}`, inline: true },
                { name: '💬 訊息數', value: `${row.messages_count}`, inline: true },
                { name: '📈 升級進度', value: `${progress}/${needed} (${percentage}%)`, inline: false }
            )
            .setFooter({ text: `加入時間: ${formatDate(row.join_date)} | 查詢者: ${interaction.user.username}` })
            .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
    });
}

// 排行榜命令處理（修改版）
async function handleLeaderboardCommand(interaction, targetChannel) {
    const limit = interaction.options.getInteger('數量') || 10;
    const guildId = interaction.guild.id;

    await interaction.reply({ 
        content: '🏆 正在生成排行榜...', 
        ephemeral: true 
    });

    db.all(`SELECT * FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?`, 
        [guildId, limit], async (err, rows) => {
        if (err || !rows.length) {
            await targetChannel.send('❌ 無法取得排行榜資料！');
            return;
        }

        let description = '';
        for (let i = 0; i < rows.length; i++) {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[i] || `${i + 1}.`;
            description += `${medal} **${rows[i].username}** - 等級 ${rows[i].level} (${rows[i].xp} XP)\n`;
        }

        const embed = new EmbedBuilder()
            .setColor(0xf39c12)
            .setTitle('🏆 等級排行榜')
            .setDescription(description)
            .setFooter({ text: `顯示前 ${rows.length} 名 | 查詢者: ${interaction.user.username}` })
            .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
    });
}

// 刪除記錄命令處理（修改版）
async function handleDeletedLogsCommand(interaction, targetChannel) {
    const limit = interaction.options.getInteger('數量') || 5;
    const guildId = interaction.guild.id;

    await interaction.reply({ 
        content: '🗑️ 正在查詢刪除記錄...', 
        ephemeral: true 
    });

    db.all(`SELECT * FROM deleted_messages WHERE guild_id = ? ORDER BY deleted_at DESC LIMIT ?`, 
        [guildId, limit], async (err, rows) => {
        if (err || !rows.length) {
            await targetChannel.send('❌ 沒有找到刪除記錄！');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑️ 最近刪除的訊息')
            .setFooter({ text: `查詢者: ${interaction.user.username}` })
            .setTimestamp();

        rows.forEach((row, index) => {
            const content = row.content.length > 200 ? 
                row.content.substring(0, 200) + '...' : row.content;
            
            embed.addFields({
                name: `${index + 1}. ${row.username} - ${row.channel_name}`,
                value: `**內容:** ${content || '(無文字內容)'}\n**時間:** ${formatDate(row.deleted_at)}`,
                inline: false
            });
        });

        await targetChannel.send({ embeds: [embed] });
    });
}

// 離開記錄命令處理（修改版）
async function handleLeaveLogs(interaction, targetChannel) {
    const limit = interaction.options.getInteger('數量') || 5;
    const guildId = interaction.guild.id;

    await interaction.reply({ 
        content: '👋 正在查詢離開記錄...', 
        ephemeral: true 
    });

    db.all(`SELECT * FROM member_leaves WHERE guild_id = ? ORDER BY leave_date DESC LIMIT ?`, 
        [guildId, limit], async (err, rows) => {
        if (err || !rows.length) {
            await targetChannel.send('❌ 沒有找到離開記錄！');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle('👋 最近離開的成員')
            .setFooter({ text: `查詢者: ${interaction.user.username}` })
            .setTimestamp();

        rows.forEach((row, index) => {
            const joinDuration = row.join_date ? 
                `${Math.floor((row.leave_date - row.join_date) / (1000 * 60 * 60 * 24))} 天` : '未知';
            
            embed.addFields({
                name: `${index + 1}. ${row.username}#${row.discriminator}`,
                value: `**離開時間:** ${formatDate(row.leave_date)}\n**待了:** ${joinDuration}\n**身分組:** ${row.roles || '無'}`,
                inline: false
            });
        });

        await targetChannel.send({ embeds: [embed] });
    });
}

// 伺服器統計命令處理（修改版）
async function handleServerStats(interaction, targetChannel) {
    const guildId = interaction.guild.id;
    
    await interaction.reply({ 
        content: '📊 正在生成統計報告...', 
        ephemeral: true 
    });
    
    const promises = [
        new Promise(resolve => db.get('SELECT COUNT(*) as count FROM user_levels WHERE guild_id = ?', [guildId], (err, row) => resolve(row?.count || 0))),
        new Promise(resolve => db.get('SELECT COUNT(*) as count FROM deleted_messages WHERE guild_id = ?', [guildId], (err, row) => resolve(row?.count || 0))),
        new Promise(resolve => db.get('SELECT COUNT(*) as count FROM member_leaves WHERE guild_id = ?', [guildId], (err, row) => resolve(row?.count || 0))),
        new Promise(resolve => db.get('SELECT AVG(level) as avg FROM user_levels WHERE guild_id = ?', [guildId], (err, row) => resolve(Math.round(row?.avg || 0))))
    ];

    const [totalUsers, deletedMsgs, leftMembers, avgLevel] = await Promise.all(promises);

    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`📊 ${interaction.guild.name} 統計資料`)
        .setThumbnail(interaction.guild.iconURL())
        .addFields(
            { name: '👥 總成員數', value: `${interaction.guild.memberCount}`, inline: true },
            { name: '📈 活躍用戶', value: `${totalUsers}`, inline: true },
            { name: '📊 平均等級', value: `${avgLevel}`, inline: true },
            { name: '🗑️ 刪除訊息', value: `${deletedMsgs}`, inline: true },
            { name: '👋 離開成員', value: `${leftMembers}`, inline: true },
            { name: '📅 建立時間', value: formatDate(interaction.guild.createdTimestamp), inline: true }
        )
        .setFooter({ text: `查詢者: ${interaction.user.username}` })
        .setTimestamp();

    await targetChannel.send({ embeds: [embed] });
}

// 重置等級命令處理（修改版）
async function handleResetLevel(interaction, targetChannel) {
    const targetUser = interaction.options.getUser('用戶');
    const guildId = interaction.guild.id;

    await interaction.reply({ 
        content: '🔄 正在重置等級...', 
        ephemeral: true 
    });

    db.run('DELETE FROM user_levels WHERE user_id = ? AND guild_id = ?', 
        [targetUser.id, guildId], function(err) {
        if (err) {
            targetChannel.send('❌ 重置失敗！');
            return;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('🔄 等級重置')
            .setDescription(`✅ 已重置 **${targetUser.username}** 的等級資料！`)
            .setFooter({ text: `操作者: ${interaction.user.username}` })
            .setTimestamp();
        
        targetChannel.send({ embeds: [embed] });
    });
}

// 訊息處理 - 等級系統（升級通知發送到一般使用者頻道）
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    
    const userId = message.author.id;
    const username = message.author.username;
    const guildId = message.guild.id;
    const now = Date.now();

    db.get('SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?', 
        [userId, guildId], async (err, row) => {
        if (err) return;

        let shouldGiveXP = false;
        let newXP = 0;
        let oldLevel = 1;
        let newLevel = 1;

        if (row) {
            if (now - row.last_message_time >= CONFIG.XP_COOLDOWN) {
                shouldGiveXP = true;
                newXP = row.xp + CONFIG.XP_PER_MESSAGE;
                oldLevel = row.level;
                newLevel = calculateLevel(newXP);
            } else {
                newXP = row.xp;
                newLevel = row.level;
            }

            db.run(`UPDATE user_levels 
                   SET username = ?, xp = ?, level = ?, messages_count = messages_count + 1, 
                       last_message_time = ? 
                   WHERE user_id = ? AND guild_id = ?`, 
                   [username, newXP, newLevel, shouldGiveXP ? now : row.last_message_time, userId, guildId]);
        } else {
            shouldGiveXP = true;
            newXP = CONFIG.XP_PER_MESSAGE;
            newLevel = calculateLevel(newXP);

            db.run(`INSERT INTO user_levels 
                   (user_id, username, xp, level, messages_count, last_message_time, join_date, guild_id) 
                   VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, 
                   [userId, username, newXP, newLevel, now, now, guildId]);
        }

        // 升級通知發送到一般使用者頻道
        if (shouldGiveXP && newLevel > oldLevel) {
            const userChannel = message.guild.channels.cache.get(CONFIG.USER_CHANNEL_ID);
            
            if (userChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('🎉 等級提升！')
                    .setDescription(`🎊 恭喜 ${message.author} 升級到 **${newLevel} 級**！`)
                    .addFields(
                        { name: '💫 經驗值', value: `${newXP} XP`, inline: true },
                        { name: '📊 等級', value: `${newLevel}`, inline: true }
                    )
                    .setThumbnail(message.author.displayAvatarURL())
                    .setTimestamp();

                userChannel.send({ embeds: [embed] });

                // 檢查等級角色獎勵
                if (CONFIG.LEVEL_ROLES[newLevel]) {
                    const role = message.guild.roles.cache.find(r => r.name === CONFIG.LEVEL_ROLES[newLevel]);
                    if (role) {
                        try {
                            await message.member.roles.add(role);
                            userChannel.send(`🏆 ${message.author} 獲得了 **${role.name}** 身分組！`);
                        } catch (error) {
                            console.error('無法添加身分組:', error);
                        }
                    }
                }
            }
        }
    });
});

// 【修改】監控刪除的訊息 - 自動發送到管理員頻道
client.on('messageDelete', async message => {
    if (!message.author || message.author.bot || !message.guild) return;

    const attachments = message.attachments.size > 0 ? 
        Array.from(message.attachments.values()).map(att => att.url).join(', ') : '';

    // 儲存到資料庫
    db.run(`INSERT INTO deleted_messages 
           (message_id, user_id, username, channel_id, channel_name, content, deleted_at, attachments, guild_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [message.id, message.author.id, message.author.username, message.channel.id, 
         message.channel.name, message.content || '', Date.now(), attachments, message.guild.id]);

    // 【重點修改】自動發送到管理員頻道
    const adminChannel = getAdminChannel(message.guild);
    if (adminChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑️ 即時監控：訊息被刪除')
            .addFields(
                { name: '👤 用戶', value: `${message.author.username}`, inline: true },
                { name: '📍 頻道', value: `${message.channel.name}`, inline: true },
                { name: '⏰ 時間', value: formatDate(Date.now()), inline: true },
                { name: '💬 內容', value: message.content || '(無文字內容)', inline: false }
            )
            .setFooter({ text: `訊息ID: ${message.id} | 自動監控` })
            .setTimestamp();

        if (attachments) {
            embed.addFields({ name: '📎 附件', value: attachments, inline: false });
        }

        try {
            await adminChannel.send({ embeds: [embed] });
            console.log(`✅ 刪除記錄已自動發送到管理員頻道: ${message.author.username}`);
        } catch (error) {
            console.error('❌ 發送刪除記錄失敗:', error);
        }
    } else {
        console.warn('⚠️ 找不到管理員頻道，無法發送刪除記錄');
    }
});

// 【修改】監控成員離開 - 自動發送到管理員頻道  
client.on('guildMemberRemove', async member => {
    const roles = member.roles.cache.map(role => role.name).join(', ');
    
    // 儲存到資料庫
    db.run(`INSERT INTO member_leaves 
           (user_id, username, discriminator, join_date, leave_date, roles, guild_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [member.id, member.user.username, member.user.discriminator, 
         member.joinedTimestamp, Date.now(), roles, member.guild.id]);

    // 【重點修改】自動發送到管理員頻道
    const adminChannel = getAdminChannel(member.guild);
    if (adminChannel) {
        const joinDuration = member.joinedTimestamp ? 
            `${Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24))} 天` : '未知';

        const embed = new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle('👋 即時監控：成員離開')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '👤 用戶', value: `${member.user.username}#${member.user.discriminator}`, inline: true },
                { name: '🆔 ID', value: member.id, inline: true },
                { name: '📅 待了', value: joinDuration, inline: true },
                { name: '🏷️ 身分組', value: roles || '無', inline: false }
            )
            .setFooter({ text: `離開時間: ${formatDate(Date.now())} | 自動監控` })
            .setTimestamp();

        try {
            await adminChannel.send({ embeds: [embed] });
            console.log(`✅ 離開記錄已自動發送到管理員頻道: ${member.user.username}`);
        } catch (error) {
            console.error('❌ 發送離開記錄失敗:', error);
        }
    } else {
        console.warn('⚠️ 找不到管理員頻道，無法發送離開記錄');
    }
});

// 歡迎新成員（發送到管理員頻道）
client.on('guildMemberAdd', async member => {
    // 儲存到資料庫
    db.run(`INSERT OR REPLACE INTO user_levels 
           (user_id, username, xp, level, messages_count, last_message_time, join_date, guild_id) 
           VALUES (?, ?, 0, 1, 0, 0, ?, ?)`,
        [member.id, member.user.username, Date.now(), member.guild.id]);

    // 發送到管理員頻道
    const adminChannel = getAdminChannel(member.guild);
    if (adminChannel) {
        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🎉 即時監控：新成員加入')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '👤 用戶', value: `${member.user.username}#${member.user.discriminator}`, inline: true },
                { name: '🆔 ID', value: member.id, inline: true },
                { name: '📊 成員總數', value: `${member.guild.memberCount}`, inline: true }
            )
            .setFooter({ text: `加入時間: ${formatDate(Date.now())} | 自動監控` })
            .setTimestamp();

        try {
            await adminChannel.send({ embeds: [embed] });
            console.log(`✅ 加入記錄已自動發送到管理員頻道: ${member.user.username}`);
        } catch (error) {
            console.error('❌ 發送加入記錄失敗:', error);
        }
    }
});

// 錯誤處理
process.on('unhandledRejection', error => {
    console.error('未處理的 Promise 錯誤:', error);
});

client.on('error', error => {
    console.error('Discord 客戶端錯誤:', error);
});

// 啟動機器人
client.login(process.env.DISCORD_TOKEN);

console.log('🚀 SFL-BOT 自動監控版正在啟動...');
