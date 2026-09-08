const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const N = n => (Number(n) || 0).toLocaleString('th-TH');

// เขียนสรุปเป็นภาษาคน จากส่วนประกอบคะแนนที่ server ส่งมา
function verdict(k) {
    const parts = k.score_parts || [];
    const by = key => parts.find(p => p.key === key) || { earned: 0, weight: 0 };
    const strong = parts.filter(p => p.weight > 0 && p.earned / p.weight >= 0.7);
    const weak = parts.filter(p => p.weight > 0 && p.earned / p.weight <= 0.3);
    const costPts = by('cpm').earned + by('cpe').earned;      // เต็ม 40
    const reachPts = by('er').earned + by('views').earned;    // เต็ม 60

    const lines = [];
    if (strong.length) lines.push(`ได้คะแนนดีจาก ${strong.map(p => p.label).join(' และ ')}`);
    if (weak.length) lines.push(`เสียคะแนนที่ ${weak.map(p => p.label).join(' และ ')}`);

    // ประเด็นที่มักเป็นสาเหตุจริง: วิวเยอะแต่ต้นทุนแพง
    if (by('views').earned / 25 >= 0.7 && costPts / 40 <= 0.35) {
        lines.push(`ยอดวิวสูง แต่ต้นทุนรวมทำให้ CPM ${B(k.cpm)} และ CPE ${B(k.cpe)} แพงกว่าคนอื่น จึงเสียคะแนนด้านความคุ้มค่าไปเกือบหมด`);
    } else if (costPts / 40 >= 0.7 && reachPts / 60 <= 0.35) {
        lines.push(`ต้นทุนคุ้มมาก แต่ยอดวิวและ engagement ยังน้อยกว่าคนอื่นในกลุ่ม`);
    } else if (costPts / 40 >= 0.6 && reachPts / 60 >= 0.6) {
        lines.push('คุ้มค่าและผลงานดีไปพร้อมกัน เป็นโปรไฟล์ที่น่าจ้างซ้ำ');
    }
    return lines;
}

/**
 * อธิบายว่าคะแนนนี้มาจากไหน — อ้างอิงเกณฑ์ที่ตั้งไว้ ไม่ใช่ความเห็นลอย ๆ
 * k = 1 แถวจาก top_kols (ต้องมี score_parts)
 */
export default function ScoreModal({ k, onClose }) {
    if (!k) return null;
    const parts = k.score_parts || [];
    const notes = verdict(k);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="draft-head">
                    <div className="draft-name">
                        📊 ที่มาของคะแนน · {k.name}
                        <span className="muted"> · {k.platform || '—'}{k.brand ? ` · ${k.brand}` : ''}</span>
                    </div>
                </div>

                <div className="sc-top">
                    <div className="sc-total">
                        <div className="sc-total-v">{k.score}</div>
                        <div className="sc-total-k">คะแนนรวม / 100</div>
                    </div>
                    <div className="sc-meta">
                        {k.score_rank && (
                            <div>อันดับ <b>{k.score_rank}</b> จาก <b>{k.score_pool}</b> คนที่กรอกผลงานแล้ว</div>
                        )}
                        <div className="muted">คะแนนคิดจากการเทียบกับ KOL คนอื่นในช่วงเวลาและตัวกรองที่เลือกอยู่</div>
                    </div>
                </div>

                <div className="sc-table-wrap">
                    <table className="sc-table">
                        <thead>
                            <tr>
                                <th>ตัวชี้วัด</th><th className="num">ค่าที่ทำได้</th>
                                <th>ทิศทางที่ดี</th><th className="num">คะแนนที่ได้</th><th>เทียบในกลุ่ม</th>
                            </tr>
                        </thead>
                        <tbody>
                            {parts.map(p => {
                                const ratio = p.weight > 0 ? p.earned / p.weight : 0;
                                const tone = ratio >= 0.7 ? 'good' : ratio <= 0.3 ? 'bad' : 'mid';
                                return (
                                    <tr key={p.key}>
                                        <td><b>{p.label}</b></td>
                                        <td className="num">
                                            {p.unit === '฿' ? B(p.value) : N(p.value)}{p.unit === '%' ? '%' : ''}
                                        </td>
                                        <td className="muted">{p.better === 'ต่ำ' ? 'ยิ่งต่ำยิ่งดี' : 'ยิ่งสูงยิ่งดี'}</td>
                                        <td className="num">
                                            <span className={'sc-pts ' + tone}>{p.earned}</span>
                                            <span className="muted"> / {p.weight}</span>
                                        </td>
                                        <td className="muted">{p.note || '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan="3"><b>รวม</b></td>
                                <td className="num"><b>{k.score}</b><span className="muted"> / 100</span></td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {notes.length > 0 && (
                    <div className="sc-verdict">
                        <b>สรุป</b>
                        <ul>{notes.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                )}

                <div className="sc-formula muted">
                    เกณฑ์ให้น้ำหนัก: Engagement Rate 35% · ยอดวิว 25% · CPM 20% · CPE 20%
                    <br />ต้นทุนที่ใช้คิด CPM/CPE = ค่าตัว + ค่ายิงแอดรวมกัน
                </div>

                <div className="modal-actions">
                    <button type="button" className="btn-primary" onClick={onClose}>ปิด</button>
                </div>
            </div>
        </div>
    );
}
