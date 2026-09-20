# 👛 Kakeibo Discord Bot

Bot Discord untuk pencatatan dan pengelolaan keuangan pribadi berbasis metode **Kakeibo** (Jepang). Membantu pengguna membagi pengeluaran ke dalam 4 pilar utama, memantau *limit* per item, serta mendapatkan laporan bulanan dan mingguan secara otomatis.

---

## Main Feature

* **Metode 4 Pilar Kakeibo:**
  * 🟢 **Needs:** Keperluan pokok (belanja bulanan, tagihan, transportasi, dll).
  * 🟡 **Wants:** Keinginan & jajan (game, hiburan, dll).
  * 🔵 **Improvisasi Diri:** Pengembangan skill & produktivitas (hobi produktif, kursus, dll).
  * 🔴 **Unplanned:** Pengeluaran tak terduga (darurat, servis kendaraan, dll).
* **Multi-User Data Isolation:** Data transaksi, saldo, dan *budget* terisolasi secara independen untuk tiap ID pengguna.
* **Visual Progress Bar Limit:** Indikator visual dinamis (🟩 / 🟥) untuk memantau batas penggunaan *limit* pengeluaran per item.
* **Rekap Otomatis:**
  * 📅 **Rekap Mingguan:** Laporan ringkas 7 hari terakhir dikirim otomatis ke channel terkonfigurasi.
  * 📆 **Rekap Bulanan:** Laporan total pemasukan, pengeluaran, dan sisa saldo bersih setiap bulan.

---

## Slash Commands

| Command | Deskripsi |
| :--- | :--- |
| `/catat` | Mencatat transaksi keuangan (pemasukan atau pengeluaran). |
| `/hapus-transaksi` | Menghapus transaksi yang salah input berdasarkan ID. |
| `/tambah-kategori` | Menambahkan item/variabel baru ke dalam pilar tertentu. |
| `/delete-kategori` | Menghapus kategori kustom atau menyembunyikan kategori bawaan. |
| `/set-limit` | Mengatur limit pengeluaran per item (Needs/Wants/dll). |
| `/set-income` | Mengatur target pemasukan/gaji tetap bulanan. |
| `/status` | Menampilkan ringkasan kondisi keuangan bulan ini per item & sisa saldo. |
| `/riwayat` | Melihat daftar riwayat transaksi lengkap beserta tanggal dan ID. |
| `/set-recap-weekly` | Mengatur jadwal & channel rekap mingguan. |
| `/set-recap-monthly` | Mengatur jadwal & channel rekap bulanan. |
| `/kakeibo` | Penjelasan 4 pilar metode Kakeibo. |

---

## Bahasa Pemograman yang dipakai

* **Node.js** (v18+)
* **Discord.js** (v14)
* **SQLite3** via `better-sqlite3` (database lokal super cepat & ringan)
* **dotenv** (manajemen environment variable)

---

## Cara Menjalankan Secara Lokal

### 1. Prasyarat
* Node.js versi 18 atau yang lebih baru.
* Bot Application & Token dari [Discord Developer Portal](https://discord.com/developers/applications).

### 2. Instalasi
Clone repository dan install dependency:

```bash
git clone [https://github.com/mattnael/kakeibo-bot-dc.git](https://github.com/mattnael/kakeibo-bot-dc.git)
cd kakeibo-bot-dc
npm install
