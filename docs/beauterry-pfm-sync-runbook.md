# Beauterry PFM Sync Runbook

เอกสารนี้เป็นข้อตกลงระหว่างสองโปรเจคสำหรับการส่ง metrics จาก Beauterry PFM
เข้า KOL Dashboard

## หน้าที่ของแต่ละโปรเจค

- `beauterry-pfm` เป็นเจ้าของข้อมูลต้นทางและ API
- `kol-pfm-dashboard` เป็นผู้เรียก API, map ค่า และบันทึกลงฐานข้อมูลของ KOL
- การแก้ query, field หรือความหมายของ metric ให้แก้ที่ `beauterry-pfm`
- การแก้ scheduler, mapping, freshness หรือการแสดงผลให้แก้ที่ `kol-pfm-dashboard`

## Credentials

ฝั่ง Beauterry ใช้ `KOL_PFM_EXPORT_KEY` สำหรับ:

```text
POST /api/v1/integrations/kol-pfm/metrics
X-PFM-API-Key: <key>
```

ฝั่ง KOL ต้องใช้ค่าเดียวกันในตัวแปร:

```env
BEAUTERRY_PFM_EXPORT_KEY=<same value as Beauterry KOL_PFM_EXPORT_KEY>
```

`ADS_SYNC_KEY` เป็นคนละหน้าที่ ใช้ป้องกัน endpoint ของ KOL เอง เช่น
`/api/ads-sync/pull-beauterry` และ `/api/ads-sync/beauterry-status` ห้ามใช้เป็น
fallback สำหรับเรียก Beauterry

ห้าม commit ค่า key, ใส่ key จริงใน `.env.example`, หรือส่ง key ใน chat/ticket
ทั่วไป หาก key หลุด ให้ rotate key ที่ Beauterry และ KOL พร้อมกัน แล้ว restart
process ของ KOL

## Environment policy

เครื่อง dev ให้ตั้งไว้ดังนี้เพื่อป้องกันการยิง production โดยไม่ตั้งใจ:

```env
BEAUTERRY_PFM_SYNC_ENABLED=false
```

Production ต้องตั้งค่าครบและห้ามพึ่ง default:

```env
BEAUTERRY_PFM_SYNC_ENABLED=true
BEAUTERRY_PFM_BASE_URL=http://127.0.0.1:8202
BEAUTERRY_PFM_EXPORT_KEY=<secret>
BEAUTERRY_PFM_SYNC_INTERVAL_SECONDS=3600
BEAUTERRY_PFM_SYNC_INITIAL_DELAY_SECONDS=30
```

ถ้า Beauterry อยู่คนละ server ให้เปลี่ยน `BEAUTERRY_PFM_BASE_URL` เป็น public
HTTPS URL และตรวจ network/DNS ก่อน restart

## Verification checklist

1. รัน `npm test`
2. รัน `npm run check:production`
3. Restart เฉพาะ `kol-pfm-dashboard-prod`
4. เรียก `GET /api/ads-sync/beauterry-status` ด้วย `X-Ads-Sync-Key`
5. ต้องเห็น `enabled=true`, `configured=true` และ `last_run.status=success`
6. ตรวจ `requested`, `received`, `source_not_found` ทุกครั้งหลัง deploy

HTTP 401 จาก Beauterry โดยไม่ส่ง key แปลว่า route และ key gate ทำงาน
แต่ยังไม่ใช่หลักฐานว่า key ของ KOL ตรงกัน ต้องยืนยันด้วย successful sync จริง

## Change procedure

การเปลี่ยน API contract ต้องทำตามลำดับนี้:

1. แก้ provider ใน `beauterry-pfm`
2. อัปเดตเอกสารและ test contract
3. แก้ consumer ใน `kol-pfm-dashboard`
4. รัน test ทั้งสอง repo
5. deploy provider ก่อน แล้วจึง deploy consumer
6. ตรวจสถานะ sync หลัง deploy

## Developer push boundaries

โปรเจคนี้ใช้ GitHub webhook auto deploy ดังนั้นการ merge หรือ push เข้า
`main` ถือว่าเป็นการขอ deploy production ด้วย ไม่ควร push งานที่ยังไม่ผ่าน
review หรือยังไม่ได้รันทดสอบขึ้น `main`

ทีม Dev ทำได้:

- พัฒนาและทดสอบในเครื่อง dev โดยใช้ `BEAUTERRY_PFM_SYNC_ENABLED=false`
- แก้ code, test และเอกสารใน repo ที่เป็นเจ้าของเรื่องนั้น
- เปิด PR ให้ตรวจ diff, test และผลกระทบก่อน merge เข้า `main`
- ใช้ `npm test` และ `npm run check:production` ก่อนส่ง release

ทีม Dev ห้ามทำ:

- commit หรือ push ไฟล์ `.env`, key จริง, password หรือค่าของ production
- ใช้ `ADS_SYNC_KEY` แทน `BEAUTERRY_PFM_EXPORT_KEY`
- แก้ไฟล์ในโฟลเดอร์ `Production` เพื่อทำเป็น deployment หลัก
- รัน setup database, seed หรือ migration บน production โดยไม่ได้รับอนุมัติและ
  ไม่มีแผน backup/rollback
- deploy API consumer ก่อน provider เมื่อมีการเปลี่ยน contract

การเปลี่ยนค่า production-only เช่น key, database, `UPLOAD_DIR`, port หรือ PM2
ให้ทำผ่านขั้นตอนดูแล production ที่ได้รับอนุมัติ แล้ว restart เฉพาะ process ที่
เกี่ยวข้อง จากนั้นตรวจ readiness และสถานะ sync ทุกครั้ง

ถ้าเป็นเอกสารหรือ code ที่ไม่ควรขึ้น production ทันที ให้ทำงานบน branch/PR
และอย่า merge เข้า `main` จนกว่าจะพร้อมรับผลของ auto deploy
