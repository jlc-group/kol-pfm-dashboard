import { useState } from 'react';
import { api } from '../api/client.js';
import { productsByBrand, productLabel } from '../data/products.js';
import { visibleBrands } from '../data/brands.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';

// ฟอร์มสอบถามราคา — ถามได้ 2 แบบ ซึ่งคนละเรื่องกัน จึงต้องเลือกก่อนแล้วช่องค่อยขึ้นตามที่เลือก
//  • KOL       = จ้างลงคลิป/โพสต์เป็นครั้ง ๆ สนใจช่องทางที่จะลงงาน
//  • Presenter = ใช้ภาพเป็นพรีเซ็นเตอร์ตามสัญญา สนใจระยะเวลาสัญญาและสื่อที่จะเอาภาพไปใช้
// ช่องของ Presenter เป็นชุดตั้งต้นไว้ก่อน เดี๋ยวปรับตามที่ใช้จริงอีกที
const OTHER = 'อื่น ๆ';
const KOL_CHANNELS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
const PRESENTER_MEDIA = ['TVC / ทีวี', 'Online / โซเชียล', 'OOH / ป้ายโฆษณา', 'In-store / หน้าร้าน', 'Event / ออกงาน', 'สื่อสิ่งพิมพ์', 'แพ็กเกจจิ้ง', 'อื่น ๆ'];

const TEXT = {
    kol: {
        name: 'ชื่อ KOL ที่ต้องการทราบเรท *',
        namePh: 'เช่น @username หรือชื่อ KOL',
        link: 'ลิงก์ Account / Social Media',
        linkPh: 'IG / TikTok / Facebook ของ KOL (https://...)',
        channel: 'ช่องทางที่ต้องการให้ KOL ลงงาน',
        scope: 'Scope งานที่ต้องการให้ KOL ทำ',
        scopePh: 'เช่น รีวิว 1 คลิป + ภาพ 3 รูป ลง TikTok, ติด #แบรนด์...',
        budget: 'Budget ที่กำหนด'
    },
    presenter: {
        name: 'ชื่อคนที่อยากได้เป็นพรีเซ็นเตอร์ *',
        namePh: 'เช่น ชื่อนักแสดง / ศิลปิน',
        link: 'ลิงก์ Account / Social Media',
        linkPh: 'IG / TikTok / Facebook หรือลิงก์ผลงาน (https://...)',
        channel: 'สื่อที่จะใช้ภาพ / ขอบเขตการใช้งาน',
        scope: 'ขอบเขตงานที่ต้องการ',
        scopePh: 'เช่น ถ่าย TVC 1 ชุด + ออกงานเปิดตัว 1 ครั้ง + โพสต์ลงโซเชียล 4 ครั้ง',
        budget: 'งบประมาณที่ตั้งไว้'
    }
};

const genKey = () => 'p' + Math.random().toString(36).slice(2, 8);

export default function RateCardForm({ onClose, onSaved, defaultBrand = '' }) {
    // เห็นเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์ — server กันอีกชั้นแล้ว ถ้าเลือกแบรนด์อื่นจะตีกลับ 403
    const { user } = useAuth();
    const BRANDS = visibleBrands(user);
    const [f, setF] = useState({
        request_type: '', people: [{ key: genKey(), name: '', link: '' }],
        brand: defaultBrand && BRANDS.includes(defaultBrand) ? defaultBrand : '', products: [], platforms: [],
        platforms_other: '', contract_period: '', scope: '', budget: '', no_budget: false, brief_link: '', brief_note: ''
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const setPerson = (i, k, v) => setF(s => ({ ...s, people: s.people.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)) }));
    const addPerson = () => setF(s => ({ ...s, people: [...s.people, { key: genKey(), name: '', link: '' }] }));
    const removePerson = i => setF(s => ({ ...s, people: s.people.length > 1 ? s.people.filter((_, idx) => idx !== i) : s.people }));
    const toggleProduct = c => setF(s => ({ ...s, products: s.products.includes(c) ? s.products.filter(x => x !== c) : [...s.products, c] }));
    const togglePlatform = p => setF(s => {
        const on = s.platforms.includes(p);
        const platforms = on ? s.platforms.filter(x => x !== p) : [...s.platforms, p];
        // ติ๊ก "อื่น ๆ" ออกแล้วต้องล้างข้อความที่พิมพ์ไว้ด้วย ไม่งั้นค่าค้างจะติดไปกับคำขอโดยไม่มีใครเห็น
        return { ...s, platforms, platforms_other: (p === OTHER && on) ? '' : s.platforms_other };
    });
    // สลับประเภทแล้วล้างตัวเลือกสื่อทิ้ง เพราะสองแบบใช้คนละชุด ถ้าเก็บไว้จะได้ค่าที่ไม่มีในรายการใหม่ค้างอยู่
    const pickType = t => setF(s => ({ ...s, request_type: t, platforms: [] }));

    const isPresenter = f.request_type === 'presenter';
    const t = TEXT[isPresenter ? 'presenter' : 'kol'];
    const chosen = f.request_type === 'kol' || isPresenter;

    async function submit(e) {
        e.preventDefault();
        if (!chosen) { setError('กรุณาเลือกก่อนว่าสอบถามราคาของ KOL หรือ Presenter'); return; }
        // แถวที่ไม่ได้ใส่ชื่อถือว่าไม่ได้ใช้ ตัดทิ้งไปเลย
        const people = f.people
            .map(p => ({ name: (p.name || '').trim(), link: (p.link || '').trim() || null }))
            .filter(p => p.name);
        // ต้องมีแบรนด์เสมอ — รายการคำขอกรองตามสิทธิ์แบรนด์ ไม่มีแบรนด์ = คนเปิดเองก็มองไม่เห็น
        if (!f.brand) { setError('กรุณาเลือกแบรนด์'); return; }
        if (!people.length) { setError(isPresenter ? 'กรุณาระบุชื่อคนที่อยากได้เป็นพรีเซ็นเตอร์' : 'กรุณาระบุชื่อ KOL ที่ต้องการทราบเรท'); return; }
        setError(''); setSaving(true);
        try {
            await api('/rate-requests', {
                method: 'POST',
                body: {
                    request_type: f.request_type,
                    people, brand: f.brand || null,
                    products: f.products,
                    // เก็บข้อความของ "อื่น ๆ" ต่อท้ายตัวเลือกเดิม จะได้ไม่ต้องเพิ่มคอลัมน์ใหม่ในฐาน
                    platforms: f.platforms.map(p => (p === OTHER && f.platforms_other.trim() ? OTHER + ': ' + f.platforms_other.trim() : p)),
                    contract_period: isPresenter ? (f.contract_period || null) : null,
                    scope: f.scope || null, budget: f.no_budget ? null : (Number(f.budget) || 0), no_budget: f.no_budget,
                    brief_link: f.brief_link || null, brief_note: f.brief_note || null
                }
            });
            onSaved && onSaved();
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }

    const availProducts = productsByBrand(f.brand);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head"><h3>สอบถามราคา</h3><button className="modal-x" onClick={onClose}>×</button></div>
                {error && <div className="alert-error">{error}</div>}
                <form onSubmit={submit}>
                    <div className="field">
                        <label>สอบถามราคาของ *</label>
                        <select value={f.request_type} onChange={e => pickType(e.target.value)}>
                            {/* ตัวเลือกว่างมีเฉพาะตอนยังไม่ได้เลือก — เลือกแล้วย้อนกลับไปว่างไม่ได้ ข้อมูลที่กรอกจะได้ไม่หาย */}
                            {!chosen && <option value="">— เลือก —</option>}
                            <option value="kol">KOL</option>
                            <option value="presenter">Presenter</option>
                        </select>
                        <span className="rc-type-hint">
                            {!chosen ? 'เลือกก่อน แล้วช่องกรอกจะขึ้นให้'
                                : isPresenter ? 'ใช้ภาพเป็นพรีเซ็นเตอร์ตามสัญญา — ระบุระยะเวลาและสื่อที่จะใช้ภาพ'
                                    : 'จ้างลงคลิป/โพสต์เป็นครั้ง ๆ — ระบุช่องทางที่จะให้ลงงาน'}
                        </span>
                    </div>

                    {chosen && (<>
                        <div className="field">
                            <label>แบรนด์ *</label>
                            <select value={f.brand} onChange={e => { up('brand', e.target.value); up('products', []); }}>
                                <option value="">เลือกแบรนด์</option>
                                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label>สินค้า</label>
                            {f.products.length > 0 && (
                                <div className="chip-list" style={{ marginBottom: 8 }}>
                                    {f.products.map(c => <span className="chip-item" key={c}>{productLabel(c)}<button type="button" onClick={() => toggleProduct(c)}>×</button></span>)}
                                </div>
                            )}
                            <select value="" disabled={!f.brand} onChange={e => {
                                if (e.target.value === '__ALL__') {
                                    const allSel = availProducts.length > 0 && availProducts.every(p => f.products.includes(p.code));
                                    up('products', allSel ? [] : availProducts.map(p => p.code));
                                } else if (e.target.value) toggleProduct(e.target.value);
                                e.target.value = '';
                            }}>
                                <option value="">{f.brand ? '+ เลือกสินค้า...' : '— เลือกแบรนด์ก่อน —'}</option>
                                {f.brand && availProducts.length > 0 && (
                                    <option value="__ALL__">{availProducts.every(p => f.products.includes(p.code)) ? '✓ ทุกสินค้า (เลือกครบแล้ว)' : '☑ เลือกทุกสินค้า'}</option>
                                )}
                                {availProducts.filter(p => !f.products.includes(p.code)).map(p => <option key={p.code} value={p.code}>{p.code} - {p.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label>{t.name}</label>
                            <span className="rc-type-hint">ใส่ชื่อ 1 คนต่อ 1 ช่อง พร้อมลิงก์ของคนนั้น — หลายคนกด "เพิ่มรายชื่อ"</span>
                            {/* บันทึกเป็นคำขอแยกใบต่อคน จะได้ตอบราคาให้ทีละคนได้ (ราคาของแต่ละคนไม่เท่ากัน) */}
                            {f.people.map((p, i) => (
                                <div className="rate-person" key={p.key}>
                                    <span className="rate-person-no">#{i + 1}</span>
                                    <input className="rate-person-name" value={p.name}
                                        onChange={e => setPerson(i, 'name', e.target.value)} placeholder={t.namePh} />
                                    <input type="url" value={p.link}
                                        onChange={e => setPerson(i, 'link', e.target.value)} placeholder={t.linkPh} />
                                    {f.people.length > 1 && (
                                        <button type="button" className="hire-del" title="เอาชื่อนี้ออก" onClick={() => removePerson(i)}>
                                            <Icon name="trash" size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button type="button" className="btn-ghost hire-add" onClick={addPerson}>
                                <Icon name="plus" size={15} /> เพิ่มรายชื่อ
                            </button>
                        </div>

                        {isPresenter && (
                            <div className="field">
                                <label>ระยะเวลาสัญญา</label>
                                <input value={f.contract_period} onChange={e => up('contract_period', e.target.value)}
                                    placeholder="เช่น 6 เดือน / 1 ปี / เฉพาะแคมเปญนี้" />
                            </div>
                        )}

                        <div className="field">
                            <label>{t.channel}</label>
                            <div className="rc-chips">
                                {(isPresenter ? PRESENTER_MEDIA : KOL_CHANNELS).map(p => (
                                    <button type="button" key={p} className={'rc-chip' + (f.platforms.includes(p) ? ' on' : '')} onClick={() => togglePlatform(p)}>{p}</button>
                                ))}
                            </div>
                            {/* ติ๊ก "อื่น ๆ" แล้วต้องบอกได้ว่าคืออะไร ไม่งั้นคนตอบราคาเดาไม่ถูก */}
                            {f.platforms.includes(OTHER) && (
                                <input className="hire-link-input" value={f.platforms_other}
                                    onChange={e => up('platforms_other', e.target.value)}
                                    placeholder={isPresenter ? 'ระบุสื่ออื่น ๆ เช่น จอ LED ในห้าง / สื่อในลิฟต์' : 'ระบุช่องทางอื่น ๆ'} />
                            )}
                        </div>
                        <div className="field">
                            <label>{t.scope}</label>
                            <textarea rows={3} value={f.scope} onChange={e => up('scope', e.target.value)} placeholder={t.scopePh} />
                        </div>
                        <div className="field">
                            <label>{t.budget}</label>
                            <div className="rc-budget">
                                <input type="number" min="0" value={f.budget} disabled={f.no_budget} onChange={e => up('budget', e.target.value)} placeholder={f.no_budget ? 'ไม่กำหนดบัดเจท' : 'งบที่กำหนด (บาท)'} />
                                <label className="rc-check"><input type="checkbox" checked={f.no_budget} onChange={e => up('no_budget', e.target.checked)} /> ไม่กำหนดบัดเจท</label>
                            </div>
                        </div>
                        <div className="field">
                            <label>บรีฟ / ตัวอย่างงานที่ต้องการ</label>
                            <input type="url" value={f.brief_link} onChange={e => up('brief_link', e.target.value)} placeholder="ลิงก์บรีฟ/ตัวอย่างงาน (https://...)" style={{ marginBottom: 8 }} />
                            <textarea rows={2} value={f.brief_note} onChange={e => up('brief_note', e.target.value)} placeholder="รายละเอียด/ตัวอย่างงานเพิ่มเติม..." />
                        </div>
                    </>)}

                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving || !chosen}>{saving ? 'กำลังส่ง...' : 'ส่งคำขอสอบถามราคา'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
