# KOL Central Dashboard v2

## เตรียมใช้งานผ่าน we-platform (2026-09-10)

โค้ดรองรับ build จาก root และเปิดหน้าเว็บ/API ด้วย Node process เดียวแล้ว
**Production ออนไลน์ที่ `https://kol-pfm-dashboard.wejlc.com` แล้ว** — แอปและ tunnel แยกทำงานผ่าน PM2, ตั้ง `.env` และตรวจฐานข้อมูลจริงผ่านแล้ว เหลือยืนยัน GitHub webhook auto deploy
รายละเอียดการลงทะเบียน การตั้งค่า และ rollback อยู่ที่ [docs/we-platform-deployment.md](docs/we-platform-deployment.md)

```bash
# Node.js 22.12+; แนะนำ Node 22 LTS ตาม CI
npm ci
npm run build          # ติดตั้ง server/client ตาม lockfile, build และทดสอบ API
npm run test:browser   # ต้องติดตั้ง Chromium: npx playwright install chromium
npm run check:production  # ตรวจ config/build/ตาราง DB แบบอ่านอย่างเดียว
npm start             # หน้าเว็บและ API ใช้พอร์ตเดียว
```

เมื่อใช้ production ต้องตั้ง `NODE_ENV=production`, พอร์ตที่ลงทะเบียนแล้ว, ค่า PostgreSQL/JWT
และ `UPLOAD_DIR` เป็น absolute path ภายนอกโฟลเดอร์ deploy ที่สร้างไว้แล้ว
ระบบอ่าน environment ของ process ก่อน แล้วจึง root `.env` และ `server/.env` ตามลำดับ
ห้ามใช้ `start-dashboard.bat` หรือ Vite dev server เป็น production service

สถานะ/คำสั่งในหัวข้อเดิมด้านล่างเป็นข้อมูลพัฒนาระบบ ไม่ใช่หลักฐานว่า production ออนไลน์แล้ว

Dashboard กลางสำหรับหลายทีม — สร้างใหม่ ไม่ต่อยอดจากของเดิม

## สถานะปัจจุบัน
- ✅ **Phase 1: Backend + Auth** — API + Login/Role + Project แยกตามทีม
- ✅ **Phase 2: Frontend** (React 18 + Vite)
- ✅ **Phase 3: PostgreSQL** — ข้อมูลทั้งหมดอยู่ในฐานข้อมูลจริงแล้ว
- ⏳ **Phase 4: Deploy**

## ที่เก็บข้อมูล (Data Driver)
ข้อมูลจริงเก็บใน **PostgreSQL** ฐานข้อมูล `kol_dashboard` (14 ตาราง)

ตั้งค่าที่ `server/.env`:
```
DATA_DRIVER=postgres
DB_HOST=...   DB_PORT=5432   DB_NAME=kol_dashboard
DB_USER=...   DB_PASSWORD=...
```

ยังมีไดรเวอร์ `json` (`server/data/db.json`) เหลือไว้ — ไม่ใช่ที่เก็บจริงแล้ว
ใช้เป็น **ตัวเทียบผล** ตอนรัน `npm run parity` เพื่อพิสูจน์ว่า PostgreSQL ให้ผลเหมือนเดิมทุกประการ

ทุก route (102 เส้น) เรียกผ่าน `src/store/` ตัวเดียว จึงสลับไดรเวอร์ได้โดยไม่ต้องแก้ route

## โครงสร้าง
```
dashboard-v2/
├── server/                 # Backend (Node.js + Express)
│   ├── src/
│   │   ├── index.js        # entry + /api/health, /api/stats/overview
│   │   ├── middleware/auth.js   # ตรวจ JWT + role
│   │   ├── routes/         # auth, teams, users, kols, projects
│   │   ├── store/
│   │   │   ├── index.js    # เลือกไดรเวอร์ตาม DATA_DRIVER
│   │   │   ├── pgStore.js  # ★ ไดรเวอร์จริง — รวมโมดูลใน pg/
│   │   │   ├── pg/         # pgStore แยกตามโดเมน + _base.js (type parser) + _snapshot.js
│   │   │   ├── logic.js    # ตรรกะบริสุทธิ์ที่สองไดรเวอร์ใช้ร่วมกัน (CPM/CPE/การจัดกลุ่ม)
│   │   │   └── jsonStore.js# ไดรเวอร์ไฟล์ — ใช้เป็นตัวเทียบผลเท่านั้น
│   │   ├── models/schema.sql    # schema PostgreSQL (14 ตาราง)
│   │   └── scripts/        # setupDatabase.js, migrateToPostgres.js, parityCheck.js, seed.js
│   └── data/db.json        # ข้อมูลของไดรเวอร์ json (gitignored)
└── client/                 # Frontend (React 18 + Vite)
```

## วิธีรัน (Backend)
```bash
cd server
npm install
npm run setup-db   # สร้างตารางใน PostgreSQL (ครั้งแรก)
npm run seed       # สร้าง admin + ข้อมูลตัวอย่าง (ครั้งแรก)
npm run dev        # เปิด server ที่ http://localhost:4000
```

### คำสั่งเกี่ยวกับฐานข้อมูล
| คำสั่ง | หน้าที่ |
|--------|---------|
| `npm run setup-db` | สร้าง/อัปเดตตารางตาม `schema.sql` |
| `npm run migrate`  | ย้ายข้อมูลจาก `data/db.json` เข้า PostgreSQL (ทั้งหมดใน transaction เดียว · `--force` = ทับของเดิม) |
| `npm run parity`   | เทียบผลลัพธ์ทุก method ระหว่าง jsonStore กับ pgStore |

## บัญชีเริ่มต้น (หลัง seed)
| role   | username | password                              | ทีม        |
|--------|----------|---------------------------------------|------------|
| admin  | admin    | ตั้งเองที่ `ADMIN_PASSWORD` ใน `server/.env` | Admin Team |
| member | member1  | ตั้งเองตอน seed                          | Team A     |

> ⚠️ ก่อน seed ให้ตั้ง `ADMIN_PASSWORD` และ `JWT_SECRET` ใน `server/.env` เป็นค่าของตัวเอง
> อย่าใช้ค่าตัวอย่างจาก `.env.example` และเปลี่ยนรหัสผ่านทุกบัญชีก่อนเปิดใช้งานจริง

## API หลัก
| Method | Path | สิทธิ์ | หน้าที่ |
|--------|------|--------|---------|
| POST | `/api/auth/login` | ทุกคน | เข้าสู่ระบบ → JWT |
| GET  | `/api/auth/me` | ล็อกอิน | ข้อมูลตัวเอง |
| GET  | `/api/stats/overview` | ล็อกอิน | ตัวเลขสรุป |
| GET/POST/PUT/DELETE | `/api/teams` | ดู=ทุกคน / แก้=admin | จัดการทีม |
| GET/POST/PUT/DELETE | `/api/users` | admin | จัดการผู้ใช้ |
| GET | `/api/kols` | ล็อกอิน | KOL ส่วนกลาง (ทุกทีมเห็นเหมือนกัน) |
| POST/PUT/DELETE | `/api/kols` | admin | จัดการ KOL ส่วนกลาง |
| GET/POST/PUT/DELETE | `/api/projects` | member=ทีมตัวเอง / admin=ทั้งหมด | Project ของแต่ละทีม |
| POST/DELETE | `/api/projects/:id/kols` | เจ้าของทีม/admin | เพิ่ม-ลบ KOL ใน Project |

## แนวคิดข้อมูล
- **kols** = ข้อมูล KOL ส่วนกลาง ทุกทีมเห็นเหมือนกัน
- **teams / users** = ทีม + ผู้ใช้ (สังกัดทีม, role `admin`/`member`)
- **projects** = แต่ละทีมสร้าง Project ของตัวเอง (member เห็นเฉพาะของทีม, admin เห็นหมด)
- **project_kols** = KOL ที่หยิบเข้ามาในแต่ละ Project
