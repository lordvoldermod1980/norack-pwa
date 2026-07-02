# NO.Rack — Data Model (โครงสร้างข้อมูล Google Sheets)

> ฐานข้อมูลของระบบคือ Google Sheets · ค่า id จริงใช้ placeholder — ดู [operations-manual.md](./operations-manual.md) (ตาราง "หาค่าจริงของ placeholder")
> วันที่ทุกช่องเป็น **dd/mm/yyyy พ.ศ.** (ค.ศ. = พ.ศ. − 543) เว้นแต่ระบุเป็นอื่น

---

## Spreadsheet 1 — NORACK main (`<MAIN_SPREADSHEET_ID>`)
3 sheets หลักที่ใช้งานจริง: **Master register**, **customers.info**, **Work_Recieve**

### Sheet: `Master register` — บิล (1 แถว = 1 บิล)
คอลัมน์ (ตามลำดับ header):

| คอลัมน์ | ความหมาย | รูปแบบ / ตัวอย่าง |
|---------|----------|------------------|
| `Rack_ID` | รหัสบิล (**primary key**) | ใหม่ `RK-YYMMDD-XXXX` (suffix พิมพ์ใหญ่) · เก่า v1 `RK1000043` (ไม่มีขีด) |
| `Customer_ID` | รหัสลูกค้า (จาก generate_cust) | 18 ตัว = timestamp 13 + hex 5 |
| `Loyverse_UUID` | id ลูกค้าใน Loyverse | uuid |
| `Receipt Number` | เลขใบเสร็จ POS | เซ็ตตอน sync รับเงิน |
| `Name` | ชื่อลูกค้า | |
| `Tel` | เบอร์โทร | |
| `No.Rack` | หมายเลขราว/ช่อง | |
| `No.Shelf` | โซน | ราวหลัก / บ้านตา / ชั้นวาง / บนพื้น |
| `Total.Bags` | จำนวนถุงรวม | ตัวเลข |
| `Positions` | ตำแหน่งทั้งหมด (JSON) | `[{"zone":"ราวหลัก","slot":3,"bags":1}]` |
| `วันที่เปิดบิล` | วันเปิดบิล (แก้ได้) | dd/mm/yyyy พ.ศ. |
| `Open_TS` | เวลาสร้างบิลจริง (audit · **ซ่อนใน UI**) | dd/mm/yyyy พ.ศ. HH:MM:SS |
| `สถานะ` | สถานะบิล | `รอดำเนินการ` / `ซักเสร็จ`(`เสร็จสิ้น`) / `รับแล้ว` |
| `Done_Date` | วันซักเสร็จ | เซ็ตเมื่อสถานะ → ซักเสร็จ/เสร็จสิ้น |
| `Final Date` | วันรับผ้า | เซ็ตเมื่อรับแล้ว (POS sync หรือกดเอง) · **ฟิลเตอร์เกิน 90 วันใช้ช่องนี้** |

> โซน (`ZONES` ใน frontend): ราวหลัก (ราว 1–16) · บ้านตา (ราว 17–22) · ชั้นวาง (ชั้น 23–24) · บนพื้น (ไม่มีช่อง)

### Sheet: `customers.info` — ทะเบียนลูกค้า (sync จาก Loyverse)
| คอลัมน์ | ความหมาย |
|---------|----------|
| `Customer ID` | รหัสลูกค้า (= customer_code ของ Loyverse) |
| `Loyverse UUID` | id ลูกค้าใน Loyverse (matching key ของ sync) |
| `Name` | ชื่อ |
| `Tel` | เบอร์ |
| `Create Date` | วันสร้างลูกค้า (Loyverse created_at) |
| `UP Date` | วันอัปเดตล่าสุด (Loyverse updated_at) — **ระวัง "UP" พิมพ์ใหญ่** |

### Sheet: `Work_Recieve` — รูปผ้าแต่ละบิล (1 แถว = 1 รูป)
| คอลัมน์ | ความหมาย |
|---------|----------|
| `Loyverse_UUID` | id ลูกค้า |
| `Customer ID` | รหัสลูกค้า |
| `Rack ID` | รหัสบิลที่รูปสังกัด |
| `Photo` | (ว่างไว้) |
| `Photo_URL` | URL รูปใน MinIO (`<minio-host>/laundry-photos/<rack>/...`) |
| `Photo_Timestamp` | เวลาอัป (ISO) |
| `Upload_Date` | วันอัป (yyyy-mm-dd) |
| `Cloth_Category` | ประเภทผ้า (ชุดทั่วไป/ชุดทำงาน/ชุดไหม/ผ้านวม/รีดอัดกลีบ) |
| `Cloth_Type` | (เสริม) |
| `Seq` | ลำดับรูปในบิล |

> รูปเกิน 90 วัน (นับจาก Final Date) ถูกลบอัตโนมัติโดย workflow **Cleanup Old Photos** (ทั้ง MinIO + แถวใน Work_Recieve)

---

## Spreadsheet 2 — generate_cust (`<GENCUST_SPREADSHEET_ID>`)
สำหรับสร้าง Customer_ID ผ่าน Google Apps Script (ดู `backup/gas/generateCustomerIDs.gs`)

### Sheet: `generateQ1`
| คอลัมน์ | ความหมาย |
|---------|----------|
| B `ชื่อลูกค้า` | ชื่อ (GAS อ่านคอลัมน์นี้) |
| K `Customer_ID` | รหัสที่ GAS สร้าง (เก็บเป็น text 18 ตัว) |
| + `โทรศัพท์`, `Loyverse UUID`, `รหัสลูกค้า`, `เยียมชมครั้งแรก`, `เยี่ยมชมล่าสุด` | sync มาจาก Loyverse |

> GAS อ้างอิงด้วยตำแหน่งคอลัมน์: NAME = คอลัมน์ 2 (B), ID = คอลัมน์ 11 (K), START_ROW = 2

---

## ความสัมพันธ์ (3 ID ของลูกค้า)
- **Customer_ID** — สร้างเอง (18 ตัว) = primary key ที่ NO.Rack ใช้
- **Loyverse_UUID** — id ภายในของ Loyverse (ใช้ match ตอน sync)
- **customer_code** — รหัสลูกค้าใน Loyverse (เก็บในช่อง `Customer ID` ของ customers.info)

```
Loyverse (POS) ──sync──► customers.info ──► generate_cust (สร้าง Customer_ID)
                                              │
บิลเปิดในเว็บ ──► Master register ◄── Receipt Sync (POS รับเงิน → รับแล้ว)
                      │
                      └── Work_Recieve (รูปผ้า) · MinIO (ไฟล์รูป)
```
