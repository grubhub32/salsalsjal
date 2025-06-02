const Discord = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Added HTTP module

// Bot configuration
const config = {
    prefix: '?',
    dataFile: './bot_data.json',
    inviteLink: 'https://discord.com/oauth2/authorize?client_id=1376634793659334716&permissions=8&integration_type=0&scope=bot+applications.commands',
    port: process.env.PORT || 10000 // Added port configuration (defaults to 3000 or environment variable)
};

// Initialize client with necessary intents
const client = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildBans,
        Discord.GatewayIntentBits.GuildModeration
    ]
});

// Create a simple HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord bot is running!\n');
});

// Start the server
server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
});

// Data storage - now fully server-specific
let serverData = {};

// Load data from file
function loadData() {
    try {
        if (fs.existsSync(config.dataFile)) {
            const rawData = fs.readFileSync(config.dataFile, 'utf8');
            const parsedData = JSON.parse(rawData);
            
            // Initialize each server's data structure if not present
            for (const guildId in parsedData) {
                if (!serverData[guildId]) {
                    serverData[guildId] = {
                        settings: {
                            prefix: config.prefix, // Server-specific prefix
                            welcomeChannel: null,
                            leaveChannel: null,
                            logsChannel: null,
                            autoRole: null,
                            allowedRole: null,
                            autoPurge: {},
                            antiSpam: true,
                            antiCaps: true,
                            antiInvites: true,
                            antiMention: true,
                            antiRaid: true
                        },
                        whitelist: [],
                        warnings: {},
                        tempBans: {},
                        mutes: {},
                        logs: [],
                        messageCache: {},
                        joinTimes: {}
                    };
                }
                
                // Merge loaded data with default structure
                serverData[guildId] = {
                    ...serverData[guildId],
                    ...parsedData[guildId]
                };
            }
        }
    } catch (error) {
        console.error('Error loading data:', error);
        serverData = {};
    }
}

// Save data to file
function saveData() {
    try {
        fs.writeFileSync(config.dataFile, JSON.stringify(serverData, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Initialize server data with server-specific defaults
function initServerData(guildId) {
    if (!serverData[guildId]) {
        serverData[guildId] = {
            settings: {
                prefix: config.prefix, // Server can customize this
                welcomeChannel: null,
                leaveChannel: null,
                logsChannel: null,
                autoRole: null,
                allowedRole: null,
                autoPurge: {},
                antiSpam: true,
                antiCaps: true,
                antiInvites: true,
                antiMention: true,
                antiRaid: true
            },
            whitelist: [],
            warnings: {},
            tempBans: {},
            mutes: {},
            logs: [],
            messageCache: {},
            joinTimes: {}
        };
        saveData();
    }
}

// Get server-specific prefix
function getPrefix(guildId) {
    return serverData[guildId]?.settings?.prefix || config.prefix;
}

// Parse time duration
function parseDuration(duration) {
    if (!duration) return null;
    const match = duration.match(/^(\d+)([dhm])$/);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'm': return value * 60 * 1000;
        default: return null;
    }
}

// Check if user has permission
function hasPermission(member, guildId) {
    const data = serverData[guildId];
    if (!data) return false;
    
    if (member.permissions.has(Discord.PermissionFlagsBits.Administrator)) return true;
    if (data.settings.allowedRole && member.roles.cache.has(data.settings.allowedRole)) return true;
    
    return false;
}

// Check if user is whitelisted
function isWhitelisted(userId, guildId) {
    const data = serverData[guildId];
    return data && data.whitelist.includes(userId);
}

// Log action
function logAction(guildId, action, details) {
    const data = serverData[guildId];
    if (!data) return;
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        action: action,
        details: details
    };
    
    data.logs.push(logEntry);
    if (data.logs.length > 1000) {
        data.logs = data.logs.slice(-1000);
    }
    
    saveData();
    
    // Send to logs channel if set
    if (data.settings.logsChannel) {
        const channel = client.channels.cache.get(data.settings.logsChannel);
        if (channel) {
            const embed = new Discord.EmbedBuilder()
                .setTitle(`Moderation Action: ${action}`)
                .setDescription(details)
                .setTimestamp()
                .setColor(0xff0000);
            channel.send({ embeds: [embed] });
        }
    }
}

// Anti-spam system
const spamCache = new Map();

function checkSpam(message) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const now = Date.now();
    
    if (!spamCache.has(userId)) {
        spamCache.set(userId, []);
    }
    
    const userMessages = spamCache.get(userId);
    userMessages.push({ content: message.content, timestamp: now });
    
    // Remove old messages (older than 5 seconds)
    const filtered = userMessages.filter(msg => now - msg.timestamp < 5000);
    spamCache.set(userId, filtered);
    
    // Check for spam (5+ identical messages in 5 seconds)
    const duplicates = filtered.filter(msg => msg.content === message.content);
    if (duplicates.length >= 5) {
        return true;
    }
    
    return false;
}

// Anti-raid system
function checkRaid(member) {
    const guildId = member.guild.id;
    const data = serverData[guildId];
    if (!data) return false;
    
    const now = Date.now();
    data.joinTimes[member.id] = now;
    
    // Count joins in last 10 seconds
    const recentJoins = Object.values(data.joinTimes).filter(time => now - time < 10000);
    
    if (recentJoins.length >= 5) {
        return true;
    }
    
    return false;
}

// Bot ready event
client.once('ready', () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    loadData();
    
    // Set up auto-unban checker
    setInterval(() => {
        for (const guildId in serverData) {
            const data = serverData[guildId];
            const now = Date.now();
            
            // Check temp bans
            for (const userId in data.tempBans) {
                if (data.tempBans[userId] <= now) {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        guild.bans.remove(userId, 'Temporary ban expired');
                        delete data.tempBans[userId];
                        logAction(guildId, 'Auto Unban', `User ${userId} temporary ban expired`);
                    }
                }
            }
            
            // Check mutes
            for (const userId in data.mutes) {
                if (data.mutes[userId] <= now) {
                    const guild = client.guilds.cache.get(guildId);
                    const member = guild?.members.cache.get(userId);
                    if (member) {
                        member.timeout(null, 'Mute expired');
                        delete data.mutes[userId];
                        logAction(guildId, 'Auto Unmute', `User ${userId} mute expired`);
                    }
                }
            }
        }
        saveData();
    }, 30000); // Check every 30 seconds
});

// Member join event
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    initServerData(guildId);
    const data = serverData[guildId];
    
    // Anti-raid check
    if (data.settings.antiRaid && checkRaid(member)) {
        try {
            await member.ban({ reason: 'Anti-raid protection' });
            logAction(guildId, 'Anti-Raid Ban', `Banned ${member.user.tag} (${member.id}) for potential raid`);
            return;
        } catch (error) {
            console.error('Error banning raid member:', error);
        }
    }
    
    // Auto-role
    if (data.settings.autoRole) {
        try {
            const role = member.guild.roles.cache.get(data.settings.autoRole);
            if (role) {
                await member.roles.add(role);
            }
        } catch (error) {
            console.error('Error adding auto-role:', error);
        }
    }
    
    // Welcome message
    if (data.settings.welcomeChannel) {
        const channel = client.channels.cache.get(data.settings.welcomeChannel);
        if (channel) {
            const embed = new Discord.EmbedBuilder()
                .setTitle('Welcome!')
                .setDescription(`Welcome to the server, ${member.user.tag}!`)
                .setColor(0x00ff00)
                .setThumbnail(member.user.displayAvatarURL());
            channel.send({ embeds: [embed] });
        }
    }
});

// Member leave event
client.on('guildMemberRemove', (member) => {
    const guildId = member.guild.id;
    const data = serverData[guildId];
    
    if (data?.settings.leaveChannel) {
        const channel = client.channels.cache.get(data.settings.leaveChannel);
        if (channel) {
            const embed = new Discord.EmbedBuilder()
                .setTitle('Goodbye!')
                .setDescription(`${member.user.tag} has left the server.`)
                .setColor(0xff0000)
                .setThumbnail(member.user.displayAvatarURL());
            channel.send({ embeds: [embed] });
        }
    }
});

// Message event
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    
    const guildId = message.guild.id;
    initServerData(guildId);
    const data = serverData[guildId];
    
    // Use server-specific prefix
    const serverPrefix = getPrefix(guildId);
    if (!message.content.startsWith(serverPrefix)) return;
    
    const args = message.content.slice(serverPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Check permissions
    if (!hasPermission(message.member, guildId)) {
        return message.reply('You do not have permission to use bot commands.');
    }
    
    try {
        switch (command) {
            case 'kick':
                await handleKick(message, args);
                break;
            case 'ban':
                await handleBan(message, args);
                break;
            case 'softban':
                await handleSoftban(message, args);
                break;
            case 'unban':
                await handleUnban(message, args);
                break;
            case 'mute':
                await handleMute(message, args);
                break;
            case 'unmute':
                await handleUnmute(message, args);
                break;
            case 'warn':
                await handleWarn(message, args);
                break;
            case 'purge':
                await handlePurge(message, args);
                break;
            case 'setrole':
                await handleSetRole(message, args);
                break;
            case 'setautorole':
                await handleSetAutoRole(message, args);
                break;
            case 'setwelcome':
                await handleSetWelcome(message, args);
                break;
            case 'setleave':
                await handleSetLeave(message, args);
                break;
            case 'setlogs':
                await handleSetLogs(message, args);
                break;
            case 'setprefix':
                await handleSetPrefix(message, args);
                break;
            case 'logs':
                await handleLogs(message, args);
                break;
            case 'createchannel':
                await handleCreateChannel(message, args);
                break;
            case 'deletechannel':
                await handleDeleteChannel(message, args);
                break;
            case 'whitelist':
                await handleWhitelist(message, args);
                break;
            case 'restriction':
                await handleRestriction(message, args);
                break;
            case 'autopurge':
                await handleAutoPurge(message, args);
                break;
            case 'togglesetting':
                await handleToggleSetting(message, args);
                break;
            case 'invite':
                await handleInvite(message);
                break;
            case 'help':
                await handleHelp(message);
                break;
            default:
                // Check for server-specific custom commands
                if (data.customCommands && data.customCommands[command]) {
                    await message.channel.send(data.customCommands[command]);
                }
        }
    } catch (error) {
        console.error(`Error executing command ${command}:`, error);
        message.reply('An error occurred while executing the command.');
    }
});

// Command handlers
async function handleKick(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to kick.');
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        await member.kick(reason);
        logAction(message.guild.id, 'Kick', `${message.author.tag} kicked ${member.user.tag}: ${reason}`);
        message.reply(`Successfully kicked ${member.user.tag}`);
    } catch (error) {
        message.reply('Failed to kick user.');
    }
}

async function handleBan(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to ban.');
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        await member.ban({ reason });
        logAction(message.guild.id, 'Ban', `${message.author.tag} banned ${member.user.tag}: ${reason}`);
        message.reply(`Successfully banned ${member.user.tag}`);
    } catch (error) {
        message.reply('Failed to ban user.');
    }
}

async function handleSoftban(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to softban.');
    
    const duration = args[1];
    const durationMs = parseDuration(duration);
    if (!durationMs) return message.reply('Please provide a valid duration (e.g., 1d, 2h, 30m).');
    
    const reason = args.slice(2).join(' ') || 'No reason provided';
    
    try {
        await member.ban({ reason });
        serverData[message.guild.id].tempBans[member.id] = Date.now() + durationMs;
        saveData();
        
        logAction(message.guild.id, 'Softban', `${message.author.tag} softbanned ${member.user.tag} for ${duration}: ${reason}`);
        message.reply(`Successfully softbanned ${member.user.tag} for ${duration}`);
    } catch (error) {
        message.reply('Failed to softban user.');
    }
}

async function handleUnban(message, args) {
    const userId = args[0];
    if (!userId) return message.reply('Please provide a user ID to unban.');
    
    try {
        await message.guild.bans.remove(userId, 'Manual unban');
        delete serverData[message.guild.id].tempBans[userId];
        saveData();
        
        logAction(message.guild.id, 'Unban', `${message.author.tag} unbanned user ${userId}`);
        message.reply(`Successfully unbanned user ${userId}`);
    } catch (error) {
        message.reply('Failed to unban user.');
    }
}

async function handleMute(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to mute.');
    
    let duration = null;
    let reason = '';
    
    if (args[1] && /^\d+[dhm]$/.test(args[1])) {
        duration = parseDuration(args[1]);
        reason = args.slice(2).join(' ') || 'No reason provided';
    } else {
        reason = args.slice(1).join(' ') || 'No reason provided';
    }
    
    try {
        await member.timeout(duration || 86400000, reason); // Default 24h if no duration
        
        if (duration) {
            serverData[message.guild.id].mutes[member.id] = Date.now() + duration;
            saveData();
        }
        
        const durationText = duration ? ` for ${args[1]}` : ' permanently';
        logAction(message.guild.id, 'Mute', `${message.author.tag} muted ${member.user.tag}${durationText}: ${reason}`);
        message.reply(`Successfully muted ${member.user.tag}${durationText}`);
    } catch (error) {
        message.reply('Failed to mute user.');
    }
}

async function handleUnmute(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to unmute.');
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        await member.timeout(null, reason);
        delete serverData[message.guild.id].mutes[member.id];
        saveData();
        
        logAction(message.guild.id, 'Unmute', `${message.author.tag} unmuted ${member.user.tag}: ${reason}`);
        message.reply(`Successfully unmuted ${member.user.tag}`);
    } catch (error) {
        message.reply('Failed to unmute user.');
    }
}

async function handleWarn(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user to warn.');
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    const data = serverData[message.guild.id];
    if (!data.warnings[member.id]) {
        data.warnings[member.id] = [];
    }
    
    data.warnings[member.id].push({
        reason: reason,
        moderator: message.author.tag,
        timestamp: new Date().toISOString()
    });
    
    saveData();
    
    logAction(message.guild.id, 'Warn', `${message.author.tag} warned ${member.user.tag}: ${reason}`);
    message.reply(`Successfully warned ${member.user.tag}. Total warnings: ${data.warnings[member.id].length}`);
    
    // DM the user
    try {
        const embed = new Discord.EmbedBuilder()
            .setTitle('Warning')
            .setDescription(`You have been warned in ${message.guild.name}`)
            .addFields({ name: 'Reason', value: reason })
            .setColor(0xffff00);
        await member.send({ embeds: [embed] });
    } catch (error) {
        // User has DMs disabled
    }
}

async function handlePurge(message, args) {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
        return message.reply('Please provide a number between 1 and 100.');
    }
    
    try {
        const messages = await message.channel.bulkDelete(amount + 1, true);
        const deleted = messages.size - 1;
        
        logAction(message.guild.id, 'Purge', `${message.author.tag} purged ${deleted} messages in ${message.channel.name}`);
        
        const reply = await message.channel.send(`Successfully deleted ${deleted} messages.`);
        setTimeout(() => reply.delete().catch(() => {}), 5000);
    } catch (error) {
        message.reply('Failed to purge messages.');
    }
}

async function handleSetRole(message, args) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Please mention a user.');
    
    const roleName = args.slice(1).join(' ');
    if (!roleName) return message.reply('Please provide a role name.');
    
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply('Role not found.');
    
    try {
        await member.roles.add(role);
        logAction(message.guild.id, 'Role Assignment', `${message.author.tag} gave ${member.user.tag} the role ${role.name}`);
        message.reply(`Successfully gave ${member.user.tag} the role ${role.name}`);
    } catch (error) {
        message.reply('Failed to assign role.');
    }
}

async function handleSetAutoRole(message, args) {
    const roleName = args.join(' ');
    if (!roleName) return message.reply('Please provide a role name.');
    
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply('Role not found.');
    
    serverData[message.guild.id].settings.autoRole = role.id;
    saveData();
    
    logAction(message.guild.id, 'Settings', `${message.author.tag} set auto-role to ${role.name}`);
    message.reply(`Successfully set auto-role to ${role.name}`);
}

async function handleSetWelcome(message, args) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('Please mention a channel.');
    
    serverData[message.guild.id].settings.welcomeChannel = channel.id;
    saveData();
    
    logAction(message.guild.id, 'Settings', `${message.author.tag} set welcome channel to ${channel.name}`);
    message.reply(`Successfully set welcome channel to ${channel.name}`);
}

async function handleSetLeave(message, args) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('Please mention a channel.');
    
    serverData[message.guild.id].settings.leaveChannel = channel.id;
    saveData();
    
    logAction(message.guild.id, 'Settings', `${message.author.tag} set leave channel to ${channel.name}`);
    message.reply(`Successfully set leave channel to ${channel.name}`);
}

async function handleSetLogs(message, args) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('Please mention a channel.');
    
    serverData[message.guild.id].settings.logsChannel = channel.id;
    saveData();
    
    logAction(message.guild.id, 'Settings', `${message.author.tag} set logs channel to ${channel.name}`);
    message.reply(`Successfully set logs channel to ${channel.name}`);
}

async function handleSetPrefix(message, args) {
    const newPrefix = args[0];
    if (!newPrefix) return message.reply('Please provide a new prefix.');
    if (newPrefix.length > 3) return message.reply('Prefix must be 3 characters or less.');
    
    const guildId = message.guild.id;
    serverData[guildId].settings.prefix = newPrefix;
    saveData();
    
    logAction(guildId, 'Settings', `${message.author.tag} changed prefix to ${newPrefix}`);
    message.reply(`Server prefix set to: ${newPrefix}`);
}

async function handleLogs(message, args) {
    const type = args[0] || 'all';
    const limit = parseInt(args[1]) || 10;
    
    const logs = serverData[message.guild.id].logs.slice(-limit);
    
    if (logs.length === 0) {
        return message.reply('No logs found.');
    }
    
    const embed = new Discord.EmbedBuilder()
        .setTitle('Server Logs')
        .setColor(0x0099ff);
    
    logs.forEach(log => {
        const date = new Date(log.timestamp).toLocaleString();
        embed.addFields({ name: `${log.action} - ${date}`, value: log.details, inline: false });
    });
    
    message.reply({ embeds: [embed] });
}

async function handleCreateChannel(message, args) {
    const name = args[0];
    const type = args[1] || 'text';
    
    if (!name) return message.reply('Please provide a channel name.');
    
    let channelType;
    switch (type.toLowerCase()) {
        case 'voice':
            channelType = Discord.ChannelType.GuildVoice;
            break;
        case 'category':
            channelType = Discord.ChannelType.GuildCategory;
            break;
        default:
            channelType = Discord.ChannelType.GuildText;
    }
    
    try {
        const channel = await message.guild.channels.create({
            name: name,
            type: channelType
        });
        
        logAction(message.guild.id, 'Channel Create', `${message.author.tag} created ${type} channel ${name}`);
        message.reply(`Successfully created ${type} channel ${channel.name}`);
    } catch (error) {
        message.reply('Failed to create channel.');
    }
}

async function handleDeleteChannel(message, args) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('Please mention a channel to delete.');
    
    try {
        const channelName = channel.name;
        await channel.delete();
        
        logAction(message.guild.id, 'Channel Delete', `${message.author.tag} deleted channel ${channelName}`);
        message.reply(`Successfully deleted channel ${channelName}`);
    } catch (error) {
        message.reply('Failed to delete channel.');
    }
}

async function handleWhitelist(message, args) {
    const action = args[0];
    const user = message.mentions.users.first();
    
    if (!action || !['add', 'remove', 'list'].includes(action.toLowerCase())) {
        return message.reply('Usage: `!whitelist <add/remove/list> [@user]`');
    }
    
    const data = serverData[message.guild.id];
    
    switch (action.toLowerCase()) {
        case 'add':
            if (!user) return message.reply('Please mention a user to add to whitelist.');
            if (!data.whitelist.includes(user.id)) {
                data.whitelist.push(user.id);
                saveData();
                logAction(message.guild.id, 'Whitelist', `${message.author.tag} added ${user.tag} to whitelist`);
                message.reply(`Added ${user.tag} to whitelist.`);
            } else {
                message.reply('User is already whitelisted.');
            }
            break;
            
        case 'remove':
            if (!user) return message.reply('Please mention a user to remove from whitelist.');
            const index = data.whitelist.indexOf(user.id);
            if (index > -1) {
                data.whitelist.splice(index, 1);
                saveData();
                logAction(message.guild.id, 'Whitelist', `${message.author.tag} removed ${user.tag} from whitelist`);
                message.reply(`Removed ${user.tag} from whitelist.`);
            } else {
                message.reply('User is not whitelisted.');
            }
            break;
            
        case 'list':
            if (data.whitelist.length === 0) {
                return message.reply('Whitelist is empty.');
            }
            
            const whitelistedUsers = data.whitelist.map(id => {
                const user = client.users.cache.get(id);
                return user ? user.tag : `Unknown User (${id})`;
            }).join('\n');
            
            const embed = new Discord.EmbedBuilder()
                .setTitle('Whitelisted Users')
                .setDescription(whitelistedUsers)
                .setColor(0x00ff00);
            
            message.reply({ embeds: [embed] });
            break;
    }
}

async function handleRestriction(message, args) {
    const roleName = args.join(' ');
    if (!roleName) return message.reply('Please provide a role name.');
    
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply('Role not found.');
    
    serverData[message.guild.id].settings.allowedRole = role.id;
    saveData();
    
    logAction(message.guild.id, 'Settings', `${message.author.tag} set command restriction to role ${role.name}`);
    message.reply(`Successfully set command restriction to role ${role.name}`);
}

async function handleAutoPurge(message, args) {
    const action = args[0];
    const channel = message.mentions.channels.first() || message.channel;
    const interval = args[2];
    
    if (!action || !['start', 'stop', 'list'].includes(action.toLowerCase())) {
        return message.reply('Usage: `!autopurge <start/stop/list> [#channel] [interval]`');
    }
    
    const data = serverData[message.guild.id];
    
    switch (action.toLowerCase()) {
        case 'start':
            if (!interval) return message.reply('Please provide an interval (e.g., 1h, 30m).');
            const intervalMs = parseDuration(interval);
            if (!intervalMs) return message.reply('Invalid interval format.');
            
            data.settings.autoPurge[channel.id] = {
                interval: intervalMs,
                lastPurge: Date.now()
            };
            saveData();
            
            logAction(message.guild.id, 'Auto Purge', `${message.author.tag} enabled auto purge in ${channel.name} every ${interval}`);
            message.reply(`Auto purge enabled in ${channel.name} every ${interval}`);
            break;
            
        case 'stop':
            if (data.settings.autoPurge[channel.id]) {
                delete data.settings.autoPurge[channel.id];
                saveData();
                logAction(message.guild.id, 'Auto Purge', `${message.author.tag} disabled auto purge in ${channel.name}`);
                message.reply(`Auto purge disabled in ${channel.name}`);
            } else {
                message.reply('Auto purge is not enabled in this channel.');
            }
            break;
            
        case 'list':
            const purgeChannels = Object.keys(data.settings.autoPurge);
            if (purgeChannels.length === 0) {
                return message.reply('No auto purge channels configured.');
            }
            
            const channelList = purgeChannels.map(channelId => {
                const ch = client.channels.cache.get(channelId);
                const config = data.settings.autoPurge[channelId];
                const intervalText = config.interval / 60000 < 60 ? 
                    `${Math.floor(config.interval / 60000)}m` : 
                    `${Math.floor(config.interval / 3600000)}h`;
                return `${ch ? ch.name : 'Unknown Channel'}: every ${intervalText}`;
            }).join('\n');
            
            const embed = new Discord.EmbedBuilder()
                .setTitle('Auto Purge Channels')
                .setDescription(channelList)
                .setColor(0xff9900);
            
            message.reply({ embeds: [embed] });
            break;
    }
}

async function handleToggleSetting(message, args) {
    const setting = args[0];
    const validSettings = ['antiSpam', 'antiCaps', 'antiInvites', 'antiMention', 'antiRaid'];
    
    if (!setting || !validSettings.includes(setting)) {
        return message.reply(`Usage: !togglesetting <${validSettings.join('|')}>`);
    }
    
    const guildId = message.guild.id;
    const currentValue = serverData[guildId].settings[setting];
    serverData[guildId].settings[setting] = !currentValue;
    saveData();
    
    const status = serverData[guildId].settings[setting] ? 'enabled' : 'disabled';
    logAction(guildId, 'Settings', `${message.author.tag} ${status} ${setting}`);
    message.reply(`${setting} is now ${status}.`);
}

async function handleInvite(message) {
    const embed = new Discord.EmbedBuilder()
        .setTitle('Invite Me to Your Server!')
        .setDescription(`[Click here to invite me](${config.inviteLink})`)
        .setColor(0x7289DA)
        .setFooter({ text: 'Thank you for using this bot!' });
    
    message.reply({ embeds: [embed] });
}

async function handleHelp(message) {
    const guildId = message.guild.id;
    const serverPrefix = getPrefix(guildId);
    
    const embed = new Discord.EmbedBuilder()
        .setTitle('Bot Commands')
        .setDescription(`Server prefix: \`${serverPrefix}\``)
        .setColor(0x0099ff)
        .addFields(
            { name: 'Moderation', value: '`kick` `ban` `softban` `unban` `mute` `unmute` `warn` `purge`', inline: false },
            { name: 'Role Management', value: '`setrole` `setautorole`', inline: false },
            { name: 'Channel Management', value: '`createchannel` `deletechannel` `setwelcome` `setleave` `setlogs`', inline: false },
            { name: 'Settings', value: '`setprefix` `togglesetting` `restriction`', inline: false },
            { name: 'Utility', value: '`logs` `whitelist` `autopurge` `invite`', inline: false },
            { name: 'Auto Moderation', value: 'Anti-spam, Anti-caps, Anti-invites, Anti-mention, Anti-raid', inline: false }
        )
        .setFooter({ text: `Use ${serverPrefix}command for each command` });
    
    message.reply({ embeds: [embed] });
}

// Auto purge system
setInterval(() => {
    for (const guildId in serverData) {
        const data = serverData[guildId];
        const now = Date.now();
        
        for (const channelId in data.settings.autoPurge) {
            const purgeConfig = data.settings.autoPurge[channelId];
            
            if (now - purgeConfig.lastPurge >= purgeConfig.interval) {
                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    channel.bulkDelete(50, true).then(deleted => {
                        purgeConfig.lastPurge = now;
                        saveData();
                        logAction(guildId, 'Auto Purge', `Auto-deleted ${deleted.size} messages in ${channel.name}`);
                    }).catch(error => {
                        console.error('Auto purge error:', error);
                    });
                }
            }
        }
    }
}, 60000); // Check every minute

// Error handling
client.on('error', console.error);
client.on('warn', console.warn);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
