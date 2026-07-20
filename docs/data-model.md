# NO.Rack — Data Model (Turso / libSQL)

> **สถานะ: ปัจจุบัน** · อัปเดต 2026-07-20
> ฐานข้อมูลจริงของระบบคือ **Turso (libSQL/SQLite)** ไม่ใช่ Google Sheets แล้ว (cutover เสร็จ 2026-07-06)
> Sheets เหลือบทบาทเดียวคือ **ปลายทางของ backup** (Phase 10) — ดูภาคผนวก A
> schema ต้นฉบับ = `D:\Project_Web_DB_Oncloud\migrations\*.sql` · เอกสารนี้สรุปให้อ่านง่าย ถ้าขัดกันให้เชื่อ migration

---

## กฎ 3 ข้อที่คุมทั้ง schema

**1. วันที่เก็บเป็น ISO-8601 เสมอ ห้ามเก็บ พ.ศ.**
แปลงเป็น พ.ศ. ตอน **แสดงผล** เท่านั้น (`src/api/dates.js`) เพราะเคยมีบั๊ก Buddhist-year ใน cleanup ยุค n8n

**2. ⚠️ ช่องวันที่ต้องเป็นวันที่จริง หรือ `NULL` — ห้ามเป็นสตริงว่าง**
SQLite ไม่มี date type มันเทียบเป็น **string** → `'' < '2026-04-21'` เป็น **TRUE** เสมอ
สตริงว่างจึงอ่านได้ว่า "เก่ากว่าทุก cutoff" ซึ่งเคยทำให้ cron ลบรูป 90 วัน กวาดรูปของบิล `รับแล้ว` ทิ้งทันที
บังคับที่ `src/db/bills.ts` (`DATE_COLS` + `emptyDateToNull`) และฝั่ง client ส่ง `null` ไม่ส่ง `''`
> partial update: **ไม่ส่ง key ที่ตัวเองไม่มีค่า** — ส่ง key พร้อมค่าว่าง = สั่งล้าง ไม่ใช่ "ไม่เปลี่ยน"

**3. PII เก็บแบบเข้ารหัสเท่านั้น**
ชื่อ/เบอร์ไม่เคยอยู่ใน Turso เป็น plaintext · provider เห็นแต่ ciphertext

---

## ตารางหลักของโดเมน (4 ตาราง)

### `customers`
| คอลัมน์ | ความหมาย |
|---|---|
| `customer_id` **PK** | 18 ตัว = timestamp 13 + hex 5 (สร้างในโค้ด `src/util/id.ts`) |
| `loyverse_uuid` UNIQUE | id ภายในของ Loyverse — **matching key ของ sync ทุกทาง** |
| `customer_code` | รหัสลูกค้าฝั่ง Loyverse (เราเขียนกลับ = write-back) |
| `name_enc` / `tel_enc` | **AES-256-GCM** · base64 ของ `iv‖ciphertext‖tag` |
| `tel_hash` | **blind index** = HMAC-SHA256(key, เบอร์ที่ normalize แล้ว) → ค้นเบอร์แบบ exact ได้โดยไม่ต้องถอดรหัส |
| `created_at` / `updated_at` | ISO (ค่าจาก Loyverse ตรงๆ) |
| `sync_status` / `sync_error` / `last_synced_at` | สถานะ write-back (`synced`/`pending`/`failed`) — migration 0003 |

> **ค้นชื่อทำที่ client** เพราะชื่อถูกเข้ารหัส เซิร์ฟเวอร์ค้นไม่ได้ → ส่งลิสต์ที่ถอดรหัสแล้วไปกรองบนเครื่อง
> (ดู `web-db-oncloud-customer-cache` ใน vault) · **ค้นเบอร์ใช้ `tel_hash`** เท่านั้น

### `bills`
| คอลัมน์ | ความหมาย |
|---|---|
| `rack_id` **PK** | `RK-YYMMDD-XXXX` · ของเก่ายุค v1 = `RK1000043` (ไม่มีขีด) |
| `customer_id` **FK** | **normalize — ไม่เก็บ name/tel ซ้ำในบิล** (FK ถูก enforce จริง → ลบลูกค้าที่มีบิลไม่ได้) |
| `loyverse_uuid`, `receipt_number` | ผูกกับใบเสร็จ POS |
| `no_rack`, `no_shelf`, `total_bags` | ตำแหน่งหลัก + จำนวนถุง |
| `status` | `รอดำเนินการ` / `ซักเสร็จ` (แสดงว่า "เสร็จสิ้น") / `รับแล้ว` |
| `open_date` / `open_ts` | วันเปิดบิล (แก้ได้) / เวลาสร้างจริงสำหรับ audit (ซ่อนใน UI) |
| `done_date` / `final_date` | วันซักเสร็จ / **วันรับผ้า — ใช้คิดเกณฑ์ 90 วันสำหรับลบรูป** |

> `updateStatus` stamp วันให้อัตโนมัติ แต่ **ไม่เคยเขียนทับค่าที่มีอยู่แล้ว** (`cur.final_date || today`)

### `bill_positions`
`rack_id` FK (**ON DELETE CASCADE**) · `zone` · `slot` · `bags` — 1 บิลมีได้หลายตำแหน่ง

> โซนที่ frontend รู้จัก: **ราวหลัก** (ราว 1–16) · **บ้านตา** (17–22) · **ชั้นวาง** (23–24) · **บนพื้น** (ไม่มีช่อง)

### `photos`
`rack_id` FK (CASCADE) · `customer_id` · `loyverse_uuid` · **`photo_url` = B2 object key** (ไม่ใช่ URL เต็ม)
· `cloth_category` · `cloth_type` · `seq` · `photo_timestamp` · `upload_date`

> 🔒 รูปอยู่ใน **B2 private bucket** เข้าถึงผ่าน **presigned URL หมดอายุ 5 นาที** เท่านั้น — ไม่มี host ให้เปิดตรง
> 🧹 บิล `รับแล้ว` ที่ `final_date` เก่ากว่า 90 วัน → รูปถูกลบทั้ง object ใน B2 และแถวในตารางนี้
> โดย **cron 01:30 น. ทั้ง CF และ Deno** (dedup ผ่าน `_meta`) · **ไม่มี backup รูป** — ลบแล้วหายถาวร

---

## ตารางระบบ (เพิ่มมาภายหลัง)

| ตาราง | หน้าที่ | migration |
|---|---|---|
| `staff` | บัญชีพนักงาน: `password_hash` (PBKDF2 chained), `role`, `perms` (CSV), `token_version`, `disabled` | 0002 / 0006 |
| `auth_audit` | log การ login **และการอ่าน PII** (`pii_read`/`pii_blocked`) + เป็นแหล่งข้อมูลของ rate-limit | 0004 |
| `assistant_memory` | ความจำ LINE bot (N เทิร์นล่าสุดต่อ user) | 0005 |
| `webhook_dlq` | งานจาก webhook ที่ทำไม่สำเร็จ (ไม่ยอมทิ้งเงียบ) | 0007 |
| `system_errors` | error ที่ยังไม่ถูกปิด → ป้อน badge "ระบบ" | 0008 |
| `_meta` | key/value: `schema_version`, cursor ของ reconcile, **การจอง cron รายวัน** (`claimDailyTask`) | 0001 |

---

## 3 รหัสของลูกค้า (จุดที่สับสนบ่อยที่สุด)

| รหัส | ใครเป็นเจ้าของ | ใช้ทำอะไร |
|---|---|---|
| **`customer_id`** | **เราสร้างเอง** (18 ตัว) | primary key ของ NO.Rack |
| **`loyverse_uuid`** | Loyverse | **matching key** ตอน sync/reconcile ทุกครั้ง |
| **`customer_code`** | Loyverse | ช่องที่เรา**เขียน `customer_id` กลับไป** เพื่อให้ POS มองเห็นรหัสของเรา |

```
Loyverse (POS)  ──webhook/reconcile──►  customers (Turso)
      ▲                                      │
      └────── write-back customer_code ──────┘

เปิดบิลในเว็บ ──► bills ──┬── bill_positions
                          └── photos ──► B2 (private, presigned)
POS รับเงิน (ใส่ Rack ID ในช่อง note ใบเสร็จ) ──receipt webhook──► bills.status = รับแล้ว
```

---

## ภาคผนวก A — mapping กับคอลัมน์ยุค Google Sheets

ยังจำเป็นอยู่ เพราะ **backup/restore (Phase 10) ใช้ชื่อคอลัมน์เดิม** เพื่อให้ไฟล์อ่านออกด้วยตาคน

| Sheets เดิม | Turso ปัจจุบัน |
|---|---|
| `Master register` | `bills` (+ `bill_positions` แทนคอลัมน์ `Positions` ที่เคยเป็น JSON) |
| `customers.info` | `customers` |
| `Work_Recieve` | `photos` |
| `Name` / `Tel` ในบิล | **ตัดออก** — normalize ไปที่ `customer_id` แล้ว |
| `Photo_URL` (URL เต็มใน MinIO) | `photo_url` = **B2 object key** เท่านั้น |
| `UP Date` (ระวัง UP พิมพ์ใหญ่) | `updated_at` |
| วันที่ dd/mm/yyyy **พ.ศ.** | ISO-8601 (ค.ศ.) |

> ⚠️ `POST /api/import` รับ **ISO เท่านั้น** ไม่เดา `dd/mm` ↔ `mm/dd` อีกแล้ว — การเดาแบบนั้นเคยทำวันที่ลูกค้า
> เพี้ยนไป **3,055 แถว** · ไฟล์ที่วันที่ไม่ใช่ ISO จะถูกปฏิเสธด้วย 422 พร้อมบอกว่าแถวไหนค่าอะไร

## ภาคผนวก B — ของยุค n8n ที่เลิกใช้แล้ว

`generate_cust` spreadsheet + Google Apps Script (`generateCustomerIDs.gs`) — **เลิกใช้** การสร้าง
`customer_id` ย้ายเข้าโค้ดแล้ว (`src/util/id.ts`) · MinIO → B2 · workflow `Cleanup Old Photos` → cron ใน norack-api

---

## อ่านต่อ
- schema ต้นฉบับ + endpoint: `D:\Project_Web_DB_Oncloud\migrations\`, vault `[[web-db-oncloud-api]]`
- ทำไม list ลูกค้าถึงห้าม throttle: vault `[[web-db-oncloud-customer-cache]]`
- บั๊กวันที่/รูป + เหตุผลของกฎข้อ 2: vault `[[web-db-oncloud-review-2026-07-20]]`
