import PeopleTab from './hires/PeopleTab.jsx';

// เมนู Talent = Talent Book อย่างเดียว (ผู้ใช้สั่ง 1 ต.ค. 2026) — รวมคอมการ์ดและเรทราคาของนางแบบ / นักแสดง / พิธีกร / Live สด
// แบรนด์ไหนจ้างใคร ทีมกด "+ Talent Book" เพิ่มเก็บไว้ที่นี่เอง · ไม่มีแท็บงานทั้งหมด / ใบขอให้หา / ขอเรทราคา และไม่มีปุ่มเปิดงาน/ใบ/คำขอราคาแล้ว
// ฝั่ง server (เส้น /hires/tasks, /hires/jobs, /rate-requests และตารางข้อมูล) ยังอยู่ครบ เผื่อเปิดกลับ — หน้าเว็บแค่ไม่เรียกใช้
// ไม่อ่าน ?tab= / ?open= เลย: ลิงก์เก่า (?tab=jobs / requests / rates / home / people) มาลงหน้า Talent Book เหมือนกันหมด
// หน้างานเก่าแบบ campaign_type 'other' ยังเปิดได้จากลิงก์ /projects/:id (ProjectDetail → OtherProjectDetail)
export default function OtherWork() {
    return (
        <div className="th-hub">
            <header className="page-head th-head">
                <div>
                    <h1>Talent</h1>
                    <p className="page-sub">Talent Book — รวมคอมการ์ดและเรทราคาของนางแบบ นักแสดง พิธีกร Live สด แบรนด์ไหนจ้างใครเพิ่มเก็บไว้ที่นี่</p>
                </div>
            </header>

            <PeopleTab />
        </div>
    );
}
