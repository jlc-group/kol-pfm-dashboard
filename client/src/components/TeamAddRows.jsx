import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import Icon from './Icon.jsx';
import ProductMultiSelect from './ProductMultiSelect.jsx';
import { mediaFor, tiersOf, productsFor, clipCountFor, splitCsv } from '../data/adGroups.js';

// แถวกรอกรายชื่อฝั่งทีม (หน้าแคมเปญ แท็บรายชื่อ KOL) — หน้าตาและกติกาเดียวกับกล่องกรอกของหน้าเอเจนซี่ (AgencyPortal TypeBox)
// ผู้ใช้สั่ง 6 ต.ค. 2026: กด "+ เพิ่มรายชื่อ" ในกล่องแล้วขึ้นเป็นแถวกรอก (เดิมเปิดหน้าต่าง AddSubmissionModal)
// - บังคับทุกช่องเหมือนเอเจนซี่: ชื่อ / Tier (มีให้เลือกหลายตัว) / ยอดฟอล / Product (กลุ่มมีสินค้าให้เลือก) / KOL Contact / Link Account
// - มีช่องค่าตัวต่อคลิปแบบไม่บังคับ (ฝั่งทีมใส่ได้ · เอเจนซี่ไม่มีช่องนี้)
// - Platform / Content Type มาจากกล่อง ไม่ต้องเลือก · บันทึกผ่าน POST /projects/:id/submissions (เส้นเดียวกับหน้าต่างเดิม)
// startNo = เลขลำดับของแถวใหม่แถวแรก (ต่อจากคนในกล่อง) · onSaved = โหลดรายชื่อใหม่
export default function TeamAddRows({ projectId, group, platform, contentType, startNo = 1, onSaved }) {
    const media = mediaFor(group, platform, contentType);
    const tierOpts = tiersOf(group, platform, contentType);
    const prodOpts = productsFor(group, platform);
    const clips = clipCountFor(group, platform);
    // uid = รหัสประจำแถว (ไม่ใช้ลำดับแถว) — บันทึกเสร็จ/ลบแถวแล้วลำดับเลื่อน จะได้ไม่ไปลบ/แก้แถวอื่นผิดตัว (รีวิว 6 ต.ค. 2026)
    const seq = useRef(0);
    // แถวที่กำลังส่งอยู่ — กด Enter ซ้ำ/รัวระหว่างรอ server ต้องไม่ส่งซ้ำ (ไม่งั้นได้ KOL ชื่อเดียวกัน 2 คน)
    const inFlight = useRef(new Set());
    const blank = () => ({ uid: ++seq.current, account_name: '', tier: tierOpts.length === 1 ? tierOpts[0] : '', followers: '', product: '', agency: '', budget: '', link_account: '', saving: false });
    // เริ่มต้นไม่มีแถว — กด "เพิ่มรายชื่อ" แล้วค่อยขึ้น (แบบเดียวกับเอเจนซี่)
    const [rows, setRows] = useState([]);
    const [err, setErr] = useState('');
    const [note, setNote] = useState('');
    useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(''), 6000);
        return () => clearTimeout(timer);
    }, [note]);
    const upRow = (uid, k, v) => setRows(rs => rs.map(x => (x.uid === uid ? { ...x, [k]: v } : x)));
    // สร้างแถว (uid) นอกตัวอัปเดต state — React อาจเรียกตัวอัปเดตซ้ำ แล้ว uid ของแถวที่ขึ้นจอแล้วจะเปลี่ยน
    const addRow = () => { const r = blank(); setRows(rs => [...rs, r]); };
    const removeRow = uid => setRows(rs => rs.filter(x => x.uid !== uid));

    // ช่องที่ยังไม่ได้กรอก — ใช้ทั้งปิดปุ่ม ✓ และบอกใน tooltip ว่าขาดอะไร (กติกาเดียวกับเอเจนซี่ · ค่าตัวไม่บังคับ)
    const filled = v => String(v ?? '').trim() !== '';
    const negative = v => filled(v) && Number(v) < 0;   // ไม่มี <form> เบราว์เซอร์จึงไม่เช็ค min="0" ให้ — เช็คเอง
    const missingOf = en => {
        const miss = [];
        if (!filled(en.account_name)) miss.push('ชื่อ Account');
        if (tierOpts.length > 1 && !filled(en.tier)) miss.push('Tier');
        if (!filled(en.followers)) miss.push('ยอดฟอล');
        else if (negative(en.followers)) miss.push('ยอดฟอล (ห้ามติดลบ)');
        if (prodOpts.length > 0 && !filled(en.product)) miss.push('Product');
        if (!filled(en.agency)) miss.push('KOL Contact');
        if (!filled(en.link_account)) miss.push('Link Account');
        if (negative(en.budget)) miss.push('ค่าตัว (ห้ามติดลบ)');
        return miss;
    };

    async function saveRow(uid) {
        const en = rows.find(r => r.uid === uid);
        if (!en || en.saving || inFlight.current.has(uid)) return;
        const miss = missingOf(en);
        if (miss.length) { setErr('กรอกไม่ครบ ขาด: ' + miss.join(', ')); return; }
        inFlight.current.add(uid);
        const tier = tierOpts.length === 1 ? tierOpts[0] : en.tier;
        setErr(''); upRow(uid, 'saving', true);
        try {
            const res = await api(`/projects/${projectId}/submissions`, {
                method: 'POST',
                body: {
                    account_name: en.account_name.trim(), group_key: group.key,
                    platform, content_type: contentType || null, tier: tier || null,
                    followers: Number(en.followers) || 0, product: en.product || null,
                    agency: en.agency.trim() || null, budget: Number(en.budget) || 0,
                    link_account: en.link_account.trim() || null
                }
            });
            setRows(rs => rs.filter(r => r.uid !== uid));
            // server ที่ยังไม่รีสตาร์ตหลัง deploy ไม่รับ Tier (เส้นเดิมไม่มีช่องนี้) — บันทึกได้แต่ Tier ว่าง ต้องบอกให้รู้
            const saved = res && res.data;
            setNote(tier && saved && !saved.tier
                ? `✓ บันทึก "${en.account_name.trim()}" แล้ว — แต่ Tier ยังไม่ถูกบันทึก (เซิร์ฟเวอร์ยังไม่อัปเดต) แก้ทีหลังได้`
                : `✓ บันทึก "${en.account_name.trim()}" แล้ว`);
            onSaved && onSaved();
        } catch (e) { setErr(e.message || 'บันทึกไม่สำเร็จ'); upRow(uid, 'saving', false); }
        finally { inFlight.current.delete(uid); }
    }

    return (
        <>
            {note && <div className="agency-saved ag-tb-saved">{note}</div>}
            {err && <div className="alert-error">{err}</div>}
            {rows.length > 0 && (
                <div className="ag-add-scroll">
                    <div className="ag-add-grid team">
                        <div className="ag-add-head">
                            <span>NAME</span><span>CONTENT TYPE</span><span>STYLE</span><span>TIER</span><span>FOLLOWER</span><span>PRODUCT</span>
                            <span>KOL CONTACT</span><span>ค่าตัว/คลิป</span><span>LINK ACCOUNT</span><span />
                        </div>
                        {rows.map((en, i) => {
                            const miss = missingOf(en);
                            return (
                                <div className={'ag-add-row' + (miss.length ? ' incomplete' : '')} key={en.uid}>
                                    <div className="atr-name">
                                        <span className="atr-num">{startNo + i}</span>
                                        <input value={en.account_name} onChange={e => upRow(en.uid, 'account_name', e.target.value)} placeholder="ชื่อ Account" autoFocus
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRow(en.uid); } }} />
                                    </div>
                                    {/* Content Type กับ Style ล็อกตามกล่อง โชว์ไว้ให้เห็นว่ากรอกอยู่ช่องไหน */}
                                    {contentType
                                        ? <div className="ag-fixed-cell" title={contentType + ' (ล็อกตามกล่องนี้)'}>{contentType}</div>
                                        : <div className="ag-fixed-cell muted">—</div>}
                                    {media.content_format
                                        ? <div className="ag-fixed-cell fmt" title={media.content_format + ' (ล็อกตามกล่องนี้)'}>{splitCsv(media.content_format).join(', ')}</div>
                                        : <div className="ag-fixed-cell muted">—</div>}
                                    {tierOpts.length === 1
                                        ? <div className="ag-fixed-cell" title={tierOpts[0] + ' (ช่องนี้เปิดรับ Tier เดียว)'}>{tierOpts[0]}</div>
                                        : (
                                            <select value={en.tier} disabled={tierOpts.length === 0} onChange={e => upRow(en.uid, 'tier', e.target.value)} aria-label="Tier">
                                                <option value="">{tierOpts.length ? '— เลือก Tier —' : '— ไม่ได้ระบุ Tier —'}</option>
                                                {tierOpts.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        )}
                                    <input type="number" min="0" value={en.followers} onChange={e => upRow(en.uid, 'followers', e.target.value)} placeholder="ยอดฟอล" />
                                    <ProductMultiSelect value={en.product} options={prodOpts} onChange={v => upRow(en.uid, 'product', v)} />
                                    <input value={en.agency} onChange={e => upRow(en.uid, 'agency', e.target.value)} placeholder="KOL Contact" />
                                    <input type="number" min="0" inputMode="numeric" value={en.budget} onChange={e => upRow(en.uid, 'budget', e.target.value)}
                                        placeholder="ไม่บังคับ" aria-label="ค่าตัวต่อคลิป"
                                        title={clips > 1 ? `ค่าตัวต่อคลิป — ทุกคลิปได้ยอดนี้ (× ${clips} คลิป)` : 'ค่าตัวต่อคลิป — ไม่ใส่ก็ได้ ใส่ทีหลังที่รายชื่อ'} />
                                    <input type="url" value={en.link_account} onChange={e => upRow(en.uid, 'link_account', e.target.value)} placeholder="https://..." />
                                    <div className="atr-action">
                                        {/* กดบันทึกไม่ได้จนกว่าจะกรอกครบ — tooltip บอกว่าเหลือช่องไหน */}
                                        <button type="button" className="atr-ok"
                                            title={miss.length ? 'ยังกรอกไม่ครบ ขาด: ' + miss.join(', ') : 'บันทึกรายชื่อนี้'}
                                            disabled={en.saving || miss.length > 0} onClick={() => saveRow(en.uid)}>✓</button>
                                        <button type="button" className="atr-x" title={en.saving ? 'กำลังบันทึก…' : 'ลบแถว'} disabled={en.saving} onClick={() => removeRow(en.uid)}>×</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            <button type="button" className="agency-add-row list-add-row" onClick={addRow}>
                <Icon name="plus" size={15} /> เพิ่มรายชื่อ
            </button>
        </>
    );
}
