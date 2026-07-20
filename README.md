# NO.Rack PWA — frontend ของระบบร้านซักผ้า

แอปที่พนักงานใช้บนแท็บเล็ตหน้าร้าน: เปิดบิล · จัดตำแหน่งราว · ถ่ายรูปผ้า · ค้นลูกค้า · รับผ้า

> ⚠️ **repo นี้เป็น PUBLIC** (deploy ขึ้น GitHub Pages) → bundle ต้องมีแต่ **โค้ด** เท่านั้น
> **ห้ามมีข้อมูลลูกค้าหรือ secret ฝังใน repo/bundle เด็ดขาด** · ค่าลับทั้งหมดอยู่ฝั่ง server

---

## ระบบนี้ต่อกับอะไร

```
แท็บเล็ตพนักงาน
   │
   ├─ CF Pages  norack.winterarmy.net   (host หลัก)
   └─ GitHub Pages                       (host สำรอง — ใช้ตอน Cloudflare ล่ม)
        │
        │  Bearer token (ไม่ใช่ cookie — คนละ site กัน cookie โดนบล็อก)
        ▼
   ┌─ CF Workers  (API หลัก) ─┐
   │                          ├──► Turso (DB) · Backblaze B2 (รูป, private + presigned)
   └─ Deno Deploy (API สำรอง)─┘
```

- **สลับ backend ได้ในแอป** (dropdown "เว็บ" บน header) + auto-failover: GET ล้ม → ลองอีก runtime
  ส่วน **write จะ failover เฉพาะ network error** เท่านั้น (5xx/timeout อาจเขียนสำเร็จไปแล้ว = กันเขียนซ้ำ)
- **ไม่มี SSE แล้ว** ใช้ polling เบาๆ แทน
- backend อยู่คนละ repo: `D:\Project_Web_DB_Oncloud`

## เริ่มพัฒนา

```bash
npm install
npm run dev            # โหมด dev
npm run lint           # ต้องสะอาดก่อน commit
npm run build          # build สำหรับ GitHub Pages (base=/norack-pwa/)
npm run build:pages    # build สำหรับ CF Pages (base=/)
```

> deploy: **push = GitHub Pages ขึ้นเอง** · CF Pages ต้อง `npm run build:pages` แล้ว
> `npx wrangler pages deploy dist --project-name=norack-pwa`

## ไฟล์ที่ต้องรู้จัก

| ไฟล์ | หน้าที่ |
|---|---|
| `src/api/norack.js` | **จุดแก้ API ทั้งหมด** — auth, failover, cache ลูกค้า, upload รูป |
| `src/pages/TabletDashboard.jsx` | หน้าจอหลักเกือบทั้งแอป (~2,900 บรรทัด — มีแผนแตกไฟล์ ดูท้ายเอกสาร) |
| `src/components/AuthGate.jsx` | ล็อกอิน + ต่ออายุ session + บังคับหมดอายุ |
| `src/api/dates.js` | ISO ↔ พ.ศ. — **แปลงตอนแสดงผลเท่านั้น ห้ามเก็บ พ.ศ.** |
| `public/_headers` | security headers (มีผลเฉพาะ CF Pages) |
| `index.html` | มี **CSP เป็น meta** เพราะ GitHub Pages ส่ง custom header ไม่ได้ — แก้ต้องแก้คู่กับ `_headers` |

## กฎที่ห้ามเผลอทำผิด

1. **PII บนเครื่องอยู่ได้แค่ตอน login** — ลิสต์ลูกค้าถอดรหัสถูก cache ใน IndexedDB เพื่อความเร็ว
   ต้องถูกล้างเมื่อ **logout / 401 / token หมดอายุ** ครบทั้ง 3 ทาง (เคยมีบั๊กที่ทางที่ 3 ไม่เคยทำงานเลย)
2. **ห้ามรายงานว่าสำเร็จถ้ายังไม่รู้ว่าสำเร็จ** — ทุก write ต้องเช็ค error ก่อนขึ้นข้อความว่าบันทึกแล้ว
   (เคยมีทั้งรูปที่ขึ้น "saved" ทั้งที่ไม่ได้อัป และบิลที่ขึ้นสำเร็จทั้งที่ server ตอบ error)
3. **partial update: ไม่ส่ง field ที่ตัวเองไม่มีค่า** — ส่ง key พร้อมค่าว่าง = สั่งลบค่าเดิมใน DB
   และห้ามส่งวันที่เป็น `''` (ดู [data-model.md](./docs/data-model.md) กฎข้อ 2 ว่าทำไมอันตราย)
4. **วันที่**: เก็บ/ส่ง ISO เสมอ แสดงผลเป็น พ.ศ. เท่านั้น

## เอกสาร

| อ่านเมื่อ | ไปที่ |
|---|---|
| อยากรู้โครงสร้างข้อมูล | [docs/data-model.md](./docs/data-model.md) ← **ปัจจุบัน** |
| ขั้นตอนงานพนักงานหน้าร้าน | [docs/operations-manual.md](./docs/operations-manual.md) (โครงสร้างพื้นฐานในนั้น = ยุคเก่า มีป้ายกำกับไว้) |
| สถาปัตยกรรม / ดูแลระบบ / DR / troubleshooting | Obsidian vault `D:\homeserver_manual\web_db_oncloud\` |
| API + schema | vault `web-db-oncloud-api.md` |

## งานค้างที่รู้อยู่

- **`TabletDashboard.jsx` ใหญ่เกินไป (~2,900 บรรทัด = 74% ของโค้ดทั้ง repo)** — ไฟล์เดียวถูกแก้ด้วย
  เหตุผล 8 อย่างที่ไม่เกี่ยวกัน แผนที่เสนอไว้: แยก `features/bills/` (โมดัล write ~810 บรรทัด) และ
  `features/photos/` ออกก่อน แล้วเหลือหน้าหลักเป็น nav + polling + toast (~150 บรรทัด)
- ป้าย LINE บน header โหลดสถานะ **ครั้งเดียวตอน mount** — ถ้า request นั้นพลาด (เช่นตอน deploy backend)
  จะค้างเป็นจุดเทาจนกว่าจะ reload หน้า ทั้งที่ระบบปกติ
