// ticket-system.js - 獨立的票務系統模塊
// 使用方法：在 bot.js 中引入 const TicketSystem = require('./ticket-system');

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits, 
    ButtonBuilder, 
    ActionRowBuilder, 
    ButtonStyle,
    ModalBuilder,     
    TextInputBuilder,
    TextInputStyle 
} = require('discord.js');

// 檢查並安裝 node-fetch (如果未安裝)
let fetch;
try {
    fetch = require('node-fetch');
} catch (error) {
    console.error('❌ 請安裝 node-fetch: npm install node-fetch');
    process.exit(1);
}

console.log('  - GITHUB_TOKEN:', process.env.GITHUB_TOKEN ? '✅' : '❌');
console.log('  - GIST_ID:', process.env.GIST_ID ? '✅' : '❌');

class TicketSystem {
    constructor(config = {}) {
        // 預設設定，可以在初始化時覆寫
        this.config = {
            GITHUB_TOKEN: process.env.GITHUB_TOKEN,
            GIST_ID: process.env.GIST_ID,
            FILENAME: 'sfl-bot-tickets.json',
            CATEGORY_ID: config.categoryId || '1402338913258836108', // 可自訂類別ID
            TICKET_PREFIX: 'ticket-',
            MAX_TICKETS_PER_USER: 3,
            ADMIN_CHANNEL_ID: config.adminChannelId || '1402338913258836108',
            ...config
        };
        
        this.gistManager = new GitHubGistManager(this.config);
        this.commands = this.createCommands();
    }

    // 建立斜線指令
    createCommands() {

        // 新增票務面板指令
        const ticketPanelCommand = new SlashCommandBuilder()
            .setName('ticketpanel')
            .setDescription('[管理員] 生成票務面板');

        // 開票指令
        const ticketCommand = new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('建立新的問題單')
            .addStringOption(option =>
                option.setName('問題描述')
                    .setDescription('簡述您遇到的問題')
                    .setRequired(true)
                    .setMaxLength(100)
            )
            .addStringOption(option =>
                option.setName('類型')
                    .setDescription('問題類型')
                    .setRequired(true)
                    .addChoices(
                        { name: '🐛 Bug回報', value: 'bug' },
                        { name: '💡 功能建議', value: 'feature' },
                        { name: '❓ 一般問題', value: 'general' },
                        { name: '⚠️ 緊急問題', value: 'urgent' }
                    )
            );

        const ticketStatsCommand = new SlashCommandBuilder()
            .setName('ticketstats')
            .setDescription('[管理員] 查看問題單統計');

        const testGistCommand = new SlashCommandBuilder()
            .setName('testgist')
            .setDescription('[管理員] 測試 GitHub Gist 連線');

        return {
            ticket: ticketCommand,
            ticketstats: ticketStatsCommand,
            testgist: testGistCommand,
            ticketpanel: ticketPanelCommand
        };
    }

    // 取得所有指令
    getCommands() {
        return Object.values(this.commands);
    }

    // 處理互動事件
    async handleInteraction(interaction, getAdminChannelFunc) {
        if (interaction.isChatInputCommand()) {
            return await this.handleSlashCommand(interaction, getAdminChannelFunc);
        } else if (interaction.isButton()) {
            return await this.handleButtonInteraction(interaction, getAdminChannelFunc);
        } else if (interaction.isModalSubmit()) {  
            return await this.handleModalSubmit(interaction, getAdminChannelFunc);
        }
        return false;
    }

    // 處理斜線指令
    async handleSlashCommand(interaction, getAdminChannelFunc) {
        const { commandName } = interaction;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        switch (commandName) {
            case 'ticket':
                await this.handleTicketCommand(interaction, getAdminChannelFunc);
                return true;
                
            case 'ticketstats':
                if (!isAdmin) {
                    await interaction.reply({ content: '❌ 你沒有權限使用此指令！', ephemeral: true });
                    return true;
                }
                await this.handleTicketStatsCommand(interaction);
                return true;
                
            case 'testgist':
                if (!isAdmin) {
                    await interaction.reply({ content: '❌ 管理員專用！', ephemeral: true });
                    return true;
                }
                await this.handleTestGistCommand(interaction);
                return true;
            case 'ticketpanel':
                if (!isAdmin) {
                    await interaction.reply({ content: '❌ 你沒有權限使用此指令！', ephemeral: true });
                    return true;
                }
                await this.handleTicketPanelCommand(interaction);
                return true;
        }
        
        return false;
    }

    // 🆕 處理票務面板指令
    async handleTicketPanelCommand(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
    
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 問題單系統')
                .setDescription('遇到問題或需要協助嗎？點擊下方按鈕開立問題單，我們的團隊將盡快為您處理。')
                .addFields(
                    { 
                        name: '📋 開立前請注意', 
                        value: '• 請詳細描述您的問題\n• 選擇正確的問題類型\n• 每人最多可同時開啟 3 個問題單\n• 濫用系統將會受到處罰' 
                    },
                    { 
                        name: '⏰ 處理時間', 
                        value: '一般問題：24 小時內\n緊急問題：2 小時內' 
                    }
                )
                .setFooter({ text: 'SFL 客服團隊' })
                .setTimestamp();
    
            const openTicketButton = new ButtonBuilder()
                .setCustomId('open_ticket_modal')
                .setLabel('🎫 開立問題單')
                .setStyle(ButtonStyle.Primary);
    
            const row = new ActionRowBuilder().addComponents(openTicketButton);
    
            // 發送到當前頻道
            await interaction.channel.send({
                embeds: [embed],
                components: [row]
            });
    
            await interaction.editReply({ content: '✅ 票務面板已生成！' });
    
        } catch (error) {
            console.error('生成票務面板失敗:', error);
            await interaction.editReply({ content: '❌ 生成票務面板失敗！' });
        }
    }
    
    // 🆕 處理 Modal 提交
    async handleModalSubmit(interaction, getAdminChannelFunc) {
        if (interaction.customId === 'ticket_modal') {
            const ticketType = interaction.fields.getTextInputValue('ticket_type').toLowerCase();
            const ticketDescription = interaction.fields.getTextInputValue('ticket_description');
    
            // 驗證類型
            const validTypes = ['bug', 'feature', 'general', 'urgent'];
            if (!validTypes.includes(ticketType)) {
                await interaction.reply({ 
                    content: '❌ 無效的問題類型！請輸入: bug / feature / general / urgent', 
                    ephemeral: true 
                });
                return true;
            }
    
            // 使用現有的建立問題單邏輯
            // 暫時創建模擬的 options 物件
            const mockOptions = {
                getString: (name) => {
                    if (name === '問題描述') return ticketDescription;
                    if (name === '類型') return ticketType;
                    return null;
                }
            };
    
            // 替換 interaction.options
            const originalOptions = interaction.options;
            interaction.options = mockOptions;
            
            // 呼叫原本的 handleTicketCommand
            await this.handleTicketCommand(interaction, getAdminChannelFunc);
            
            // 恢復原始 options
            interaction.options = originalOptions;
            
            return true;
        }
        return false;
    }

    // 處理按鈕互動
    async handleButtonInteraction(interaction, getAdminChannelFunc) {
        // 處理開立問題單按鈕
        if (interaction.customId === 'open_ticket_modal') {
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('開立問題單');
    
            const typeInput = new TextInputBuilder()
                .setCustomId('ticket_type')
                .setLabel('問題類型')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('請輸入: bug / feature / general / urgent')
                .setRequired(true)
                .setMaxLength(10);
    
            const descriptionInput = new TextInputBuilder()
                .setCustomId('ticket_description')
                .setLabel('問題描述')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('請詳細描述您遇到的問題...')
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(1000);
    
            const firstActionRow = new ActionRowBuilder().addComponents(typeInput);
            const secondActionRow = new ActionRowBuilder().addComponents(descriptionInput);
    
            modal.addComponents(firstActionRow, secondActionRow);
    
            await interaction.showModal(modal);
            return true;
        }
        if (interaction.customId.startsWith('close_ticket_')) {
            const channelId = interaction.customId.split('_')[2];
            const channel = interaction.guild.channels.cache.get(channelId);
            
            if (!channel) {
                await interaction.reply({ content: '❌ 找不到問題單頻道！', ephemeral: true });
                return true;
            }
            
            // 檢查權限
            const isCreator = channel.permissionOverwrites.cache.has(interaction.user.id);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            
            if (!isCreator && !isAdmin) {
                await interaction.reply({ content: '❌ 您沒有權限關閉此問題單！', ephemeral: true });
                return true;
            }
            
            await interaction.reply('🔒 正在關閉問題單...');
            
            // 更新 Gist 中的問題單狀態
            const ticket = await this.gistManager.getTicketByChannelId(channelId);
            if (ticket) {
                await this.gistManager.updateTicketStatus(ticket.ticket_id, 'closed', interaction.user.id);
            }
            
            // 5秒後刪除頻道
            setTimeout(async () => {
                try {
                    await channel.delete('問題單已關閉');
                } catch (error) {
                    console.error('刪除問題單頻道失敗:', error);
                }
            }, 5000);
            
            return true;
        }
        
        return false;
    }

    

    // 建立問題單處理
    async handleTicketCommand(interaction, getAdminChannelFunc) {
        const problemDescription = interaction.options.getString('問題描述');
        const ticketType = interaction.options.getString('類型');
        const user = interaction.user;
        const guild = interaction.guild;
        
        try {
            await interaction.deferReply({ flags: 64 });
            
            // 檢查 GitHub 設定
            if (!this.config.GITHUB_TOKEN || !this.config.GIST_ID) {
                await interaction.editReply({
                    content: '❌ GitHub Gist 設定未完成，請聯繫管理員。\n請確認環境變數 GITHUB_TOKEN 和 GIST_ID 已設定。'
                });
                return;
            }
            
            // 檢查使用者開啟的問題單數量
            const openTicketsCount = await this.gistManager.getUserOpenTickets(user.id);
            
            if (openTicketsCount >= this.config.MAX_TICKETS_PER_USER) {
                await interaction.editReply({
                    content: `❌ 您已有 ${openTicketsCount} 個開啟的問題單，請先處理完成後再建立新的問題單。`
                });
                return;
            }
            
            // 類型圖示
            const typeEmojis = {
                'bug': '🐛',
                'feature': '💡', 
                'general': '❓',
                'urgent': '⚠️'
            };
            
            // 生成問題單ID
            const ticketId = Date.now().toString().slice(-6);
            const channelName = `${this.config.TICKET_PREFIX}${user.id}-${ticketId}`;
            
            // 建立頻道
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: this.config.CATEGORY_ID,
                topic: `${typeEmojis[ticketType]} 問題單 #${ticketId} | 建立者: ${user.username} | 類型: ${ticketType}`,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    },
                    {
                        id: guild.members.me.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }
                ]
            });
            
            // 為管理員添加權限
            const adminRole = guild.roles.cache.find(role => 
                role.permissions.has(PermissionFlagsBits.Administrator) && 
                role.name !== '@everyone'
            );
            
            if (adminRole) {
                await ticketChannel.permissionOverwrites.create(adminRole, {
                    ViewChannel: true,
                    SendMessages: true,
                    ManageMessages: true,
                    ReadMessageHistory: true
                });
            }
            
            // 建立關閉按鈕
            const closeButton = new ButtonBuilder()
                .setCustomId(`close_ticket_${ticketChannel.id}`)
                .setLabel('🔒 關閉問題單')
                .setStyle(ButtonStyle.Danger);
                
            const row = new ActionRowBuilder().addComponents(closeButton);
            
            // 發送歡迎訊息
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle(`${typeEmojis[ticketType]} 問題單 #${ticketId}`)
                .setDescription('感謝您建立問題單！管理員將會盡快回覆您。')
                .addFields(
                    { name: '👤 建立者', value: `<@${user.id}>`, inline: true },
                    { name: '📋 問題類型', value: ticketType, inline: true },
                    { name: '🕒 建立時間', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '📝 問題描述', value: problemDescription, inline: false }
                )
                .setFooter({ text: '請詳細描述您的問題，以便我們更快協助您' })
                .setTimestamp();
            
            await ticketChannel.send({
                content: `<@${user.id}> 歡迎來到您的問題單！`,
                embeds: [welcomeEmbed],
                components: [row]
            });
            
            // 儲存到 Gist
            const ticketData = {
                ticket_id: ticketId,
                user_id: user.id,
                username: user.username,
                channel_id: ticketChannel.id,
                type: ticketType,
                description: problemDescription,
                created_at: Date.now(),
                status: 'open',
                guild_id: guild.id,
                closed_at: null,
                closed_by: null
            };
            
            const saveResult = await this.gistManager.addTicket(ticketData);
            if (!saveResult) {
                console.error('⚠️ 儲存問題單到 Gist 失敗');
            }
            
            // 回覆使用者
            await interaction.editReply({
                content: `✅ 問題單建立成功！請前往 <#${ticketChannel.id}> 查看您的問題單。`
            });
            
            // 通知管理員
            const adminChannel = getAdminChannelFunc(guild);
            if (adminChannel) {
                const notifyEmbed = new EmbedBuilder()
                    .setColor(0xff9500)
                    .setTitle('🎫 新問題單建立')
                    .addFields(
                        { name: '建立者', value: `<@${user.id}>`, inline: true },
                        { name: '類型', value: `${typeEmojis[ticketType]} ${ticketType}`, inline: true },
                        { name: '頻道', value: `<#${ticketChannel.id}>`, inline: true },
                        { name: '問題描述', value: problemDescription, inline: false }
                    )
                    .setTimestamp();
                
                await adminChannel.send({ embeds: [notifyEmbed] });
            }
            
        } catch (error) {
            console.error('建立問題單時發生錯誤:', error);
            await interaction.editReply({
                content: '❌ 建立問題單時發生錯誤，請稍後再試或聯繫管理員。'
            });
        }
    }

    // 統計指令處理
    async handleTicketStatsCommand(interaction) {
        try {
            await interaction.deferReply();
            
            const data = await this.gistManager.readTicketData();
            const tickets = data.tickets;
            
            const openTickets = tickets.filter(t => t.status === 'open').length;
            const closedTickets = tickets.filter(t => t.status === 'closed').length;
            const totalTickets = tickets.length;
            
            // 統計各類型
            const typeStats = {};
            tickets.forEach(ticket => {
                typeStats[ticket.type] = (typeStats[ticket.type] || 0) + 1;
            });
            
            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('📊 問題單統計')
                .addFields(
                    { name: '🎫 總問題單', value: totalTickets.toString(), inline: true },
                    { name: '🟢 開啟中', value: openTickets.toString(), inline: true },
                    { name: '🔒 已關閉', value: closedTickets.toString(), inline: true }
                )
                .setFooter({ text: `最後更新: ${new Date(data.lastUpdated).toLocaleString('zh-TW')}` })
                .setTimestamp();
            
            if (Object.keys(typeStats).length > 0) {
                const typeStatsText = Object.entries(typeStats)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join('\n');
                embed.addFields({ name: '📋 類型統計', value: typeStatsText, inline: false });
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('取得問題單統計失敗:', error);
            await interaction.editReply({ content: '❌ 取得統計資料失敗！' });
        }
    }

    // 測試連線指令處理
    async handleTestGistCommand(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const data = await this.gistManager.readTicketData();
            await interaction.editReply({
                content: `✅ Gist 連線成功！\n📊 目前有 ${data.tickets.length} 個問題單記錄\n🕒 最後更新: ${new Date(data.lastUpdated).toLocaleString('zh-TW')}`
            });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Gist 連線失敗：${error.message}\n\n請檢查：\n- GITHUB_TOKEN 環境變數\n- GIST_ID 環境變數\n- GitHub Token 權限`
            });
        }
    }
}

// GitHub Gist 管理類別
class GitHubGistManager {
    constructor(config) {
        this.config = config;
        this.apiUrl = 'https://api.github.com';
        this.headers = {
            'Authorization': `token ${config.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    }

    async readTicketData() {
        try {
            const response = await fetch(`${this.apiUrl}/gists/${this.config.GIST_ID}`, {
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`GitHub API Error: ${response.status} - ${response.statusText}`);
            }

            const gist = await response.json();
            const content = gist.files[this.config.FILENAME]?.content;
            
            if (!content) {
                return {
                    tickets: [],
                    lastUpdated: Date.now()
                };
            }

            return JSON.parse(content);
        } catch (error) {
            console.error('讀取 Gist 資料失敗:', error);
            return {
                tickets: [],
                lastUpdated: Date.now()
            };
        }
    }

    async writeTicketData(data) {
        try {
            data.lastUpdated = Date.now();
            
            const response = await fetch(`${this.apiUrl}/gists/${this.config.GIST_ID}`, {
                method: 'PATCH',
                headers: this.headers,
                body: JSON.stringify({
                    files: {
                        [this.config.FILENAME]: {
                            content: JSON.stringify(data, null, 2)
                        }
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`GitHub API Error: ${response.status} - ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('寫入 Gist 資料失敗:', error);
            return false;
        }
    }

    async addTicket(ticketData) {
        const data = await this.readTicketData();
        data.tickets.push(ticketData);
        return await this.writeTicketData(data);
    }

    async updateTicketStatus(ticketId, status, closedBy = null) {
        const data = await this.readTicketData();
        const ticketIndex = data.tickets.findIndex(t => t.ticket_id === ticketId);
        
        if (ticketIndex !== -1) {
            data.tickets[ticketIndex].status = status;
            data.tickets[ticketIndex].closed_at = Date.now();
            if (closedBy) {
                data.tickets[ticketIndex].closed_by = closedBy;
            }
            return await this.writeTicketData(data);
        }
        return false;
    }

    async getUserOpenTickets(userId) {
        const data = await this.readTicketData();
        // 確保 data.tickets 存在且為陣列
        if (!data || !data.tickets || !Array.isArray(data.tickets)) {
            return 0;
        }
        return data.tickets.filter(t => t.user_id === userId && t.status === 'open').length;
    }

    async getTicketByChannelId(channelId) {
        const data = await this.readTicketData();
        // 確保 data.tickets 存在且為陣列
        if (!data || !data.tickets || !Array.isArray(data.tickets)) {
            return null;
        }
        return data.tickets.find(t => t.channel_id === channelId);
    }
}

module.exports = TicketSystem;
