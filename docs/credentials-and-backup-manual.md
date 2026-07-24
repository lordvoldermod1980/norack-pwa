# NO.Rack — คู่มือ Credential & การสำรองข้อมูล

> ## ⚠️ เอกสารยุคก่อน cutover — credential ในนี้เป็นของระบบเดิม (n8n / MinIO / Google Sheets)
>
> ระบบปัจจุบันใช้ **Turso + B2 + CF Workers/Deno** ซึ่งมีชุด secret คนละชุดกันทั้งหมด
> - **secret ปัจจุบัน** → `D:\Project_Web_DB_Oncloud\SECRETS.local.md` (gitignored) + `.dev.vars`
>   และตั้งบน CF (`wrangler secret`) / Deno dashboard — **ต้องตั้งให้ตรงกันทั้ง 2 runtime**
> - **backup/restore ปัจจุบัน** → ปุ่ม "สำรองข้อมูล"/"กู้ข้อมูล" ในแอป (Phase 10)
>   · รายละเอียด: vault `[[web-db-oncloud-maintenance]]` §Backup/Restore
> - **ขอบเขตที่ backup ไปไม่ถึง: ไม่มีการ backup รูป** — Turso หายทั้งก้อน = ไฟล์ใน B2 ยังอยู่
>   แต่ไม่มีแถวชี้ว่ารูปไหนของบิลไหน = orphan ถาวร
>
> เก็บไฟล์นี้ไว้เพราะยังต้องใช้ตอน **rollback ไป n8n** (ระบบเดิมถูกเก็บเป็น cold standby)

> ค่า token จริงทั้งหมดอยู่ที่ `home-server/SECRETS.local.md` (gitignored) — ไฟล์นี้เป็น **ขั้นตอน** ไม่เก็บค่าลับ
> 🔒 host ในตัวอย่าง curl (`<n8n-host>` / `<sse-host>`) เป็น placeholder — ค่าจริงดูตาราง "หาค่าจริงของ placeholder" ใน [operations-manual.md](./operations-manual.md)

---

## 1) ภาพรวม credential ในระบบ

| Credential | อยู่ที่ไหน | ใช้ทำอะไร |
|-----------|-----------|-----------|
| **TOKEN_A** (webhook) | Cloudflare Pages secret `N8N_TOKEN` + n8n credential **NORACK Webhook Auth** | Pages Function → เรียก n8n webhook (ครอบ 8 webhook) |
| **TOKEN_B** (SSE notify) | home-server `.env` `NORACK_AUTH` + n8n node **Notify SSE** | n8n → push event เข้า norack-sse |
| **n8n credentials (11 ตัว)** | เข้ารหัสใน `n8n_data/` (Google, MinIO, Line, ฯลฯ) | ใช้ในแต่ละ workflow |
| **encryption key** | ไฟล์ `n8n_data/config` (auto-generated) | กุญแจถอดรหัส credential ทุกตัวใน n8n |

> ⚠️ token ของ NO.Rack **เก็บ "2 ที่ ต้องตรงกันเสมอ"** — เปลี่ยนที่หนึ่ง ต้องเปลี่ยนอีกที่ให้ตรงทันที ไม่งั้นจะ 401/403

---

## 2) วิธี Rotate Token (เปลี่ยน token ใหม่)

### 2.1 TOKEN_A — Webhook (Pages Function ↔ n8n)

**🔑 จุดสำคัญ:** token ฝั่ง n8n อยู่ใน **Credential กลาง** ชื่อ "NORACK Webhook Auth" — **ไม่ได้อยู่ใน workflow** ใดๆ แก้ที่เดียวครอบ webhook ทั้ง 8 ตัว (Open Bill / Get Open Bills / Update Status / Bill Status / Customer Lookup / Upload Photo / Update Bill / Delete Bill)

ขั้นตอน (มี downtime สั้น ~2-3 นาที — ทำตอนร้านว่าง):

1. **สร้าง token ใหม่:** `openssl rand -hex 20` → ได้ค่าสุ่ม (เช่นเติม prefix `nrk_api_`)
2. **n8n** → แถบซ้าย **Credentials** → เปิด **"NORACK Webhook Auth"** → แก้ช่อง **Value** (ช่อง Name=`Authorization` อย่าแตะ) → **Save**
   - *ไม่ต้องเปิด workflow / ไม่ต้องแตะ webhook node — webhook ทุกตัวอ้างถึง credential นี้ด้วย ID*
3. **Cloudflare Pages secret** ให้ตรงกัน (จาก `d:\Project_Webapp\norack-pwa`):
   ```bash
   printf '<token-ใหม่>' | wrangler pages secret put N8N_TOKEN --project-name norack-pwa
   npm run build:pages   # ⚠️ ไม่ใช่ `npm run build` (นั่นคือ base ของ GitHub Pages → asset 404)
   wrangler pages deploy dist --project-name norack-pwa --branch main
   ```
4. **Verify:**
   ```bash
   # token เก่า → ควร 403 (ตาย)
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: <token-เก่า>" https://<n8n-host>/webhook/get-open-bills
   # token ใหม่ → ควร 200
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: <token-ใหม่>" https://<n8n-host>/webhook/get-open-bills
   ```
5. อัปเดตค่าใหม่ใน `SECRETS.local.md`

### 2.2 TOKEN_B — SSE notify (n8n ↔ norack-sse)

token ฝั่ง n8n อันนี้ **hardcoded อยู่ใน node** (ต่างจาก A) ต้องเข้า workflow

1. **สร้าง token ใหม่:** `openssl rand -hex 20` (เช่น prefix `nrk_sse_`)
2. **n8n** → **Workflows** → **"NORACK: Loyverse Receipt Sync"** → node **"Notify SSE"** → ส่วน Headers → ช่อง `Authorization` Value → ใส่ token ใหม่ → **Save** → **Publish**
3. **home-server `.env`** → แก้/เพิ่มบรรทัด `NORACK_AUTH=<token-ใหม่>`
4. **Rebuild norack-sse** (จาก `home-server`):
   ```bash
   docker compose up -d --build --no-deps norack-sse
   ```
5. **Verify:**
   ```bash
   # เก่า → 401, ใหม่ → 200
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<sse-host>/notify -H "Authorization: <token-เก่า>" -d '{}'
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<sse-host>/notify -H "Authorization: <token-ใหม่>" -d '{"type":"bills_updated","rack_id":"RK-TEST"}'
   ```
6. อัปเดต `SECRETS.local.md`

---

## 3) การสำรอง n8n Credentials (สำคัญที่สุด)

n8n เก็บ credential **เข้ารหัส** ไว้ในโฟลเดอร์ `home-server\n8n_data\` โดยใช้ **encryption key** ที่อยู่ในไฟล์ `n8n_data\config`

> 🔴 **กฎเหล็ก: DB (n8n_data) + encryption key (config) ต้องเก็บคู่กันเสมอ**  
> มี DB แต่ไม่มี key = ถอดรหัส credential ไม่ได้เลย

### วิธี A — สำรองทั้งโฟลเดอร์ (ง่ายสุด แนะนำ)

`n8n_data/` มีครบทั้ง DB + encryption key + workflows → backup โฟลเดอร์นี้ = backup ทุกอย่าง

```powershell
# จาก home-server  (PowerShell)
docker compose stop n8n                              # หยุดก่อน เพื่อ DB ไม่พัง
Compress-Archive -Path .\n8n_data\* -DestinationPath "D:\backups\n8n_data_2026-06-20.zip"
docker compose --profile cf-n8n up -d n8n            # start กลับ (ใช้ profile ที่ใช้จริง)
```

- เก็บไฟล์ zip ไว้ที่ **ปลอดภัย** (external drive / cloud ส่วนตัว) — **ห้ามใส่ git** (มี secret)
- **Restore:** `docker compose stop n8n` → แตก zip ทับโฟลเดอร์ `n8n_data` → `up -d n8n`

### วิธี B — n8n CLI export (แยกไฟล์ เวอร์ชันง่าย)

```bash
# credentials (เข้ารหัส — import ที่อื่นต้องใช้ encryption key เดิม)
docker exec n8n n8n export:credentials --backup --output=/home/node/.n8n/backup/credentials
# workflows
docker exec n8n n8n export:workflow --backup --output=/home/node/.n8n/backup/workflows
# ไฟล์โผล่ที่ host: home-server\n8n_data\backup\
```

Import กลับ:
```bash
docker exec n8n n8n import:credentials --separate --input=/home/node/.n8n/backup/credentials
docker exec n8n n8n import:workflow  --separate --input=/home/node/.n8n/backup/workflows
```

> `--decrypted` จะ export เป็น **plain text เห็น secret ทั้งหมด** — ใช้เฉพาะตอนย้ายไปเครื่องที่ encryption key คนละตัว และต้องเก็บไฟล์ให้ดีมาก

### สำรอง encryption key แยก (กันลืม)

```bash
docker exec n8n sh -c 'cat /home/node/.n8n/config'
# → {"encryptionKey":"..."}  เก็บค่านี้ใน password manager
```

---

## 4) Recovery — สถานการณ์ฉุกเฉิน

| สถานการณ์ | ทำยังไง |
|-----------|---------|
| ลืม/หาย TOKEN_A หรือ B | เปิด `SECRETS.local.md` → ใส่กลับตามที่ระบุ (ข้อ 2) |
| `SECRETS.local.md` หายด้วย | สร้าง token ใหม่ + rotate (ข้อ 2) — token เราออกเอง ไม่ lock out |
| `n8n_data` หาย **แต่มี backup** | stop n8n → แตก backup ทับ → start (วิธี A) |
| `n8n_data` หาย **ไม่มี backup** | workflows + credentials หายหมด ต้องสร้างใหม่ + re-auth (Google OAuth ฯลฯ) → **ย้ำว่าต้อง backup สม่ำเสมอ** |
| มี DB แต่ไม่มี encryption key | credential ถอดรหัสไม่ได้ → ต้องลบ credential แล้วใส่ใหม่ทุกตัว |

---

## 5) Checklist การสำรอง (แนะนำ)

| ข้อมูล | ความถี่ | เก็บที่ |
|--------|---------|--------|
| `n8n_data/` (วิธี A) | สัปดาห์ละครั้ง + ก่อนแก้ workflow ใหญ่ | external drive / cloud ส่วนตัว (ไม่ใช่ git) |
| `SECRETS.local.md` + encryption key | เมื่อมีการ rotate | password manager |
| repo `norack-pwa` | ทุกครั้งที่ commit | GitHub private (push) |
| repo `home-server` | ทุกครั้งที่ commit | GitHub private `homeserver-backup` (push) |

---

## อ้างอิง
- ค่า token จริง + map: `home-server/SECRETS.local.md`
- checklist deploy: `home-server/docs/cloudflare-pages-deploy.md`
- โครงสร้าง security: Pages Function proxy (`functions/api/`) + Cloudflare Access + origin allowlist (norack-sse)
