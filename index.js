require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Options, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');
const db = require('./db');
db.pragma('journal_mode = WAL');

// Inisialisasi Otomatis Tabel Database
db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        guild_id TEXT,
        type TEXT,
        category TEXT,
        amount INTEGER,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS budgets (
        user_id TEXT PRIMARY KEY,
        monthly_income INTEGER DEFAULT 0,
        wants_limit INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT PRIMARY KEY,
        recap_weekly_channel_id TEXT,
        recap_weekly_day INTEGER,
        recap_weekly_time TEXT,
        recap_monthly_channel_id TEXT,
        recap_monthly_date INTEGER,
        recap_monthly_time TEXT,
        timezone TEXT DEFAULT 'Asia/Jakarta'
    );
`);

// Pengaman Global
process.on('uncaughtException', (err) => console.error('❌ Error Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('❌ Error Unhandled Rejection:', reason));

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        GuildMemberManager: 0,
        UserManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        ThreadManager: 0,
    }),
});

function makeProgressBar(current, max, length = 10) {
    if (!max || max <= 0) return '⬜'.repeat(length) + ' 0%';
    const percentage = Math.round((current / max) * 100);
    const filled = Math.min(Math.round((current / max) * length), length);
    const empty = length - filled;
    
    // Pakai merah jika 100% atau lebih, pakai hijau jika masih di bawah limit
    const fillSymbol = percentage >= 100 ? '🟥' : '🟩';    
    return `${fillSymbol.repeat(filled)}${'⬜'.repeat(empty)} ${percentage}%`;
}

function getZonedTime(timeZone = 'Asia/Jakarta') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        weekday: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);

    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        day: days[map.weekday],
        date: parseInt(map.day, 10),
        timeStr: `${map.hour === '24' ? '00' : map.hour}:${map.minute}`
    };
}

function parseNominal(inputStr) {
    if (!inputStr) return null;
    let str = String(inputStr).toLowerCase().trim().replace(/,/g, '.');

    if (str.includes('juta') || str.includes('jt')) {
        const num = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(num) ? null : Math.round(num * 1000000);
    }
    if (str.includes('ribu') || str.includes('rb') || str.endsWith('k')) {
        const num = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(num) ? null : Math.round(num * 1000);
    }

    const cleanNum = str.replace(/[^0-9]/g, '');
    const parsed = parseInt(cleanNum, 10);
    return isNaN(parsed) ? null : parsed;
}

const commands = [
    new SlashCommandBuilder()
        .setName('catat')
        .setDescription('Mencatat transaksi keuangan Kakeibo via Formulir Pop-Up'),

    new SlashCommandBuilder()
        .setName('set-budget')
        .setDescription('Mengatur limit jajan (Wants) dan target gaji bulanan')
        .addStringOption(opt => opt.setName('limit_wants').setDescription('Limit jajan per bulan (Contoh: 1jt, 500k)').setRequired(true))
        .addStringOption(opt => opt.setName('pemasukan').setDescription('[Opsional] Gaji tetap bulanan jika ada').setRequired(false)),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Melihat ringkasan kondisi keuangan bulan ini'),

    new SlashCommandBuilder()
        .setName('riwayat')
        .setDescription('Melihat riwayat transaksi bulan-bulan sebelumnya')
        .addIntegerOption(opt => opt.setName('bulan').setDescription('Pilih bulan (1 - 12)').setRequired(true))
        .addIntegerOption(opt => opt.setName('tahun').setDescription('Pilih tahun (contoh: 2026)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('set-recap-weekly')
        .setDescription('Mengatur jadwal & channel rekap mingguan')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel khusus rekap mingguan').setRequired(true))
        .addIntegerOption(opt => opt.setName('hari').setDescription('Pilih hari').setRequired(true)
            .addChoices(
                { name: 'Minggu', value: 0 }, { name: 'Senin', value: 1 },
                { name: 'Selasa', value: 2 }, { name: 'Rabu', value: 3 },
                { name: 'Kamis', value: 4 }, { name: 'Jumat', value: 5 }, { name: 'Sabtu', value: 6 }
            ))
        .addStringOption(opt => opt.setName('jam').setDescription('Format HH:mm 24 jam (contoh: 23:59)').setRequired(true))
        .addStringOption(opt => opt.setName('zona_waktu').setDescription('Pilih zona waktu (Default: WIB)').setRequired(false)
            .addChoices(
                { name: 'WIB (Asia/Jakarta)', value: 'Asia/Jakarta' },
                { name: 'WITA (Asia/Makassar)', value: 'Asia/Makassar' },
                { name: 'WIT (Asia/Jayapura)', value: 'Asia/Jayapura' },
                { name: 'UTC / GMT', value: 'UTC' }
            )),

    new SlashCommandBuilder()
        .setName('set-recap-monthly')
        .setDescription('Mengatur jadwal & channel rekap bulanan')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel khusus rekap bulanan').setRequired(true))
        .addIntegerOption(opt => opt.setName('tanggal').setDescription('Pilih tanggal (1 - 31)').setRequired(true))
        .addStringOption(opt => opt.setName('jam').setDescription('Format HH:mm 24 jam (contoh: 08:00)').setRequired(true))
        .addStringOption(opt => opt.setName('zona_waktu').setDescription('Pilih zona waktu (Default: WIB)').setRequired(false)
            .addChoices(
                { name: 'WIB (Asia/Jakarta)', value: 'Asia/Jakarta' },
                { name: 'WITA (Asia/Makassar)', value: 'Asia/Makassar' },
                { name: 'WIT (Asia/Jayapura)', value: 'Asia/Jayapura' },
                { name: 'UTC / GMT', value: 'UTC' }
            )),

    new SlashCommandBuilder()
        .setName('kakeibo')
        .setDescription('Penjelasan 4 pilar metode Kakeibo')
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
    console.log(`Bot Kakeibo aktif sebagai ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Slash Commands berhasil didaftarkan!');
    } catch (err) {
        console.error('Gagal menyinkronkan command:', err);
    }

    setInterval(checkScheduledRecaps, 60000);
});

client.on('interactionCreate', async (interaction) => {
    // 1. Jika user mengetik /catat -> Munculkan Formulir Pop-Up
    if (interaction.isChatInputCommand() && interaction.commandName === 'catat') {
        const modal = new ModalBuilder()
            .setCustomId('modal_catat')
            .setTitle('📝 Catat Transaksi Kakeibo');

        const tipeInput = new TextInputBuilder()
            .setCustomId('input_tipe')
            .setLabel('Tipe Transaksi')
            .setPlaceholder('Ketik: Pemasukan ATAU Pengeluaran')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const nominalInput = new TextInputBuilder()
            .setCustomId('input_nominal')
            .setLabel('Nominal')
            .setPlaceholder('Contoh: 10k, 50000, 1jt, 100rb')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const kategoriInput = new TextInputBuilder()
            .setCustomId('input_kategori')
            .setLabel('Kategori (Needs/Wants/Culture/Unplanned)')
            .setPlaceholder('Needs/Wants/Culture/Unplanned (Kosongkan jika Pemasukan)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const ketInput = new TextInputBuilder()
            .setCustomId('input_keterangan')
            .setLabel('Keterangan / Catatan')
            .setPlaceholder('Contoh: Beli kopi, Makan warteg')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(tipeInput),
            new ActionRowBuilder().addComponents(nominalInput),
            new ActionRowBuilder().addComponents(kategoriInput),
            new ActionRowBuilder().addComponents(ketInput)
        );

        return await interaction.showModal(modal);
    }

    // Pengecekan awal untuk Slash Command selain /catat
    if (interaction.isChatInputCommand()) {
        try {
            await interaction.deferReply();
        } catch (err) {
            console.error('❌ Defer gagal:', err);
            return;
        }
    }

    // 2. Olah data saat user klik Submit pada Formulir Pop-Up
    if (interaction.isModalSubmit() && interaction.customId === 'modal_catat') {
        try {
            await interaction.deferReply();

            const { user, guildId } = interaction;
            const currentGuildId = guildId || 'DM';

            const tipeRaw = interaction.fields.getTextInputValue('input_tipe').toLowerCase().trim();
            const nominalInput = interaction.fields.getTextInputValue('input_nominal');
            const kategoriRaw = interaction.fields.getTextInputValue('input_kategori').trim();
            const ket = interaction.fields.getTextInputValue('input_keterangan') || '-';

            const nominal = parseNominal(nominalInput);

            if (!nominal || nominal <= 0) {
                return interaction.editReply({ content: '⚠️ Format nominal tidak valid! Contoh: `10000`, `10k`, `10rb`, `10jt`.' });
            }

            if (tipeRaw !== 'pemasukan' && tipeRaw !== 'pengeluaran') {
                return interaction.editReply({ content: '⚠️ Tipe transaksi harus diisi **pemasukan** atau **pengeluaran**!' });
            }

            let finalKategori = tipeRaw === 'pemasukan' ? 'Pemasukan' : kategoriRaw;

            if (tipeRaw === 'pengeluaran') {
                const validCategories = ['Needs', 'Wants', 'Culture', 'Unplanned'];
                const matched = validCategories.find(c => c.toLowerCase() === kategoriRaw.toLowerCase());
                
                if (!matched) {
                    return interaction.editReply({ content: '⚠️ Kategori pengeluaran wajib diisi salah satu dari: **Needs**, **Wants**, **Culture**, atau **Unplanned**!' });
                }
                finalKategori = matched;
            }

            // Simpan transaksi baru
            db.prepare('INSERT INTO transactions (user_id, guild_id, type, category, amount, description) VALUES (?, ?, ?, ?, ?, ?)')
              .run(user.id, currentGuildId, tipeRaw, finalKategori, nominal, ket);

            // Hitung Total Keuangan
            const balanceRow = db.prepare(`
                SELECT 
                    COALESCE(SUM(CASE WHEN type = 'pemasukan' THEN amount ELSE 0 END), 0) - 
                    COALESCE(SUM(CASE WHEN type = 'pengeluaran' THEN amount ELSE 0 END), 0) as balance
                FROM transactions WHERE user_id = ?
            `).get(user.id);

            const currentBalance = balanceRow ? balanceRow.balance : 0;

            let warningMessage = null;
            if (tipeRaw === 'pengeluaran' && finalKategori === 'Wants') {
                const budget = db.prepare('SELECT wants_limit FROM budgets WHERE user_id = ?').get(user.id);
                if (budget && budget.wants_limit > 0) {
                    const row = db.prepare(`
                        SELECT SUM(amount) as total FROM transactions 
                        WHERE user_id = ? AND category = 'Wants' AND type = 'pengeluaran'
                        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
                    `).get(user.id);
                    const totalWants = (row && row.total) ? row.total : 0;

                    if (totalWants > budget.wants_limit) {
                        warningMessage = `⚠️ **Alert:** Pengeluaran **Wants** bulan ini (Rp${totalWants.toLocaleString('id-ID')}) telah melebihi batas (Rp${budget.wants_limit.toLocaleString('id-ID')})!`;
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Transaksi Berhasil Dicatat')
                .setColor(warningMessage ? 0xFF0000 : 0x2ECC71)
                .addFields(
                    { name: 'Tipe', value: tipeRaw.toUpperCase(), inline: true },
                    { name: 'Kategori', value: finalKategori, inline: true },
                    { name: 'Nominal', value: `Rp${nominal.toLocaleString('id-ID')}`, inline: true },
                    { name: 'Keterangan', value: ket, inline: false },
                    { name: '💰 Total Keuangan Sekarang', value: `Rp${currentBalance.toLocaleString('id-ID')}`, inline: false }
                )
                .setTimestamp();

            const replyPayload = { embeds: [embed] };
            if (warningMessage) replyPayload.content = warningMessage;

            await interaction.editReply(replyPayload);
        } catch (error) {
            console.error('❌ Error submit modal:', error);
            await interaction.editReply({ content: '⚠️ Terjadi kesalahan saat menyimpan data.' }).catch(() => {});
        }
    }

    // 3. Logic untuk Slash Command lainnya (/set-budget, /status, /riwayat, dll.)
    if (interaction.isChatInputCommand()) {
        try {
            const { commandName, options, user, guildId } = interaction;
            const currentGuildId = guildId || 'DM';

            if (commandName === 'set-budget') {
                const incomeInput = options.getString('pemasukan');
                const limitWantsInput = options.getString('limit_wants');

                const income = parseNominal(incomeInput);
                const limitWants = parseNominal(limitWantsInput);

                const currentBudget = db.prepare('SELECT * FROM budgets WHERE user_id = ?').get(user.id) || {};
                const newIncome = income !== null ? income : (currentBudget.monthly_income || 0);
                const newLimit = limitWants !== null ? limitWants : (currentBudget.wants_limit || 0);

                db.prepare(`
                    INSERT INTO budgets (user_id, monthly_income, wants_limit) VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET monthly_income = excluded.monthly_income, wants_limit = excluded.wants_limit
                `).run(user.id, newIncome, newLimit);

                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Pengaturan Budget Berhasil Disimpan')
                    .setColor(0x3498DB)
                    .addFields(
                        { name: 'Pemasukan Bulanan', value: `Rp${newIncome.toLocaleString('id-ID')}`, inline: true },
                        { name: 'Limit Kategori Wants', value: `Rp${newLimit.toLocaleString('id-ID')}`, inline: true }
                    );

                await interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'status') {
                const currentMonth = new Date().toISOString().slice(0, 7);
                const budget = db.prepare('SELECT * FROM budgets WHERE user_id = ?').get(user.id) || { monthly_income: 0, wants_limit: 0 };

                const rows = db.prepare(`
                    SELECT category, type, SUM(amount) as total FROM transactions 
                    WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
                    GROUP BY category, type
                `).all(user.id, currentMonth);

                let totalIncome = budget.monthly_income;
                let totalExpense = 0;
                const summary = { Needs: 0, Wants: 0, Culture: 0, Unplanned: 0 };

                rows.forEach(r => {
                    if (r.type === 'pengeluaran') {
                        summary[r.category] = r.total;
                        totalExpense += r.total;
                    } else if (r.type === 'pemasukan') {
                        totalIncome += r.total;
                    }
                });

                const netBalance = totalIncome - totalExpense;
                const wantsProgressBar = makeProgressBar(summary.Wants, budget.wants_limit);

                const embed = new EmbedBuilder()
                    .setTitle('📊 Status Keuangan Kakeibo Bulan Ini')
                    .setColor(0x3498DB)
                    .setDescription(
                        `🟢 **Pemasukan:** Rp${totalIncome.toLocaleString('id-ID')}\n` +
                        `🔴 **Total Pengeluaran:** Rp${totalExpense.toLocaleString('id-ID')}\n\n` +
                        `📌 **Rincian 4 Pilar:**\n` +
                        `• **Needs:** Rp${summary.Needs.toLocaleString('id-ID')}\n` +
                        `• **Wants:** Rp${summary.Wants.toLocaleString('id-ID')} / Rp${budget.wants_limit.toLocaleString('id-ID')} ${wantsProgressBar}\n` +
                        `• **Culture:** Rp${summary.Culture.toLocaleString('id-ID')}\n` +
                        `• **Unplanned:** Rp${summary.Unplanned.toLocaleString('id-ID')}\n\n` +
                        `💡 **Sisa Saldo Bersih:** Rp${netBalance.toLocaleString('id-ID')}`
                    );

                await interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'riwayat') {
                const bulan = options.getInteger('bulan');
                const tahun = options.getInteger('tahun') || new Date().getFullYear();
                const formattedMonth = `${tahun}-${String(bulan).padStart(2, '0')}`;

                const rows = db.prepare(`
                    SELECT category, type, SUM(amount) as total FROM transactions 
                    WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
                    GROUP BY category, type
                `).all(user.id, formattedMonth);

                if (rows.length === 0) {
                    return interaction.editReply({ content: `Nggak ada catatan transaksi untuk periode **${formattedMonth}**.` });
                }

                let totalIncome = 0;
                let totalExpense = 0;
                const summary = { Needs: 0, Wants: 0, Culture: 0, Unplanned: 0 };

                rows.forEach(r => {
                    if (r.type === 'pengeluaran') {
                        summary[r.category] = r.total;
                        totalExpense += r.total;
                    } else {
                        totalIncome += r.total;
                    }
                });

                const embed = new EmbedBuilder()
                    .setTitle(`📜 Riwayat Keuangan Periode ${formattedMonth}`)
                    .setColor(0x9B59B6)
                    .addFields(
                        { name: '🟢 Pemasukan', value: `Rp${totalIncome.toLocaleString('id-ID')}`, inline: true },
                        { name: '🔴 Pengeluaran', value: `Rp${totalExpense.toLocaleString('id-ID')}`, inline: true },
                        { name: '📌 Needs', value: `Rp${summary.Needs.toLocaleString('id-ID')}`, inline: true },
                        { name: '📌 Wants', value: `Rp${summary.Wants.toLocaleString('id-ID')}`, inline: true },
                        { name: '📌 Culture', value: `Rp${summary.Culture.toLocaleString('id-ID')}`, inline: true },
                        { name: '📌 Unplanned', value: `Rp${summary.Unplanned.toLocaleString('id-ID')}`, inline: true }
                    );

                await interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'set-recap-weekly') {
                const channel = options.getChannel('channel');
                const hari = options.getInteger('hari');
                const jam = options.getString('jam');
                const timezone = options.getString('zona_waktu') || 'Asia/Jakarta';

                db.prepare(`
                    INSERT INTO settings (guild_id, recap_weekly_channel_id, recap_weekly_day, recap_weekly_time, timezone) 
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET 
                        recap_weekly_channel_id = excluded.recap_weekly_channel_id,
                        recap_weekly_day = excluded.recap_weekly_day, 
                        recap_weekly_time = excluded.recap_weekly_time,
                        timezone = excluded.timezone
                `).run(currentGuildId, channel.id, hari, jam, timezone);

                const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                await interaction.editReply({ content: `✅ Rekap mingguan diatur setiap **${days[hari]}** pukul **${jam}** (${timezone}) di ${channel}.` });
                
                try {
                    await channel.send('🔔 Channel ini dikonfigurasi untuk menerima laporan **Rekap Mingguan**!');
                } catch (err) {}
            }

            if (commandName === 'set-recap-monthly') {
                const channel = options.getChannel('channel');
                const tanggal = options.getInteger('tanggal');
                const jam = options.getString('jam');
                const timezone = options.getString('zona_waktu') || 'Asia/Jakarta';

                db.prepare(`
                    INSERT INTO settings (guild_id, recap_monthly_channel_id, recap_monthly_date, recap_monthly_time, timezone) 
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET 
                        recap_monthly_channel_id = excluded.recap_monthly_channel_id,
                        recap_monthly_date = excluded.recap_monthly_date, 
                        recap_monthly_time = excluded.recap_monthly_time,
                        timezone = excluded.timezone
                `).run(currentGuildId, channel.id, tanggal, jam, timezone);

                await interaction.editReply({ content: `✅ Rekap bulanan diatur setiap tanggal **${tanggal}** pukul **${jam}** (${timezone}) di ${channel}.` });
                
                try {
                    await channel.send('🔔 Channel ini dikonfigurasi untuk menerima laporan **Rekap Bulanan**!');
                } catch (err) {}
            }

            if (commandName === 'kakeibo') {
                const embed = new EmbedBuilder()
                    .setTitle('📘 Panduan 4 Pilar Kakeibo')
                    .setColor(0x9B59B6)
                    .setDescription(
                        '🟢 **Needs:** Kebutuhan pokok (Makan, Tagihan, Transportasi)\n' +
                        '🟡 **Wants:** Keinginan & Hiburan (Game, Jajan, Hobi) - *Memiliki Limit*\n' +
                        '🔵 **Culture:** Wawasan & Kebudayaan (Buku, Film, Konser)\n' +
                        '🔴 **Unplanned:** Darurat & Tak Terduga (Obat, Servis, Kado)'
                    );

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('❌ Error saat mengeksekusi command:', error);
            await interaction.editReply({ content: '⚠️ Terjadi kesalahan saat memproses perintah ini.' }).catch(() => {});
        }
    }
});

async function checkScheduledRecaps() {
    try {
        const allSettings = db.prepare('SELECT * FROM settings').all();

        for (const setting of allSettings) {
            const tz = setting.timezone || 'Asia/Jakarta';
            const { day, date, timeStr } = getZonedTime(tz);

            // 1. REKAP MINGGUAN
            if (setting.recap_weekly_channel_id && setting.recap_weekly_day === day && setting.recap_weekly_time === timeStr) {
                const channel = await client.channels.fetch(setting.recap_weekly_channel_id).catch(() => null);
                if (channel) {
                    const rows = db.prepare(`
                        SELECT category, type, SUM(amount) as total FROM transactions 
                        WHERE guild_id = ? AND created_at >= datetime('now', '-7 days')
                        GROUP BY category, type
                    `).all(setting.guild_id);

                    let totalIncome = 0;
                    let totalExpense = 0;
                    const summary = { Needs: 0, Wants: 0, Culture: 0, Unplanned: 0 };

                    rows.forEach(r => {
                        if (r.type === 'pengeluaran') {
                            summary[r.category] = r.total;
                            totalExpense += r.total;
                        } else if (r.type === 'pemasukan') {
                            totalIncome += r.total;
                        }
                    });

                    const netBalance = totalIncome - totalExpense;

                    const embed = new EmbedBuilder()
                        .setTitle('📅 Rekap Pengeluaran Mingguan Kakeibo')
                        .setColor(0xF1C40F)
                        .setDescription(
                            `🟢 **Total Pemasukan (7 Hari):** Rp${totalIncome.toLocaleString('id-ID')}\n` +
                            `🔴 **Total Pengeluaran (7 Hari):** Rp${totalExpense.toLocaleString('id-ID')}\n` +
                            `💰 **Sisa Saldo Pekan Ini:** Rp${netBalance.toLocaleString('id-ID')}\n\n` +
                            `📌 **Rincian Pengeluaran:**\n` +
                            `• Needs: Rp${summary.Needs.toLocaleString('id-ID')}\n` +
                            `• Wants: Rp${summary.Wants.toLocaleString('id-ID')}\n` +
                            `• Culture: Rp${summary.Culture.toLocaleString('id-ID')}\n` +
                            `• Unplanned: Rp${summary.Unplanned.toLocaleString('id-ID')}\n\n` +
                            `💡 *Refleksi:* Apakah pengeluaran Wants minggu ini sudah sesuai target?`
                        );
                    await channel.send({ embeds: [embed] }).catch(() => {});
                }
            }

            // 2. REKAP BULANAN
            if (setting.recap_monthly_channel_id && setting.recap_monthly_date === date && setting.recap_monthly_time === timeStr) {
                const channel = await client.channels.fetch(setting.recap_monthly_channel_id).catch(() => null);
                if (channel) {
                    const currentMonth = new Date().toISOString().slice(0, 7);
                    const rows = db.prepare(`
                        SELECT category, type, SUM(amount) as total FROM transactions 
                        WHERE guild_id = ? AND strftime('%Y-%m', created_at) = ?
                        GROUP BY category, type
                    `).all(setting.guild_id, currentMonth);

                    let totalIncome = 0;
                    let totalExpense = 0;
                    const summary = { Needs: 0, Wants: 0, Culture: 0, Unplanned: 0 };

                    rows.forEach(r => {
                        if (r.type === 'pengeluaran') {
                            summary[r.category] = r.total;
                            totalExpense += r.total;
                        } else if (r.type === 'pemasukan') {
                            totalIncome += r.total;
                        }
                    });

                    const netBalance = totalIncome - totalExpense;

                    const embed = new EmbedBuilder()
                        .setTitle(`📆 Rekap Bulanan Kakeibo (${currentMonth})`)
                        .setColor(0xE67E22)
                        .setDescription(
                            `🟢 **Total Pemasukan Bulan Ini:** Rp${totalIncome.toLocaleString('id-ID')}\n` +
                            `🔴 **Total Pengeluaran Bulan Ini:** Rp${totalExpense.toLocaleString('id-ID')}\n` +
                            `💰 **Sisa Saldo Bersih:** Rp${netBalance.toLocaleString('id-ID')}\n\n` +
                            `📌 **Rincian Pengeluaran:**\n` +
                            `• Needs: Rp${summary.Needs.toLocaleString('id-ID')}\n` +
                            `• Wants: Rp${summary.Wants.toLocaleString('id-ID')}\n` +
                            `• Culture: Rp${summary.Culture.toLocaleString('id-ID')}\n` +
                            `• Unplanned: Rp${summary.Unplanned.toLocaleString('id-ID')}`
                        );
                    await channel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error('Error rekap:', err);
    }
}

client.login(process.env.DISCORD_TOKEN);