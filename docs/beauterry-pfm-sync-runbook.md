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
