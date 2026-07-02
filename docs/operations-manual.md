# NO.Rack — คู่มือการใช้งานระบบ (Operations Manual)

> อัปเดตล่าสุด: 2026-06-21
> คู่มือนี้อธิบาย **ภาพรวมระบบ + วิธีใช้งาน + การดูแล** — ค่า token/ความลับดูที่ `SECRETS.local.md` (gitignored) · ขั้นตอน credential/backup ดูที่ [credentials-and-backup-manual.md](./credentials-and-backup-manual.md)
> 🔒 Spreadsheet ID / host จริงในเอกสารนี้ใช้ **placeholder** (`<...>`) — หาค่าจริงได้จากหัวข้อ **🔑 หาค่าจริงของ placeholder** ท้ายเอกสาร

---

## 1. ภาพรวมระบบ

```
แท็บเล็ต (พนักงาน)
   │  PWA (React + Vite)  →  <pages-domain>
   ▼
Cloudflare Pages  ── Cloudflare Access (ล็อกอินก่อนเข้า)
   │  ├─ /api/*   →  Pages Function proxy (เติม token ฝั่ง server)  →  n8n
   │  └─ SSE      →  EventSource ตรงไป norack-sse (real-time)
   ▼
n8n  (ผ่าน Cloudflare Tunnel: <n8n-host>)
   ├─ Google Sheets  = ฐานข้อมูล (Master register / customers.info / Work_Recieve)
   ├─ MinIO          = เก็บรูปผ้า (<minio-host>/laundry-photos/)
   └─ Loyverse POS   = webhook คิดเงิน → อัปเดตสถานะบิล
```

**หลักความปลอดภัย:** token ไม่อยู่ใน bundle (Pages Function เติมให้) · ทั้งเว็บอยู่หลัง Cloudflare Access · SSE ล็อกด้วย origin allowlist

---

## 2. โครงสร้างข้อมูล (Google Sheets = DB)

**Spreadsheet หลัก** (บิล/ลูกค้า/รูป) · id `<MAIN_SPREADSHEET_ID>` (ดูค่าจริงใน config/SECRETS.local.md)

| Sheet | ใช้ทำอะไร |
|-------|-----------|
| **Master register** | บิลทั้งหมด (1 แถว = 1 บิล) |
| **customers.info** | ทะเบียนลูกค้า (sync จาก Loyverse) |
| **Work_Recieve** | รูปผ้าแต่ละบิล (1 แถว = 1 รูป) |

**generate_cust / generateQ1** (คนละ spreadsheet · id `<GENCUST_SPREADSHEET_ID>`) — สร้าง Customer_ID ผ่าน Google Apps Script

### คอลัมน์สำคัญใน Master register
`Rack_ID` · `Customer_ID` · `Loyverse_UUID` · `Name` · `Tel` · `No.Rack` · `No.Shelf` · `Total.Bags` · `Positions` · `วันที่เปิดบิล` · `Open_TS` (ซ่อน) · `สถานะ` · `Done_Date` · `Final Date` · `Receipt Number`

### รูปแบบ Rack ID
| แบบ | ตัวอย่าง | หมายเหตุ |
|-----|---------|---------|
| ใหม่ | `RK-YYMMDD-XXXX` | สร้างโดย Open Bill · suffix พิมพ์ใหญ่ (เช่น `RK-260621-NC38`) |
| เก่า v1 | `RK1000043` | ไม่มีขีด · ยังติดกับชิ้นงานเก่า · POS sync ไม่จับ (ดูข้อ 5) |

### 3 วันที่ของบิล (dd/mm/yyyy **พ.ศ.**)
1. **วันเปิดบิล** (`วันที่เปิดบิล`) — แก้ได้
2. **วันซักเสร็จ** (`Done_Date`) — เซ็ตเมื่อสถานะ → ซักเสร็จ/เสร็จสิ้น
3. **วันรับผ้า** (`Final Date`) — เซ็ตเมื่อรับแล้ว (POS sync หรือกดเอง) · **ฟิลเตอร์ "เกิน 90 วัน" ใช้วันนี้**

> `Open_TS` = เวลาจริงที่สร้างบิล (วันที่+เวลา) เป็น audit กันแก้ — ซ่อนไว้ในชีต ไม่ได้ใช้ใน UI

### 3 ID ของลูกค้า
- **Customer_ID** = ID ที่ระบบสร้าง (18 ตัว = timestamp 13 + hex 5) · primary key
- **Loyverse_UUID** = id ภายในของ Loyverse
- **customer_code** = รหัสลูกค้าใน Loyverse

---

## 3. Lifecycle ของบิล

```
รอดำเนินการ  ──[ปิดบิล (ซักเสร็จ)]──►  ซักเสร็จ  ──[ลูกค้ารับผ้า]──►  รับแล้ว
     ▲                                    ▲                            │
     └────[↩ ย้อนเป็นรอดำเนินการ]─────────┴───[↩ ย้อนเป็นซักเสร็จ]──────┘
```

- เปลี่ยนสถานะเดินหน้า = ปุ่มหลัก (สีทึบ) · **ย้อนสถานะ = ปุ่ม outline** (แก้กรณีเผลอกด)
- บิล **"รับแล้ว"** จะออกจากผังราว (ถือว่าไม่ครองพื้นที่แล้ว)
- เปลี่ยน → ซักเสร็จ/เสร็จสิ้น เซ็ต `Done_Date` = วันนี้ · เปลี่ยน → รับแล้ว เซ็ต `Final Date` = วันนี้

---

## 4. การใช้งานหน้าแอป

### 4.1 ลูกค้า
ค้นหาลูกค้าจาก ชื่อ / รหัส / เบอร์ → แสดง Customer ID, Create Date, Up Date

### 4.2 ทะเบียน (Register)
- **เปิดบิลใหม่** — เลือกลูกค้า, ตำแหน่งราว (zone/slot + จำนวนถุง), วันเปิดบิล → ได้ Rack_ID
- **ฟิลเตอร์:** ทั้งหมด / รอ / เสร็จ / รับแล้ว / **เกิน 90 วัน**
- **ลบบิลเกิน 90 วันทั้งหมด** — ชิป "เกิน 90 วัน" → ปุ่มแดงทึบ → ยืนยัน → ลบทีละใบ (ทั้งแถวในชีต + ในเว็บ)
- **แก้ไขรายละเอียด** — แก้ลูกค้า/ตำแหน่ง/ถุง/receipt + **3 วันที่ (เปิดบิล/ซักเสร็จ/รับผ้า)**
  - มี validation ลำดับ `เปิดบิล ≤ ซักเสร็จ ≤ รับผ้า` — **บล็อกเฉพาะตอนแก้ช่องวันที่เอง** (บิลเก่าที่ลำดับเพี้ยนแต่ไม่แตะวันที่ → ยังเซฟได้)
- **ปุ่มสถานะ / ย้อนสถานะ** — ดูข้อ 3

### 4.3 รับผ้า (อัปโหลดรูป)
- ช่องรูปมี **"ถ่ายรูป" (กล้อง)** และ **"เลือกไฟล์" (แกลเลอรี)** · ได้สูงสุด 4+ ช่อง
- รูปถูก **ย่ออัตโนมัติ ≤ 1600px / JPEG คุณภาพ 0.72** ก่อนส่ง (กัน payload ใหญ่) → เข้า MinIO + Work_Recieve
- ต้องระบุ Rack ID + Customer ID + ประเภทผ้า

### 4.4 ค้นหา + ผังราว
- **ค้นหา** — พิมพ์ Rack ID / ชื่อ / รหัสลูกค้า → ดูรายละเอียดบิล + รูป
- **ผังราว (rack map)** — แสดงราว/ชั้น/บนพื้น ว่าช่องไหนมีบิลของใคร · กี่งาน/กี่ถุง · ใช้กี่ช่อง · คลิกช่องเพื่อดูบิลในช่องนั้น
  - บิลที่ **"รับแล้ว"** จะหายจากผัง (ไม่นับว่าครองพื้นที่)
  - ช่องในผัง + ชื่อลูกค้าแสดง **ตัวใหญ่ + หนา** อ่านชัด

---

## 5. การ Sync กับ Loyverse POS

**Flow ปกติ (Rack ID ใหม่):**
1. เปิดบิลในเว็บ → ได้ Rack ID (เช่น `RK-260621-NC38`)
2. ตอนลูกค้ามารับ → **คิดเงินที่ POS โดยใส่ Rack ID ลงในช่อง note ของใบเสร็จ**
3. Loyverse ยิง webhook → **Receipt Sync** หาแถวด้วย Rack ID → เซ็ต `สถานะ=รับแล้ว`, `Final Date=วันนี้`, `Receipt Number` → push SSE → เว็บอัปเดตสด

- **case-insensitive:** match Rack ID โดยไม่สนพิมพ์เล็ก/ใหญ่ (อ่านค่าจริงจากชีต) — รองรับทั้งของใหม่ (พิมพ์ใหญ่) และของเก่าที่มีตัวอักษรพิมพ์เล็ก
- **Rack ID เก่า `RK1000043` (ไม่มีขีด):** Receipt Sync **ไม่จับ** → ใช้วิธีกดปุ่ม **"ลูกค้ารับผ้า"** ในเว็บแทนตอนลูกค้ามารับ

---

## 6. n8n Workflows (production · ใช้งานจริง)

| Workflow | หน้าที่ | webhook path |
|----------|---------|--------------|
| Open Bill | เปิดบิลใหม่ + generate Rack_ID | `/webhook/open-bill` |
| Get Open Bills | ดึงบิลทั้งหมด/ตามลูกค้า | `/webhook/get-open-bills` |
| Customer Lookup | ค้นหาลูกค้า | `/webhook/customer-lookup` |
| Upload Photo | รับรูป base64 → MinIO + Work_Recieve | `/webhook/norack-upload-photo` |
| Update Status | เปลี่ยนสถานะ (+เซ็ต Done_Date/Final Date) | `/webhook/norack-update-status` |
| Update Bill | แก้รายละเอียดบิล (+ Done_Date) | `/webhook/norack-update-bill` |
| Delete Bill | ลบบิล (ทั้งแถว) | `/webhook/norack-delete-bill` |
| Bill Status | รายละเอียดบิล + รูป | `/webhook/norack-bill-status` |
| Loyverse Receipt Sync | POS คิดเงิน → รับแล้ว | `/webhook/loyverse-receipt-sync` |
| Sync Customers from Loyverse | sync ลูกค้า → customers.info | (Loyverse webhook) |
| Cleanup Old Photos | ลบรูปเกิน 90 วัน ทุกวัน 02:00 | (cron) |

> Auth: webhook ทุกตัว (ยกเว้น Loyverse) ใช้ header `Authorization` จาก credential กลาง "NORACK Webhook Auth"
> ⚠️ แก้ workflow ผ่าน UI ต้องกด **Publish** · ปุ่ม Publish เหลือง = มี draft ยังไม่ publish (webhook รัน active version เดิมอยู่)

---

## 7. การ Deploy

### Webapp (norack-pwa)
```bash
npm run build
npx wrangler pages deploy dist --project-name norack-pwa --branch main
```
> เว็บอยู่หลัง Cloudflare Access → curl จะโดน 302 (ปกติ) · ทดสอบจริงต้องเปิดในเบราว์เซอร์ที่ล็อกอินแล้ว · หลัง deploy ให้ **hard refresh / ปิด-เปิด PWA**

### Google Apps Script (generate Customer_ID)
- Extensions → Apps Script → paste โค้ด → **Save** (ไม่ต้องกด Deploy — รันผ่านเมนูบนชีต)

### n8n
- แก้ใน editor → **Publish** · หรือแก้ผ่าน API/MCP แล้ว publish

---

## 8. อัปเดตล่าสุด (2026-06-21)

- **ย่อรูปก่อนอัปโหลด** (≤1600px/JPEG) — แก้บั๊กรูปใหญ่อัปไม่ผ่าน (payload เกิน limit n8n)
- **แก้ไขบิล: 3 ช่องวันที่** (เปิดบิล/ซักเสร็จ/รับผ้า) แก้ได้ทั้งหมด + validation ลำดับวันที่ (บล็อกเฉพาะตอนแก้วันที่)
- **n8n Update Bill** รองรับเขียน `Done_Date`
- **ปุ่มย้อนสถานะ** (รับแล้ว→ซักเสร็จ, ซักเสร็จ→รอดำเนินการ) แก้กรณีเผลอกด
- **ปุ่มลบเกิน 90 วัน** เปลี่ยนเป็นปุ่มแดงทึบ (เดิมดูเหมือนแถบแจ้งเตือน)
- **Receipt Sync case-insensitive** — match Rack ID พิมพ์เล็ก/ใหญ่ได้ (เพิ่ม node อ่านชีต)
- **GAS generate ID** ตัด webhook n8n ออก + เปลี่ยนเป็น UUID
- ซ่อนคอลัมน์ `Open_TS` ในชีต (ไม่ได้ใช้ใน UI)
- **ขยายผังราว (tab ค้นหา)** — ช่องใหญ่ขึ้น (ราว 8→5 คอลัมน์) + ชื่อลูกค้าตัวหนาใหญ่ขึ้น (เดิม 11-12px จาง มองแทบไม่เห็น → 16px หนา)

---

## 9. Troubleshooting

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| อัปรูปไม่สำเร็จ "บันทึกไม่สำเร็จ" | รูปใหญ่เกิน payload limit | ย่อรูปในโค้ดแล้ว (≤1600px) — ถ้ายังเจอ เช็ค execution Upload Photo |
| แก้บิลเก่าเซฟไม่ได้ | validation ลำดับวันที่ (ข้อมูลเก่าเพี้ยน) | แก้แล้ว — บล็อกเฉพาะตอนแก้วันที่เอง · ไม่แตะวันที่ก็เซฟได้ |
| เผลอเปลี่ยนสถานะ | กดปุ่มผิด | ใช้ปุ่ม **↩ ย้อนสถานะ** ในแผงรายละเอียด |
| คิดเงิน POS แล้วสถานะไม่เปลี่ยน | ไม่ได้ใส่ Rack ID ใน note / เป็น Rack เก่า `RK1000043` | ใส่ Rack ID ใน note ใบเสร็จ · ของเก่าใช้ปุ่ม "ลูกค้ารับผ้า" |
| เห็น node ไม่ตรงกันระหว่าง editor/execution | canvas ค้างใน browser | refresh หน้า n8n (F5) |
| เว็บไม่เห็นของใหม่หลัง deploy | PWA cache | hard refresh / ปิด-เปิดแอป |
| ฟิลเตอร์ "เกิน 90 วัน" ไม่โผล่บิล | สถานะไม่ใช่ "รับแล้ว" หรือ Final Date ไม่ใช่ dd/mm/yyyy 2 หลัก | ตั้ง สถานะ=รับแล้ว + Final Date เช่น `01/01/2569` |

---

## 🔑 หาค่าจริงของ placeholder (สำหรับผู้มีสิทธิ์เข้าถึง)

เอกสารนี้ใช้ placeholder แทนค่าจริงเพื่อความปลอดภัย — ผู้ดูแลหาค่าจริงได้จาก:

| Placeholder | หาค่าจริงได้จากไหน |
|-------------|---------------------|
| `<MAIN_SPREADSHEET_ID>` | `home-server/docker-compose.yml` → env `NORACK_SPREADSHEET_ID` · หรือจาก URL ของ Google Sheet เอง (`docs.google.com/spreadsheets/d/`**`ID`**`/edit`) · หรือ `documentId` ในโหนด Google Sheets ของ n8n |
| `<GENCUST_SPREADSHEET_ID>` | URL ของ Google Sheet **generate_cust / generateQ1** · หรือเปิด Apps Script ที่ผูกกับชีตนั้น (Extensions → Apps Script) |
| `<pages-domain>` | Cloudflare Dashboard → Pages → project **norack-pwa** → Custom domains · หรือ URL ที่ขึ้นตอนรัน `wrangler pages deploy` |
| `<n8n-host>` | `home-server/docker-compose.yml` → env `DOMAIN_NAME` / `WEBHOOK_URL` · หรือไฟล์ `functions/api/[[path]].js` → ค่า `N8N_BASE` · หรือ Cloudflare Tunnel config |
| `<minio-host>` | n8n workflow **Upload Photo** (โหนด *Prepare Upload* ที่ประกอบ `photo_url`) · หรือ Cloudflare Tunnel `cloudflared-minio` |
| `<sse-host>` | ไฟล์ `src/api/norack.js` → ค่า `SSE_URL` · หรือ Cloudflare Tunnel config |
| **token / secret ทุกตัว** | `home-server/SECRETS.local.md` (gitignored) · หรือ n8n → เมนู **Credentials** |

> 🔒 ค่าเหล่านี้ **ไม่เก็บค่าจริงในรีโปนี้** (ยกเว้น host ที่โค้ดต้องใช้รัน เช่นใน `norack.js` / `[[path]].js`) — ความลับจริง (token/password/encryption key) อยู่ใน `SECRETS.local.md` เท่านั้น

---

## อ้างอิง
- credential & backup: [credentials-and-backup-manual.md](./credentials-and-backup-manual.md)
- ค่า token จริง: `home-server/SECRETS.local.md` (gitignored)
- โค้ดหลัก webapp: `src/pages/TabletDashboard.jsx` · API: `src/api/norack.js` · proxy: `functions/api/[[path]].js`
