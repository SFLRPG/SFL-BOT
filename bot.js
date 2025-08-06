// SFL-BOT 升級版 - 自動監控版本 + Discord 連結功能
// 管理員指令 → 頻道ID: 1402338913258836108
// 一般指令 → 頻道ID: 1402341842023878697
// 自動監控 → 頻道ID: 1402338913258836108 (刪除記錄、離開記錄)

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ChannelType, PermissionFlagsBits ,
    ButtonBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    ButtonStyle,
    TextInputStyle,
    AttachmentBuilder
      } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// 🔥 Firebase Admin SDK 初始化（使用分離的環境變數）
const admin = require('firebase-admin');

let firestore = null;

console.log('🔍 檢查 Firebase 環境變數...');
console.log('  - FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅' : '❌');
console.log('  - FIREBASE_PRIVATE_KEY_ID:', process.env.FIREBASE_PRIVATE_KEY_ID ? '✅' : '❌');
console.log('  - FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅' : '❌');
console.log('  - FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅' : '❌');
console.log('  - FIREBASE_CLIENT_ID:', process.env.FIREBASE_CLIENT_ID ? '✅' : '❌');

try {
    // 檢查所有必要的環境變數
    if (!process.env.FIREBASE_PROJECT_ID || 
        !process.env.FIREBASE_PRIVATE_KEY || 
        !process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error('Firebase 環境變數不完整');
    }
    
    console.log('📝 組合 Firebase 服務帳號...');
    
    // 從環境變數組合服務帳號物件
    const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        // 處理 private_key 的換行符號
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`,
        universe_domain: "googleapis.com"
    };
    
    console.log('🚀 初始化 Firebase Admin SDK...');
    console.log('  - Project ID:', serviceAccount.project_id);
    console.log('  - Client Email:', serviceAccount.client_email);
    
    // 初始化 Firebase Admin
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
    
    firestore = admin.firestore();
    console.log('✅ Firebase Admin SDK 初始化成功！');
    
    // 測試連接
    firestore.collection('test').doc('ping').set({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: 'discord-bot-init'
    }).then(() => {
        console.log('✅ Firestore 連接測試成功');
    }).catch(err => {
        console.log('⚠️ Firestore 連接測試失敗:', err.message);
    });
    
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

// 加入新的管理員指令定義
const linkPanelCommand = new SlashCommandBuilder()
    .setName('linkpanel')
    .setDescription('[管理員] 生成連結面板');

// 將所有指令加入陣列
commands.push(
    levelCommand, leaderboardCommand, deletedLogsCommand, memberLeavesCommand,
    myLevelCommand, topCommand,
    linkCommand, checkLinkCommand , linkPanelCommand 
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
                    { name: '📝 如何連結？', value: '1. 前往 [SFL遊戲網頁](https://sfl-rpg.com/)\n2. 在主頁資源管理區塊點選【Discord綁定】頁面\n3. 複製連結代碼\n4. 使用下方連結按紐 或 `/link 代碼` 指令' }
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
    // 處理斜線指令
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        
        // 管理員指令 - 發送到管理員頻道
        if (['level', 'leaderboard', 'deleted', 'leaves', 'linkpanel'].includes(commandName)) {
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
                case 'linkpanel':
                    await handleLinkPanelCommand(interaction);
                    break;
            }
        }
        
        // 其他現有的指令處理保持不變...
    }
    
    // 處理按鈕交互
    else if (interaction.isButton()) {
        if (interaction.customId === 'checklink_button') {
            // 模擬執行 /checklink 指令
            await handleCheckLinkCommand(interaction);
        } 
        else if (interaction.customId === 'link_button') {
            // 顯示輸入 token 的 modal
            const modal = new ModalBuilder()
                .setCustomId('link_token_modal')
                .setTitle('連結遊戲帳號');

            const tokenInput = new TextInputBuilder()
                .setCustomId('token_input')
                .setLabel('請輸入連結代碼')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('XXXX-XXXX-XXXX-XXXX')
                .setRequired(true)
                .setMaxLength(19)
                .setMinLength(19);

            const actionRow = new ActionRowBuilder().addComponents(tokenInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
        }
    }
    
    // 處理 Modal 提交
    else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'link_token_modal') {
            const token = interaction.fields.getTextInputValue('token_input');
            
            // 模擬執行 /link 指令
            // 創建一個模擬的 interaction options 對象
            const mockOptions = {
                getString: (name) => name === '代碼' ? token : null
            };
            
            // 暫存原始的 options 並替換
            const originalOptions = interaction.options;
            interaction.options = mockOptions;
            
            await handleLinkCommand(interaction);
            
            // 恢復原始 options
            interaction.options = originalOptions;
        }
    }
});

async function handleLinkPanelCommand(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // 創建圖片附件
        const attachment = new AttachmentBuilder('./Discord_Connect.jpg', { 
            name: 'discord_connect.jpg' 
        });

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🔗 遊戲帳號連結面板')
            .setDescription('點擊下方按鈕來管理您的帳號連結')
            .addFields(
                { name: '📝 如何連結？', value: '1. 前往 [SFL遊戲網頁](https://sfl-rpg.com/)\n2. 在主頁資源管理區塊點選【Discord連結】頁面\n3. 複製連結代碼\n4. 使用下方連結按紐 或 `/link 代碼` 指令' }
            )
            .setImage('attachment://discord_connect.jpg')  // 添加圖片
            .setFooter({ text: '連結成功後可獲得遊戲內獎勵！' })
            .setTimestamp();

        const checkLinkButton = new ButtonBuilder()
            .setCustomId('checklink_button')
            .setLabel('📋 檢查連結狀態')
            .setStyle(ButtonStyle.Secondary);

        const linkButton = new ButtonBuilder()
            .setCustomId('link_button')
            .setLabel('🔗 連結帳號')
            .setStyle(ButtonStyle.Success);  // 綠色按鈕

        const actionRow = new ActionRowBuilder()
            .addComponents(checkLinkButton, linkButton);

        // 發送到當前頻道
        await interaction.followUp({
            content: '✅ 連結面板已生成！',
            ephemeral: true
        });

        await interaction.channel.send({
            embeds: [embed],
            components: [actionRow],
            files: [attachment]  // 附加圖片檔案
        });

    } catch (error) {
        console.error('生成連結面板失敗:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ 生成失敗')
            .setDescription('無法生成連結面板，請稍後再試。')
            .setTimestamp();
        
        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
}

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
