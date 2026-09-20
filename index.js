require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Options, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} = require('discord.js');
const db = require('./db');

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

// Variabel Bawaan (Urut Abjad)
const DEFAULT_CATEGORIES = {
    'Needs': [
        'Air', 'Belanja Bulanan', 'Bensin', 'Internet', 'Kebutuhan Pribadi', 
        'Kebutuhan Rumah', 'Kewajiban / Cicilan', 'Lainnya', 'Obat & Kesehatan', 
        'Pajak / Administrasi', 'Pendidikan', 'Pulsa', 'Sewa / Kos', 'Tagihan Listrik', 'Transportasi'
    ],
    'Wants': [
        'Game & Entertainment', 'Jajan'
    ],
    'Improvisasi Diri': [
        'Hobi Produktif', 'Pengembangan Skill', 'Peralatan Kerja', 'Perawatan Diri'
    ],
    'Unplanned': [
        'Darurat', 'Denda / Biaya Tak Terduga', 'Kehilangan / Kerusakan', 
        'Keperluan Keluarga Mendadak', 'Kesehatan Mendadak', 'Kebutuhan Mendadak', 
        'Kendaraan', 'Pengeluaran Impulsif', 'Perbaikan Barang'
    ]
};

function makeProgressBar(current, max, length = 8) {
    if (!max || max <= 0) return '';
    const percentage = Math.round((current / max) * 100);
    const filled = Math.min(Math.round((current / max) * length), length);
    const empty = length - filled;
    const fillSymbol = percentage >= 100 ? '🟥' : '🟩';    
    return `[${fillSymbol.repeat(filled)}${'⬜'.repeat(empty)}] ${percentage}%`;
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

const commands = [
    new SlashCommandBuilder()
        .setName('catat')
        .setDescription('Mencatat transaksi keuangan Kakeibo')
        .addStringOption(opt => opt.setName('tipe').setDescription('Tipe transaksi').setRequired(true)
            .addChoices({ name: 'Pengeluaran', value: 'pengeluaran' }, { name: 'Pemasukan', value: 'pemasukan' }))
        .addStringOption(opt => opt.setName('nominal').setDescription('Nominal transaksi (contoh: 100k, 1jt, 50000)').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Nama item / sub-kategori (Wajib jika Pengeluaran)').setAutocomplete(true).setRequired(false))
        .addStringOption(opt => opt.setName('pilar').setDescription('Pilar Kakeibo (Wajib jika Pengeluaran)').setRequired(false)
            .addChoices(
                { name: 'Needs', value: 'Needs' },
                { name: 'Wants', value: 'Wants' },
                { name: 'Improvisasi Diri', value: 'Improvisasi Diri' },
                { name: 'Unplanned', value: 'Unplanned' }
            ))
        .addStringOption(opt => opt.setName('keterangan').setDescription('Catatan tambahan').setRequired(false)),

    new SlashCommandBuilder()
        .setName('hapus-transaksi')
        .setDescription('Menghapus transaksi yang salah input berdasarkan ID')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID Transaksi (Cek di /riwayat atau /status)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('tambah-kategori')
        .setDescription('Menambahkan item/variabel baru ke dalam pilar tertentu')
        .addStringOption(opt => opt.setName('pilar').setDescription('Pilih pilar').setRequired(true)
            .addChoices(
                { name: 'Needs', value: 'Needs' },
                { name: 'Wants', value: 'Wants' },
                { name: 'Improvisasi Diri', value: 'Improvisasi Diri' },
                { name: 'Unplanned', value: 'Unplanned' }
            ))
        .addStringOption(opt => opt.setName('nama_item').setDescription('Nama variabel/item baru').setRequired(true)),

    new SlashCommandBuilder()
        .setName('delete-kategori')
        .setDescription('Menghapus kategori kustom yang pernah dibuat')
        .addStringOption(opt => opt.setName('pilar').setDescription('Pilih pilar kategori').setRequired(true)
            .addChoices(
                { name: 'Needs', value: 'Needs' },
                { name: 'Wants', value: 'Wants' },
                { name: 'Improvisasi Diri', value: 'Improvisasi Diri' },
                { name: 'Unplanned', value: 'Unplanned' }
            ))
        .addStringOption(opt => opt.setName('item_name').setDescription('Nama item/kategori kustom yang ingin dihapus').setAutocomplete(true).setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-limit')
        .setDescription('Mengatur limit pengeluaran per item (Needs/Wants/dll)')
        .addStringOption(opt => opt.setName('pilar').setDescription('Pilih pilar').setRequired(true)
            .addChoices(
                { name: 'Needs', value: 'Needs' },
                { name: 'Wants', value: 'Wants' },
                { name: 'Improvisasi Diri', value: 'Improvisasi Diri' },
                { name: 'Unplanned', value: 'Unplanned' }
            ))
        .addStringOption(opt => opt.setName('item').setDescription('Nama item/kategori').setAutocomplete(true).setRequired(true))
        .addStringOption(opt => opt.setName('limit').setDescription('Batas maksimal budget (contoh: 1jt, 500k)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-income')
        .setDescription('Mengatur target pemasukan/gaji tetap bulanan')
        .addStringOption(opt => opt.setName('pemasukan').setDescription('Nominal gaji/pemasukan bulanan').setRequired(true)),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Melihat ringkasan kondisi keuangan bulan ini per item'),

    new SlashCommandBuilder()
        .setName('riwayat')
        .setDescription('Melihat daftar riwayat transaksi lengkap beserta ID')
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

    db.prepare(`
        CREATE TABLE IF NOT EXISTS deleted_defaults (
            user_id TEXT,
            pillar TEXT,
            item_name TEXT,
            PRIMARY KEY (user_id, pillar, item_name)
        )
    `).run();

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
    // FITUR AUTOCOMPLETE
    if (interaction.isAutocomplete()) {
        try {
            const focusedOption = interaction.options.getFocused(true);
            const selectedPilar = interaction.options.getString('pilar');

            // PERBAIKAN 1 & 2: Gunakan interaction.user.id dan SELECT pillar, item_name
            const deletedDefaults = db.prepare(
                'SELECT pillar, item_name FROM deleted_defaults WHERE user_id = ?'
            ).all(interaction.user.id);
            const deletedSet = new Set(deletedDefaults.map(d => `${d.pillar}:${d.item_name.toLowerCase()}`));

            if (focusedOption.name === 'item') {
                let choices = [];

                if (selectedPilar && DEFAULT_CATEGORIES[selectedPilar]) {
                    // Masukkan default yang belum dihapus
                    DEFAULT_CATEGORIES[selectedPilar].forEach(item => {
                        if (!deletedSet.has(`${selectedPilar}:${item.toLowerCase()}`)) {
                            choices.push(item);
                        }
                    });

                    // Masukkan custom categories
                    const customRows = db.prepare(
                        'SELECT item_name FROM custom_categories WHERE user_id = ? AND pillar = ?'
                    ).all(interaction.user.id, selectedPilar);

                    customRows.forEach(row => {
                        if (!choices.includes(row.item_name)) choices.push(row.item_name);
                    });
                } else {
                    // Jika pilar belum dipilih
                    Object.entries(DEFAULT_CATEGORIES).forEach(([pillarName, list]) => {
                        list.forEach(item => {
                            if (!deletedSet.has(`${pillarName}:${item.toLowerCase()}`)) {
                                choices.push(item);
                            }
                        });
                    });
                    const customRows = db.prepare(
                        'SELECT item_name FROM custom_categories WHERE user_id = ?'
                    ).all(interaction.user.id);

                    customRows.forEach(row => {
                        if (!choices.includes(row.item_name)) choices.push(row.item_name);
                    });
                }

                const filtered = choices
                    .filter(choice => choice.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                await interaction.respond(
                    filtered.map(choice => ({ name: choice, value: choice }))
                );
            } 
            
            else if (focusedOption.name === 'item_name') {
                let choices = [];

                if (selectedPilar && DEFAULT_CATEGORIES[selectedPilar]) {
                    // Tampilkan default yang belum dihapus
                    DEFAULT_CATEGORIES[selectedPilar].forEach(item => {
                        if (!deletedSet.has(`${selectedPilar}:${item.toLowerCase()}`)) {
                            choices.push(item);
                        }
                    });

                    // Tampilkan custom categories
                    const customRows = db.prepare(
                        'SELECT item_name FROM custom_categories WHERE user_id = ? AND pillar = ?'
                    ).all(interaction.user.id, selectedPilar);

                    customRows.forEach(row => {
                        if (!choices.includes(row.item_name)) choices.push(row.item_name);
                    });
                }

                const filtered = choices
                    .filter(choice => choice.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                await interaction.respond(
                    filtered.map(choice => ({ name: choice, value: choice }))
                );
            }
        } catch (err) {
            console.error('❌ Error autocomplete:', err);
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply();
    } catch (err) {
        return;
    }

    const { commandName, options, user, guildId } = interaction;
    const currentGuildId = guildId || 'DM';

    try {
        // 1. COMMAND: /catat
        if (commandName === 'catat') {
            const tipe = options.getString('tipe');
            const pilarInput = options.getString('pilar');
            const itemInput = options.getString('item')?.trim();
            const nominalInput = options.getString('nominal');
            const ket = options.getString('keterangan') || '-';

            const nominal = parseNominal(nominalInput);
            if (!nominal || nominal <= 0) {
                return interaction.editReply({ content: '⚠️ Format nominal tidak valid! Contoh: `100k`, `1jt`, `200000`.' });
            }

            if (tipe === 'pengeluaran') {
                if (!itemInput) {
                    return interaction.editReply({ content: '⚠️ Untuk pengeluaran, Anda wajib mengisi nama **item**!' });
                }
                if (!pilarInput) {
                    return interaction.editReply({ content: '⚠️ Untuk pengeluaran, Anda wajib memilih **Pilar** (Needs, Wants, Improvisasi Diri, Unplanned)!' });
                }
            }

            const finalItem = itemInput || (tipe === 'pemasukan' ? 'Pemasukan' : 'Lainnya');
            const finalPilar = tipe === 'pemasukan' ? 'Pemasukan' : pilarInput;

            db.prepare(`
                INSERT INTO transactions (user_id, guild_id, type, pillar, item, amount, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(user.id, currentGuildId, tipe, finalPilar, finalItem, nominal, ket);

            // Cek Limit Item
            let warningMessage = null;
            if (tipe === 'pengeluaran') {
                const limitRow = db.prepare('SELECT limit_amount FROM item_limits WHERE user_id = ? AND pillar = ? AND LOWER(item) = LOWER(?)')
                    .get(user.id, finalPilar, finalItem);
                
                if (limitRow && limitRow.limit_amount > 0) {
                    const currentMonth = new Date().toISOString().slice(0, 7);
                    const totalUsedRow = db.prepare(`
                        SELECT SUM(amount) as total FROM transactions 
                        WHERE user_id = ? AND pillar = ? AND LOWER(item) = LOWER(?) AND type = 'pengeluaran'
                        AND strftime('%Y-%m', created_at) = ?
                    `).get(user.id, finalPilar, finalItem, currentMonth);

                    const totalUsed = totalUsedRow ? (totalUsedRow.total || 0) : 0;
                    if (totalUsed > limitRow.limit_amount) {
                        warningMessage = `⚠️ **Alert:** Pengeluaran untuk **${finalItem}** (Rp${totalUsed.toLocaleString('id-ID')}) telah melebihi limit yang ditentukan (Rp${limitRow.limit_amount.toLocaleString('id-ID')})!`;
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Transaksi Berhasil Dicatat')
                .setColor(warningMessage ? 0xFF0000 : 0x2ECC71)
                .addFields(
                    { name: 'Tipe', value: tipe.toUpperCase(), inline: true },
                    { name: 'Pilar', value: finalPilar, inline: true },
                    { name: 'Item', value: finalItem, inline: true },
                    { name: 'Nominal', value: `Rp${nominal.toLocaleString('id-ID')}`, inline: true },
                    { name: 'Keterangan', value: ket, inline: true }
                )
                .setTimestamp();

            const payload = { embeds: [embed] };
            if (warningMessage) payload.content = warningMessage;
            return interaction.editReply(payload);
        }

        // 2. COMMAND: /hapus-transaksi
        if (commandName === 'hapus-transaksi') {
            const id = options.getInteger('id');
            const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, user.id);

            if (!tx) {
                return interaction.editReply({ content: `⚠️ Transaksi dengan ID **#${id}** tidak ditemukan atau bukan milik kamu.` });
            }

            db.prepare('DELETE FROM transactions WHERE id = ?').run(id);

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Transaksi Berhasil Dihapus')
                .setColor(0xE74C3C)
                .setDescription(`Transaksi **#${id}** (${tx.item} - Rp${tx.amount.toLocaleString('id-ID')}) telah dihapus dari database.`);

            return interaction.editReply({ embeds: [embed] });
        }

        // 3. COMMAND: /tambah-kategori
        if (commandName === 'tambah-kategori') {
            const pilar = options.getString('pilar');
            const namaItem = options.getString('nama_item').trim();

            try {
                db.prepare('INSERT INTO custom_categories (user_id, pillar, item_name) VALUES (?, ?, ?)').run(user.id, pilar, namaItem);
                return interaction.editReply({ content: `✅ Item **${namaItem}** berhasil ditambahkan ke pilar **${pilar}**!` });
            } catch (err) {
                return interaction.editReply({ content: `⚠️ Item **${namaItem}** sudah ada di pilar **${pilar}**.` });
            }
        }

        // 3.1. COMMAND: /delete-kategori
        if (commandName === 'delete-kategori') {
            const pilar = options.getString('pilar');
            const itemName = options.getString('item_name').trim();

            // 1. Cek apakah itu kategori kustom
            const customRow = db.prepare(`
                SELECT * FROM custom_categories 
                WHERE user_id = ? AND pillar = ? AND LOWER(item_name) = LOWER(?)
            `).get(user.id, pilar, itemName);

            if (customRow) {
                db.prepare('DELETE FROM custom_categories WHERE id = ?').run(customRow.id);
                return interaction.editReply({ 
                    content: `🗑️ Kategori kustom **"${customRow.item_name}"** di pilar **${pilar}** berhasil dihapus!` 
                });
            }

            // 2. Cek apakah itu kategori bawaan (hard-coded)
            const isDefault = DEFAULT_CATEGORIES[pilar]?.some(
                item => item.toLowerCase() === itemName.toLowerCase()
            );

            if (isDefault) {
                try {
                    db.prepare(`
                        INSERT INTO deleted_defaults (user_id, pillar, item_name) 
                        VALUES (?, ?, ?)
                    `).run(user.id, pilar, itemName);

                    return interaction.editReply({ 
                        content: `🗑️ Kategori bawaan **"${itemName}"** di pilar **${pilar}** berhasil disembunyikan/dihapus dari daftar kamu!` 
                    });
                } catch (err) {
                    return interaction.editReply({ 
                        content: `⚠️ Kategori **"${itemName}"** tersebut sudah pernah dihapus sebelumnya.` 
                    });
                }
            }

            // Jika tidak ditemukan di keduanya
            return interaction.editReply({ 
                content: `❌ Kategori **"${itemName}"** tidak ditemukan di pilar **${pilar}**.` 
            });
        }

        // 4. COMMAND: /set-limit
        if (commandName === 'set-limit') {
            const pilar = options.getString('pilar');
            const item = options.getString('item').trim();
            const limitInput = options.getString('limit');
            const limitVal = parseNominal(limitInput);

            if (!limitVal || limitVal <= 0) {
                return interaction.editReply({ content: '⚠️ Format limit nominal tidak valid!' });
            }

            db.prepare(`
                INSERT INTO item_limits (user_id, pillar, item, limit_amount) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, pillar, item) DO UPDATE SET limit_amount = excluded.limit_amount
            `).run(user.id, pilar, item, limitVal);

            return interaction.editReply({ content: `🎯 Limit untuk **${item}** (${pilar}) berhasil diatur sebesar **Rp${limitVal.toLocaleString('id-ID')}** per bulan.` });
        }

        // 5. COMMAND: /set-income
        if (commandName === 'set-income') {
            const incomeInput = options.getString('pemasukan');
            const incomeVal = parseNominal(incomeInput);

            if (!incomeVal || incomeVal <= 0) {
                return interaction.editReply({ content: '⚠️ Format pemasukan tidak valid!' });
            }

            db.prepare(`
                INSERT INTO budgets (user_id, monthly_income) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET monthly_income = excluded.monthly_income
            `).run(user.id, incomeVal);

            return interaction.editReply({ content: `💵 Pemasukan tetap bulanan kamu berhasil diatur ke **Rp${incomeVal.toLocaleString('id-ID')}**.` });
        }

        // 6. COMMAND: /status
        if (commandName === 'status') {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const budgetRow = db.prepare('SELECT monthly_income FROM budgets WHERE user_id = ?').get(user.id);
            const fixedIncome = budgetRow ? budgetRow.monthly_income : 0;

            const txRows = db.prepare(`
                SELECT pillar, item, type, SUM(amount) as total 
                FROM transactions 
                WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
                GROUP BY pillar, item, type
            `).all(user.id, currentMonth);

            const limitsRows = db.prepare('SELECT pillar, item, limit_amount FROM item_limits WHERE user_id = ?').all(user.id);
            const limitsMap = {};
            limitsRows.forEach(l => { limitsMap[`${l.pillar}:${l.item.toLowerCase()}`] = l.limit_amount; });

            let extraIncome = 0;
            let totalExpense = 0;
            const pillarsData = { 'Needs': {}, 'Wants': {}, 'Improvisasi Diri': {}, 'Unplanned': {} };

            txRows.forEach(r => {
                if (r.type === 'pemasukan') {
                    extraIncome += r.total;
                } else {
                    totalExpense += r.total;
                    if (!pillarsData[r.pillar]) pillarsData[r.pillar] = {};
                    pillarsData[r.pillar][r.item] = r.total;
                }
            });

            const totalIncome = fixedIncome + extraIncome;
            const netBalance = totalIncome - totalExpense;

            let description = `🟢 **Total Pemasukan:** Rp${totalIncome.toLocaleString('id-ID')}\n` +
                              `🔴 **Total Pengeluaran:** Rp${totalExpense.toLocaleString('id-ID')}\n` +
                              `💡 **Sisa Saldo Bersih:** Rp${netBalance.toLocaleString('id-ID')}\n\n` +
                              `📌 **Rincian Pengeluaran Per Item:**\n`;

            for (const pilar of ['Needs', 'Wants', 'Improvisasi Diri', 'Unplanned']) {
                description += `\n**${pilar}:**\n`;
                const itemsObj = pillarsData[pilar];
                const itemKeys = Object.keys(itemsObj);

                if (itemKeys.length === 0) {
                    description += `  *(Belum ada catatan)*\n`;
                } else {
                    itemKeys.forEach(itemName => {
                        const spent = itemsObj[itemName];
                        const limitVal = limitsMap[`${pilar}:${itemName.toLowerCase()}`];
                        let line = `  • ${itemName}: Rp${spent.toLocaleString('id-ID')}`;
                        if (limitVal) {
                            const progressBar = makeProgressBar(spent, limitVal);
                            line += ` / Rp${limitVal.toLocaleString('id-ID')} ${progressBar}`;
                        }
                        description += `${line}\n`;
                    });
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Status Keuangan Bulan Ini (${currentMonth})`)
                .setColor(0x3498DB)
                .setDescription(description);

            return interaction.editReply({ embeds: [embed] });
        }

        // 7. COMMAND: /riwayat
        if (commandName === 'riwayat') {
            const bulan = options.getInteger('bulan');
            const tahun = options.getInteger('tahun') || new Date().getFullYear();
            const formattedMonth = `${tahun}-${String(bulan).padStart(2, '0')}`;

            const rows = db.prepare(`
                SELECT id, pillar, item, type, amount, description, created_at 
                FROM transactions 
                WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
                ORDER BY id DESC
                LIMIT 25
            `).all(user.id, formattedMonth);

            if (rows.length === 0) {
                return interaction.editReply({ content: `Nggak ada catatan transaksi untuk periode **${formattedMonth}**.` });
            }

            let historyText = rows.map(r => {
                const tanggal = r.created_at ? r.created_at.slice(0, 10) : ''; // Format: YYYY-MM-DD
                return `\`#${r.id}\` *(${tanggal})* | **[${r.type.toUpperCase()}]** ${r.pillar} - ${r.item}: Rp${r.amount.toLocaleString('id-ID')} (${r.description})`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📜 Riwayat Transaksi Periode ${formattedMonth}`)
                .setColor(0x9B59B6)
                .setDescription(historyText)
                .setFooter({ text: 'Gunakan /hapus-transaksi [ID] jika ada kesalahan input.' });

            return interaction.editReply({ embeds: [embed] });
        }

        // 8. COMMAND: /set-recap-weekly
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
            return interaction.editReply({ content: `✅ Rekap mingguan diatur setiap **${days[hari]}** pukul **${jam}** (${timezone}) di ${channel}.` });
        }

        // 9. COMMAND: /set-recap-monthly
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

            return interaction.editReply({ content: `✅ Rekap bulanan diatur setiap tanggal **${tanggal}** pukul **${jam}** (${timezone}) di ${channel}.` });
        }

        // 10. COMMAND: /kakeibo
        if (commandName === 'kakeibo') {
            const embed = new EmbedBuilder()
                .setTitle('📘 Panduan 4 Pilar Kakeibo')
                .setColor(0x9B59B6)
                .setDescription(
                    '🟢 **Needs:** Kebutuhan pokok harian (Belanja bulanan, Tagihan, Transportasi)\n' +
                    '🟡 **Wants:** Keinginan & Hiburan (Game, Jajan, Beli barang hobi)\n' +
                    '🔵 **Improvisasi Diri:** Pengembangan skill & produktivitas (Buku, Kursus, Peralatan kerja)\n' +
                    '🔴 **Unplanned:** Pengeluaran darurat & tak terduga (Servis kendaraan, Obat-obatan)'
                );

            return interaction.editReply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('❌ Error saat mengeksekusi command:', error);
        await interaction.editReply({ content: '⚠️ Terjadi kesalahan saat memproses perintah ini.' }).catch(() => {});
    }
});

// Fungsi Penjadwalan Laporan Rekap (Mingguan & Bulanan)
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
                        SELECT pillar, item, type, SUM(amount) as total FROM transactions 
                        WHERE guild_id = ? AND created_at >= datetime('now', '-7 days')
                        GROUP BY pillar, item, type
                    `).all(setting.guild_id);

                    sendRecapEmbed(channel, rows, '📅 Rekap Mingguan Kakeibo (7 Hari Terakhir)');
                }
            }

            // 2. REKAP BULANAN
            if (setting.recap_monthly_channel_id && setting.recap_monthly_date === date && setting.recap_monthly_time === timeStr) {
                const channel = await client.channels.fetch(setting.recap_monthly_channel_id).catch(() => null);
                if (channel) {
                    const currentMonth = new Date().toISOString().slice(0, 7);
                    const rows = db.prepare(`
                        SELECT pillar, item, type, SUM(amount) as total FROM transactions 
                        WHERE guild_id = ? AND strftime('%Y-%m', created_at) = ?
                        GROUP BY pillar, item, type
                    `).all(setting.guild_id, currentMonth);

                    sendRecapEmbed(channel, rows, `📆 Rekap Bulanan Kakeibo (${currentMonth})`);
                }
            }
        }
    } catch (err) {
        console.error('Error rekap:', err);
    }
}

function sendRecapEmbed(channel, rows, title) {
    let totalIncome = 0;
    let totalExpense = 0;
    const pillarsData = { 'Needs': {}, 'Wants': {}, 'Improvisasi Diri': {}, 'Unplanned': {} };

    rows.forEach(r => {
        if (r.type === 'pengeluaran') {
            totalExpense += r.total;
            if (!pillarsData[r.pillar]) pillarsData[r.pillar] = {};
            
            const itemName = r.item || 'Lainnya';
            pillarsData[r.pillar][itemName] = (pillarsData[r.pillar][itemName] || 0) + r.total;
        } else if (r.type === 'pemasukan') {
            totalIncome += r.total;
        }
    });

    const limitsRows = db.prepare('SELECT pillar, item, limit_amount FROM item_limits').all();
    const limitsMap = {};
    limitsRows.forEach(l => { 
        if (l.item) limitsMap[`${l.pillar}:${l.item.toLowerCase()}`] = l.limit_amount; 
    });

    let description = `🟢 **Total Pemasukan:** Rp${totalIncome.toLocaleString('id-ID')}\n` +
                      `🔴 **Total Pengeluaran:** Rp${totalExpense.toLocaleString('id-ID')}\n` +
                      `💡 **Sisa Saldo Bersih:** Rp${(totalIncome - totalExpense).toLocaleString('id-ID')}\n\n` +
                      `📌 **Rincian Pengeluaran Per Item:**\n`;

    for (const pilar of ['Needs', 'Wants', 'Improvisasi Diri', 'Unplanned']) {
        description += `\n**${pilar}:**\n`;
        const itemsObj = pillarsData[pilar] || {};
        const itemKeys = Object.keys(itemsObj);

        if (itemKeys.length === 0) {
            description += `  *(Belum ada catatan)*\n`;
        } else {
            itemKeys.forEach(itemName => {
                const spent = itemsObj[itemName];
                const limitVal = limitsMap[`${pilar}:${itemName.toLowerCase()}`];
                let line = `  • ${itemName}: Rp${spent.toLocaleString('id-ID')}`;
                if (limitVal) {
                    const progressBar = makeProgressBar(spent, limitVal);
                    line += ` / Rp${limitVal.toLocaleString('id-ID')} ${progressBar}`;
                }
                description += `${line}\n`;
            });
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xE67E22)
        .setDescription(description);

    channel.send({ embeds: [embed] }).catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);