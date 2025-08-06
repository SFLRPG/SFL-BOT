// SFL-BOT 升級版 - 自動監控版本 + Discord 連結功能
// 管理員指令 → 頻道ID: 1402338913258836108
// 一般指令 → 頻道ID: 1402341842023878697
// 自動監控 → 頻道ID: 1402338913258836108 (刪除記錄、離開記錄)

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// 🔥 Firebase Admin SDK 初始化
const admin = require('firebase-admin');

// 從環境變數讀取服務帳號
let firestore = null;
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    
    if (serviceAccount.project_id) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });
        
        firestore = admin.firestore();
        console.log('✅ Firebase Admin SDK 初始化成功！');
    } else {
        console.log('⚠️ Firebase 服務帳號未設置，連結功能將無法使用');
    }
} catch (error) {
    console.error('❌ Firebase 初始化失敗:', error.message);
    console.log('⚠️ Discord 連結功能將無法使用');
}

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
            guild_id TEXT
        )`);
        
        // 🔥 新增 Discord 連結資料表
        db.run(`CREATE TABLE IF NOT EXISTS discord_links (
            discord_id TEXT PRIMARY KEY,
            discord_username TEXT,
            game_user_id TEXT,
            linked_at INTEGER,
            guild_id TEXT
        )`);
    });
}

// 輔助函數
function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function getXPForLevel(level) {
    return level * level * CONFIG.LEVEL_MULTIPLIER;
}

// 【修改版】獲取管理員頻道
function getAdminChannel(guild) {
    // 優先使用指定的頻道ID
    let channel = guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
    
    // 備用：尋找日誌頻道
    if (!channel) {
        channel = guild.channels.cache.find(ch => 
            ch.name === CONFIG.LOG_CHANNEL_NAME && ch.type === ChannelType.GuildText
        );
    }
    
    return channel;
}

// 【修改版】獲取使用者頻道
function getUserChannel(guild) {
    return guild.channels.cache.get(CONFIG.USER_CHANNEL_ID);
}

// 建立斜線指令
const commands = [];

// 管理員指令
const levelCommand = new SlashCommandBuilder()
    .setName('level')
    .setDescription('[管理員] 查看等級資訊')
    .addUserOption(option =>
        option.setName('使用者')
            .setDescription('要查看的使用者')
            .setRequired(false)
    );

const leaderboardCommand = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('[管理員] 查看等級排行榜')
    .addIntegerOption(option =>
        option.setName('數量')
            .setDescription('顯示前幾名')
            .setRequired(false)
    );

const deletedLogsCommand = new SlashCommandBuilder()
    .setName('deleted')
    .setDescription('[管理員] 查看刪除記錄')
    .addIntegerOption(option =>
        option.setName('數量')
            .setDescription('顯示筆數')
            .setRequired(false)
    );

const memberLeavesCommand = new SlashCommandBuilder()
    .setName('leaves')
    .setDescription('[管理員] 查看成員離開記錄')
    .addIntegerOption(option =>
        option.setName('數量')
            .setDescription('顯示筆數')
            .setRequired(false)
    );

// 一般使用者指令
const myLevelCommand = new SlashCommandBuilder()
    .setName('mylevel')
    .setDescription('查看自己的等級資訊');

const topCommand = new SlashCommandBuilder()
    .setName('top')
    .setDescription('查看等級排行榜前10名');

// 🔥 新增連結指令
const linkCommand = new SlashCommandBuilder()
    .setName('link')
    .setDescription('連結您的遊戲帳號')
    .addStringOption(option =>
        option.setName('代碼')
            .setDescription('從網頁獲得的連結代碼 (格式: XXXX-XXXX-XXXX-XXXX)')
            .setRequired(true)
    );

const checkLinkCommand = new SlashCommandBuilder()
    .setName('checklink')
    .setDescription('檢查您的帳號連結狀態');

// 將所有指令加入陣列
commands.push(
    levelCommand, leaderboardCommand, deletedLogsCommand, memberLeavesCommand,
    myLevelCommand, topCommand,
    linkCommand, checkLinkCommand  // 新增的連結指令
);

// Bot 準備完成
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 已上線！`);
    initDatabase();
    
    // 註冊斜線指令
    try {
        await client.application.commands.set(commands);
        console.log('✅ 斜線指令已註冊');
    } catch (error) {
        console.error('❌ 註冊斜線指令失敗:', error);
    }
    
    // 設定狀態
    client.user.setActivity('監控伺服器', { type: 'WATCHING' });
});

// 訊息創建事件（經驗值系統）
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    
    const userId = message.author.id;
    const username = message.author.username;
    const guildId = message.guild.id;
    const now = Date.now();
    
    db.get(`SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?`, 
        [userId, guildId], (err, row) => {
        if (err) return console.error(err);
        
        if (!row) {
            db.run(`INSERT INTO user_levels 
                   (user_id, username, xp, level, messages_count, last_message_time, join_date, guild_id) 
                   VALUES (?, ?, ?, 1, 1, ?, ?, ?)`,
                [userId, username, CONFIG.XP_PER_MESSAGE, now, now, guildId]);
        } else {
            if (now - row.last_message_time < CONFIG.XP_COOLDOWN) return;
            
            const newXP = row.xp + CONFIG.XP_PER_MESSAGE;
            const currentLevel = row.level;
            let newLevel = currentLevel;
            
            while (newXP >= getXPForLevel(newLevel + 1)) {
                newLevel++;
            }
            
            db.run(`UPDATE user_levels 
                   SET xp = ?, level = ?, messages_count = ?, last_message_time = ?, username = ?
                   WHERE user_id = ? AND guild_id = ?`,
                [newXP, newLevel, row.messages_count + 1, now, username, userId, guildId]);
            
            if (newLevel > currentLevel) {
                const embed = new EmbedBuilder()
                    .setColor(0xffd700)
                    .setTitle('🎉 升級！')
                    .setDescription(`恭喜 <@${userId}> 升到了 **${newLevel}** 級！`)
                    .setTimestamp();
                
                message.channel.send({ embeds: [embed] });
                
                // 自動給予身分組
                const roleName = CONFIG.LEVEL_ROLES[newLevel];
                if (roleName) {
                    const role = message.guild.roles.cache.find(r => r.name === roleName);
                    if (role && message.member) {
                        message.member.roles.add(role).catch(console.error);
                    }
                }
            }
        }
    });
});

// 訊息刪除事件
client.on('messageDelete', async message => {
    if (!message.guild || message.author?.bot) return;
    
    const attachments = message.attachments.size > 0 
        ? message.attachments.map(a => a.url).join(', ') 
        : null;
    
    db.run(`INSERT INTO deleted_messages 
           (message_id, user_id, username, channel_id, channel_name, content, deleted_at, attachments, guild_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [message.id, message.author?.id, message.author?.username, 
         message.channel.id, message.channel.name, message.content,
         Date.now(), attachments, message.guild.id]);
    
    // 【重點修改】自動發送到管理員頻道
    const adminChannel = getAdminChannel(message.guild);
    if (adminChannel && message.content) {
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑️ 即時監控：訊息刪除')
            .setDescription(`**內容:** ${message.content.substring(0, 1024)}`)
            .addFields(
                { name: '👤 用戶', value: `${message.author?.username || '未知'}`, inline: true },
                { name: '📍 頻道', value: `<#${message.channel.id}>`, inline: true },
                { name: '🕒 時間', value: formatDate(Date.now()), inline: true }
            );
        
        if (attachments) {
            embed.addFields({ name: '📎 附件', value: attachments.substring(0, 1024), inline: false });
        }
        
        try {
            await adminChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('發送刪除記錄失敗:', error);
        }
    }
});

// 🔥 連結指令處理函數
async function handleLinkCommand(interaction) {
    if (!firestore) {
        await interaction.reply({
            content: '❌ 連結功能暫時無法使用，請聯繫管理員。',
            ephemeral: true
        });
        return;
    }

    const token = interaction.options.getString('代碼');
    const discordId = interaction.user.id;
    const discordUsername = interaction.user.username;
    const guildId = interaction.guild.id;
    
    try {
        await interaction.deferReply({ ephemeral: true });
        
        // 檢查 Discord 帳號是否已連結
        const existingLink = await firestore.collection('discordLink')
            .where('discordId', '==', discordId)
            .get();
        
        if (!existingLink.empty) {
            const embed = new EmbedBuilder()
                .setColor(0xf39c12)
                .setTitle('⚠️ 帳號已連結')
                .setDescription('您的 Discord 帳號已經連結過遊戲帳號了！')
                .setFooter({ text: '如需解除連結，請聯繫管理員' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        
        // 查找 token
        const tokenQuery = await firestore.collection('discordTokens')
            .where('token', '==', token)
            .where('used', '==', false)
            .get();
        
        if (tokenQuery.empty) {
            const embed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('❌ 無效的連結代碼')
                .setDescription('找不到該連結代碼，或代碼已被使用。')
                .addFields(
                    { name: '💡 提示', value: '請確認代碼格式為: XXXX-XXXX-XXXX-XXXX', inline: false }
                )
                .setFooter({ text: '請從遊戲網頁重新獲取代碼' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        
        // 獲取 token 資料
        const tokenDoc = tokenQuery.docs[0];
        const tokenData = tokenDoc.data();
        const userId = tokenData.userId;
        
        // 使用事務處理
        await firestore.runTransaction(async (transaction) => {
            // 標記 token 為已使用
            transaction.update(tokenDoc.ref, {
                used: true,
                usedAt: admin.firestore.FieldValue.serverTimestamp(),
                usedBy: discordId
            });
            
            // 建立連結記錄
            const linkRef = firestore.collection('discordLink').doc();
            transaction.set(linkRef, {
                userId: userId,
                discordId: discordId,
                discordUsername: discordUsername,
                linkedAt: admin.firestore.FieldValue.serverTimestamp(),
                guildId: guildId
            });
            
            // 發放獎勵 - 添加到郵件收件人
            const mailRef = firestore.collection('mails').doc('8NQ8k5f9mBZ3CG9rs6yX');
            transaction.update(mailRef, {
                recipients: admin.firestore.FieldValue.arrayUnion(userId)
            });
        });
        
        // 儲存到本地 SQLite
        db.run(`INSERT OR REPLACE INTO discord_links 
                (discord_id, discord_username, game_user_id, linked_at, guild_id) 
                VALUES (?, ?, ?, ?, ?)`,
            [discordId, discordUsername, userId, Date.now(), guildId]);
        
        // 成功訊息
        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('✅ 連結成功！')
            .setDescription('恭喜！您的 Discord 帳號已成功連結到遊戲帳號。')
            .addFields(
                { name: '🎁 連結獎勵', value: '已發送至您的遊戲信箱！', inline: true },
                { name: '👤 Discord', value: `${discordUsername}`, inline: true }
            )
            .setFooter({ text: '請到遊戲中查看您的獎勵信件' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        
        // 記錄到管理員頻道
        const adminChannel = getAdminChannel(interaction.guild);
        if (adminChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🔗 帳號連結記錄')
                .addFields(
                    { name: '👤 Discord', value: `<@${discordId}>`, inline: true },
                    { name: '🎮 遊戲 ID', value: userId.substring(0, 8) + '...', inline: true }
                )
                .setTimestamp();
            
            await adminChannel.send({ embeds: [logEmbed] });
        }
        
    } catch (error) {
        console.error('連結失敗:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ 連結失敗')
            .setDescription('處理連結時發生錯誤，請稍後再試。')
            .setFooter({ text: '錯誤代碼: ' + (error.code || 'UNKNOWN') })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    }
}

// 🔥 檢查連結狀態指令
async function handleCheckLinkCommand(interaction) {
    if (!firestore) {
        await interaction.reply({
            content: '❌ 連結功能暫時無法使用，請聯繫管理員。',
            ephemeral: true
        });
        return;
    }

    const discordId = interaction.user.id;
    
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const linkQuery = await firestore.collection('discordLink')
            .where('discordId', '==', discordId)
            .get();
        
        if (linkQuery.empty) {
            const embed = new EmbedBuilder()
                .setColor(0x95a5a6)
                .setTitle('🔍 連結狀態')
                .setDescription('您的 Discord 帳號尚未連結遊戲帳號。')
                .addFields(
                    { name: '📝 如何連結？', value: '1. 登入遊戲網頁\n2. 前往帳號連結頁面\n3. 獲取連結代碼\n4. 使用 `/link 代碼` 指令' }
                )
                .setFooter({ text: '完成連結可獲得獎勵！' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        } else {
            const linkData = linkQuery.docs[0].data();
            
            const embed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('✅ 已連結')
                .setDescription('您的 Discord 帳號已成功連結到遊戲帳號。')
                .addFields(
                    { name: '🎮 遊戲 ID', value: linkData.userId.substring(0, 8) + '...', inline: true },
                    { name: '👤 Discord', value: interaction.user.username, inline: true }
                )
                .setFooter({ text: '享受遊戲！' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
    } catch (error) {
        console.error('查詢失敗:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ 查詢失敗')
            .setDescription('無法查詢連結狀態，請稍後再試。')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    }
}

// 等級命令處理（修改版）
async function handleLevelCommand(interaction, targetChannel) {
    const targetUser = interaction.options.getUser('使用者') || interaction.user;
    const guildId = interaction.guild.id;
    
    await interaction.reply({ 
        content: `📊 查詢 ${targetUser.username} 的等級資訊...`, 
        ephemeral: true 
    });

    db.get(`SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?`, 
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
            await targetChannel.send('❌ 沒有刪除記錄！');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑️ 最近的訊息刪除記錄')
            .setFooter({ text: `顯示最近 ${rows.length} 筆記錄 | 查詢者: ${interaction.user.username}` })
            .setTimestamp();

        for (const row of rows) {
            const content = row.content || '(無內容)';
            const truncated = content.length > 200 ? content.substring(0, 197) + '...' : content;
            
            embed.addFields({
                name: `👤 ${row.username || '未知用戶'} | 📍 #${row.channel_name}`,
                value: `**內容:** ${truncated}\n**時間:** ${formatDate(row.deleted_at)}${row.attachments ? '\n**附件:** ' + row.attachments : ''}`,
                inline: false
            });
        }

        await targetChannel.send({ embeds: [embed] });
    });
}

// 離開記錄命令處理（修改版）
async function handleMemberLeavesCommand(interaction, targetChannel) {
    const limit = interaction.options.getInteger('數量') || 5;
    const guildId = interaction.guild.id;

    await interaction.reply({ 
        content: '👋 正在查詢離開記錄...', 
        ephemeral: true 
    });

    db.all(`SELECT * FROM member_leaves WHERE guild_id = ? ORDER BY leave_date DESC LIMIT ?`, 
        [guildId, limit], async (err, rows) => {
        if (err || !rows.length) {
            await targetChannel.send('❌ 沒有成員離開記錄！');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle('👋 最近的成員離開記錄')
            .setFooter({ text: `顯示最近 ${rows.length} 筆記錄 | 查詢者: ${interaction.user.username}` })
            .setTimestamp();

        for (const row of rows) {
            const duration = row.join_date ? 
                `${Math.floor((row.leave_date - row.join_date) / (1000 * 60 * 60 * 24))} 天` : 
                '未知';
            
            embed.addFields({
                name: `👤 ${row.username}#${row.discriminator}`,
                value: `**ID:** ${row.user_id}\n**加入:** ${formatDate(row.join_date)}\n**離開:** ${formatDate(row.leave_date)}\n**待了:** ${duration}\n**身分組:** ${row.roles || '無'}`,
                inline: false
            });
        }

        await targetChannel.send({ embeds: [embed] });
    });
}

// 斜線指令處理
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    // 管理員指令 - 發送到管理員頻道
    if (['level', 'leaderboard', 'deleted', 'leaves'].includes(commandName)) {
        if (!isAdmin) {
            await interaction.reply({ 
                content: '❌ 你沒有權限使用此指令！', 
                ephemeral: true 
            });
            return;
        }
        
        const adminChannel = getAdminChannel(interaction.guild);
        if (!adminChannel) {
            await interaction.reply({ 
                content: '❌ 找不到管理員頻道！', 
                ephemeral: true 
            });
            return;
        }
        
        switch (commandName) {
            case 'level':
                await handleLevelCommand(interaction, adminChannel);
                break;
            case 'leaderboard':
                await handleLeaderboardCommand(interaction, adminChannel);
                break;
            case 'deleted':
                await handleDeletedLogsCommand(interaction, adminChannel);
                break;
            case 'leaves':
                await handleMemberLeavesCommand(interaction, adminChannel);
                break;
        }
    }
    
    // 一般使用者指令 - 發送到使用者頻道
    if (['mylevel', 'top'].includes(commandName)) {
        const userChannel = getUserChannel(interaction.guild);
        if (!userChannel) {
            await interaction.reply({ 
                content: '❌ 找不到使用者頻道！', 
                ephemeral: true 
            });
            return;
        }
        
        switch (commandName) {
            case 'mylevel':
                await handleLevelCommand(interaction, userChannel);
                break;
            case 'top':
                await handleLeaderboardCommand(interaction, userChannel);
                break;
        }
    }
    
    // 🔥 連結指令（所有人都可使用）
    if (commandName === 'link') {
        await handleLinkCommand(interaction);
    } else if (commandName === 'checklink') {
        await handleCheckLinkCommand(interaction);
    }
});

// 成員離開事件
client.on('guildMemberRemove', async member => {
    const roles = member.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => r.name)
        .join(', ');
    
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
console.log('📋 功能清單：');
console.log('  ✅ 等級系統');
console.log('  ✅ 自動監控（訊息刪除、成員離開）');
console.log('  ✅ Discord 帳號連結');
console.log('  ✅ 管理員指令');
console.log('  ✅ 一般使用者指令');
