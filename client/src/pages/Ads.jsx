import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import ColumnFilter from '../components/ColumnFilter.jsx';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import { productLabel, asTargetArray, expandProductFamilies, clipProductLabels } from '../data/products.js';
import ProductChips, { ProductSummary } from '../components/ProductChips.jsx';
import { fmtDate } from '../utils/date.js';
import { visibleBrands, seesAllBrands } from '../data/brands.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { campaignIsCtype } from '../data/adGroups.js';
import { stampAtOf, stampAtText, viewsReasonText } from '../data/stamp.js';
import { matchAdsSearch } from '../data/adsSearch.js';
import PostThumb from '../components/PostThumb.jsx';
import PerfModal from '../components/PerfModal.jsx';
import { adTiming, timingLevel, timingTip, TIMING_OPTS } from '../data/adTiming.js';


const STATUSES = ['ยังไม่ยิง', 'ยิงแล้ว'];

const fmtMoney = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');

// เกณฑ์ผ่าน/ไม่ผ่าน — ต้องตรงกับฝั่ง server (jsonStore.js)
const GOOD_CPM = 28;
const GOOD_CPE = 1.5;

// ตัวเลข CPM/CPE พร้อมสีบอกผ่าน/ไม่ผ่าน — ใช้ร่วมกันทั้งช่องที่ล็อกและช่องปัจจุบัน
// member ไม่ได้รับตัวเลขมา (เป็นข้อมูลลับ) จะเห็นเป็นป้าย Pass/Fail แทน
function PerfNums({ cpm, cpe, pass, tip, lock }) {
    if (cpm == null) {
        return (
            <span className={'perf-pill ' + (pass ? 'good' : 'bad') + (lock ? ' locked' : '')} title={tip}>
                {lock ? '🔒 ' : ''}{pass ? '✓ Pass' : '✕ Fail'}
            </span>
        );
    }
    return (
        <span className={'perf-nums ' + (pass ? 'good' : 'bad')} title={tip}>
            <span className="perf-num-row">
                {lock && <span className="perf-lock">🔒</span>}
                <b>{fmtNum(cpm)}</b><span className="perf-num-lbl">CPM</span>
            </span>
            <span className="perf-num-row">
                <b>{fmtNum(cpe)}</b><span className="perf-num-lbl">CPE</span>
            </span>
        </span>
    );
}

// ผลที่ระบบล็อกไว้ตอนค่าแอดสะสมถึงเกณฑ์ของแบรนด์นั้น — แก้ไม่ได้ ล้างไม่ได้
function StampCell({ row }) {
    const st = row.perf_stamp;
    if (!st) {
        if (row.stamp_waiting) {
            // ค่าแอดถึงเกณฑ์ + มียอดวิวแล้ว ติดอยู่อย่างเดียวคือทีมยังไม่ใส่ค่าตัว — บอกให้ตรงจุด ไม่ใช่ "รอข้อมูล"
            if (row.stamp_wait_reason === 'fee') {
                return <span className="perf-pill wait fee" title="ค่าแอดถึงเกณฑ์และมียอดวิวแล้ว แต่ทีมยังไม่ได้ใส่ค่าตัว KOL — ใส่ที่หน้าแคมเปญแล้วระบบจะล็อกผลให้ทันที">รอค่าตัว</span>;
            }
            // เหตุที่ยังไม่มียอดวิว (2 ต.ค. 2026) — บอกใต้ป้าย + ในคำอธิบาย
            const why = viewsReasonText(row.views_reason, row);
            return <span className={'perf-pill wait' + (why ? ' with-reason' : '')} title={'ค่ายิงแอดถึงเกณฑ์แล้ว แต่ยังไม่มียอดวิวเข้ามา · ระบบจะสแตมป์ให้เองทันทีที่ข้อมูลผลงานเข้ามา'
                + (why ? String.fromCharCode(10) + why.long : ' — ปกติสองอย่างนี้ควรมาพร้อมกันจากการซิงก์ ถ้าเห็นป้ายนี้ควรเช็คท่อซิงก์')}>
                Awaiting data{why && <em>{why.short}</em>}
            </span>;
        }
        return <span className="perf-pill none" title={`จะสแตมป์อัตโนมัติเมื่อค่ายิงแอดสะสมถึง ${stampAtText(stampAtOf(row))} บาท`}>Not stamped</span>;
    }
    const tip = [
        '🔒 ล็อกไว้ตั้งแต่ ' + fmtDate(String(st.at).slice(0, 10)) + ' — แก้ไม่ได้',
        st.cpm != null
            ? 'CPM ฿' + fmtNum(st.cpm) + ' (เกณฑ์ ≤ ' + GOOD_CPM + ')  ·  CPE ฿' + fmtNum(st.cpe) + ' (เกณฑ์ ≤ ' + GOOD_CPE + ')'
            : 'CPM/CPE ดูได้เฉพาะผู้ดูแลระบบและ Manager',
        'ยอดวิว ' + fmtNum(st.views) + ' · Engagement ' + fmtNum(st.engagement) + ' (ER ' + st.er + '%)',
        'ผลตัดสิน: ' + (st.verdict === 'Pass' ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์')
    ].join(String.fromCharCode(10));
    return <PerfNums cpm={st.cpm} cpe={st.cpe} pass={st.verdict === 'Pass'} tip={tip} lock />;
}

// ผลตอนนี้ + ลูกศรเทียบกับตอนสแตมป์ (ใช้ตัดสินว่าควรยิงต่อหรือหยุด)
function LiveCell({ row }) {
    // ทีมยังไม่ใส่ค่าตัว = ยังคิด CPM/CPE ไม่ได้ ห้ามตัดสินจากค่าแอดอย่างเดียว (กฎเดียวกับหน้า Report)
    if (row.fee_missing) {
        return <span className="perf-pill wait fee" title="ทีมยังไม่ได้ใส่ค่าตัว KOL คลิปนี้ — ยังคิด CPM/CPE และตัดสินผ่าน/ไม่ผ่านไม่ได้ ใส่ค่าตัวที่หน้าแคมเปญ">รอค่าตัว</span>;
    }
    if (!row.performance) {
        // มียอดวิวแล้วแต่ไม่มี CPM = KOL รายคนได้ฟรี (ค่าตัว 0 — CPM/CPE คิดจากค่าตัว) — ไม่ใช่ยังไม่มียอดวิว
        const freeNoCost = Number(row.views) > 0 && row.content_cpm == null;
        // ยังไม่มียอดวิว: บอกเหตุผลจริงใต้ป้าย (ไม่ใช่ TikTok / ไม่มี ID Post / PFM ไม่มีคลิปนี้ ...) — 2 ต.ค. 2026
        const why = freeNoCost ? null : viewsReasonText(row.views_reason, row);
        return <span className={'perf-pill none' + (why ? ' with-reason' : '')} title={freeNoCost
            ? 'ได้ฟรี (ค่าตัว 0) — CPM/CPE คิดจากค่าตัว จึงไม่มีตัวเลขให้ตัดสิน (ไม่ได้แปลว่าทำได้แย่)'
            : why ? 'ยังไม่มียอดวิวให้ตัดสิน — ' + why.long : 'ยังไม่มียอดวิวให้ตัดสิน'}>Not rated{why && <em>{why.short}</em>}</span>;
    }
    const pass = row.performance === 'Good';
    const st = row.perf_stamp;
    let move = null;
    if (st) {
        const now = pass ? 'Pass' : 'Fail';
        if (st.verdict !== now) {
            move = st.verdict === 'Fail'
                ? { ico: '↑', cls: 'up', why: 'ดีขึ้นจากตอนสแตมป์ (ตอนนั้นไม่ผ่าน)' }
                : { ico: '↓', cls: 'down', why: 'แย่ลงจากตอนสแตมป์ (ตอนนั้นผ่าน) — ยิงต่ออาจไม่คุ้ม' };
        } else if (st.cpm != null && row.content_cpm != null && st.cpm !== row.content_cpm) {
            // ผลเท่าเดิมแต่ตัวเลขขยับ — CPM ต่ำลง = ดีขึ้น
            move = row.content_cpm < st.cpm
                ? { ico: '↑', cls: 'up', why: 'CPM ถูกลงจากตอนสแตมป์ (฿' + fmtNum(st.cpm) + ' → ฿' + fmtNum(row.content_cpm) + ')' }
                : { ico: '↓', cls: 'down', why: 'CPM แพงขึ้นจากตอนสแตมป์ (฿' + fmtNum(st.cpm) + ' → ฿' + fmtNum(row.content_cpm) + ')' };
        }
    }
    const tip = [
        row.content_cpm != null
            ? 'CPM ฿' + fmtNum(row.content_cpm) + ' (เกณฑ์ ≤ ' + GOOD_CPM + ')  ·  CPE ฿' + fmtNum(row.content_cpe) + ' (เกณฑ์ ≤ ' + GOOD_CPE + ')'
            : 'CPM/CPE ดูได้เฉพาะผู้ดูแลระบบและ Manager',
        'ยอดวิว ' + fmtNum(row.views) + ' · Engagement ' + fmtNum(row.engagement),
        'ผลตอนนี้: ' + (pass ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์')
    ].join(String.fromCharCode(10));
    return (
        <span className="perf-live">
            <PerfNums cpm={row.content_cpm} cpe={row.content_cpe} pass={pass} tip={tip} />
            {move && <span className={'perf-move ' + move.cls} title={move.why}>{move.ico}</span>}
        </span>
    );
}

const fmtNum = n => {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(v);
};
// ระดับความช้าจากจำนวนวัน — ใช้ทั้งสีป้ายในตารางและตัวกรอง จะได้ไม่หลุดกัน
//   เขียว ≤ 3 วัน (รวมยิงตรงวัน) · เหลือง 4-5 วัน · แดง 6 วันขึ้นไป
// จำนวนวันระหว่าง 2 วันที่ (to - from) เป็นจำนวนวัน (คืน null ถ้าข้อมูลไม่ครบ)
function daysBetween(from, to) {
    if (!from || !to) return null;
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
}
function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function monthToRange(m) {
    if (!m) return { from: '', to: '' };
    const [y, mo] = m.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    const pad = n => String(n).padStart(2, '0');
    return { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}` };
}

// บรรทัดเล็กใต้ช่อง บอกว่าใครแก้ล่าสุดเมื่อไหร่
// ไม่มีข้อมูล = บันทึกไว้ก่อนระบบเริ่มเก็บ จึงไม่แสดงอะไร ดีกว่าเดาให้ผิด
function EnteredAt({ at, by, has }) {
    if (!has || !at) return null;
    const d = new Date(at);
    if (isNaN(d)) return null;
    const full = d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    return (
        <span className="ads-entered" title={`แก้ล่าสุด ${full}${by ? ` โดย ${by}` : ''}`}>
            {by ? `${by} · ` : ''}{fmtDate(at)}
        </span>
    );
}

// โค้ด + ปุ่มคัดลอก (Gencode / ID Post) · empty = ข้อความตอนยังไม่มีค่า
// full = แสดงครบไม่ตัดเป็น ... (ID Post — ทีมต้องอ่านเลขเทียบกับในแอปได้) · Gencode ยาว 65 ตัวยังตัดไว้ ใช้ปุ่มคัดลอกแทน
// none = กลุ่มนี้ตั้ง "-" (ไม่ใช้ Gencode) และแถวนี้ไม่มี Gencode (server ตัดสินให้ใน row.no_gencode) — บอกว่า "ไม่ใช้" ไม่ใช่ "ยังไม่กรอก"
// มีค่าอยู่ = แสดงและคัดลอกได้ตามเดิม (Gencode ที่กรอกไว้ก่อนเปลี่ยนกลุ่มเป็น "-")
function CopyCode({ value, empty = '—', none = false, full = false, label = 'โค้ด' }) {
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState(false);
    if (none && !String(value ?? '').trim()) return <span className="muted" title="กลุ่มนี้ไม่ใช้ Gencode">ไม่ใช้</span>;
    if (!value) return <span className="muted">{empty}</span>;
    const copy = async () => {
        setCopyError(false);
        try {
            await navigator.clipboard.writeText(String(value));
            setCopied(true); setTimeout(() => setCopied(false), 1400);
        } catch { setCopyError(true); }
    };
    return (
        <span className="kol-track-code-wrap">
            <span className={'kol-track-code' + (full ? ' full' : '')} title={value}>{value}</span>
            <button type="button" aria-label={`คัดลอก ${label}`} className={'ads-copy' + (copied ? ' done' : '')} onClick={copy} title={copied ? 'คัดลอกแล้ว' : 'คัดลอก'}>
                {copied ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
            </button>
            {copyError && <span role="alert" className="kol-track-copy-error">คัดลอกไม่ได้ เลือกข้อความเพื่อคัดลอกเอง</span>}
        </span>
    );
}

// ปุ่มกรองเล็ก ๆ บนหัวคอลัมน์ (แบบเดียวกับตารางใน Excel)
// เมนูใช้ position:fixed เพราะหัวตารางอยู่ในกรอบที่เลื่อนแนวนอน ถ้าใช้ absolute จะโดนตัด

// TikTok ยิงแอดผ่านระบบ PFM (ผู้ใช้สั่ง 2 ต.ค. 2026) — สถานะยิงแล้วขึ้นเองจาก PFM (มี ad เกาะคลิป / มีค่าแอด) ห้ามกดเอง
// 6 ต.ค. 2026: เฉพาะแบรนด์ที่ต่อ PFM แล้ว (ตอนนี้ Beauterry) — server ตัดสินให้ต่อแถว (status_auto · logic.js adStatusAuto)
// TikTok ของแบรนด์อื่น (เช่น Jula's Herb) กดยิงแล้วเองได้แบบ Facebook / Instagram
// server รุ่นก่อน (ยังไม่รีสตาร์ต) ไม่ส่ง status_auto → ถือว่า TikTok ทุกแถวเป็นของ PFM แบบเดิม (server รุ่นนั้นก็ปฏิเสธการกดอยู่แล้ว)
const adStatusAuto = row => (typeof row.status_auto === 'boolean' ? row.status_auto : /^\s*tiktok/i.test(String(row.platform || '')));

// แท็บ "ต้องยิงแอด" / "ไม่ต้องยิงแอด / ไม่ใช้ Gencode" (ผู้ใช้สั่ง 5 ต.ค. 2026) — จำแท็บล่าสุดในเครื่องนี้ (อ่าน/เขียนไม่ได้ = แท็บต้องยิง)
const ADS_TAB_KEY = 'ads:tab';
const readAdsTab = () => { try { return localStorage.getItem(ADS_TAB_KEY) === 'noads' ? 'noads' : 'ads'; } catch { return 'ads'; } };
// คลิปไม่ต้องยิงแอด = กลุ่มที่ตั้งว่าไม่ใช้ Gencode และคลิปยังไม่มี Gencode (server คิดให้ใน no_gencode — logic.js postNoGencode)
const isNoAdRow = r => r.no_gencode === true;

// แถวตาราง: อัปเดตข้อมูลแอดของโพสต์ 1 อัน (บันทึกเมื่อออกจากช่อง)
// noAd = คลิปในแท็บไม่ต้องยิงแอด — ช่องสถานะขึ้น "ไม่ต้องยิง" (ถ้ายิงไปแล้วจริงยังขึ้นยิงแล้วตามจริง)
function AdRow({ row, onSaved, canCost, noAd = false }) {
    const [adStatus, setAdStatus] = useState(row.ad_status || 'ยังไม่ยิง');
    const [end, setEnd] = useState(row.ad_end || '');
    const [note, setNote] = useState(row.ad_note || '');
    const [perfOpen, setPerfOpen] = useState(false);
    // ค่าแอดสะสม: โพสต์ TikTok ที่มี ID Post ระบบ PFM ซิงก์ให้เอง (แก้ไม่ได้) · โพสต์อื่นกรอกเองได้ (เฉพาะคนที่เห็นต้นทุน)
    // Reach: Beauterry / WeBoostX ส่งยอดสะสมจากรายงานที่ไม่ซ้ำ กรอกเองได้เมื่อยังไม่มีข้อมูล
    // ช่องจะตามค่าล่าสุดจากรายการเสมอ ยกเว้นตอนผู้ใช้กำลังพิมพ์ (dirty) — แค่กด Tab ผ่านต้องไม่เอาค่าเก่าไปทับ
    const spendText = v => (v == null || Number(v) === 0 ? '' : String(Math.round(Number(v) * 100) / 100));
    const reachText = v => (v == null || Number(v) === 0 ? '' : String(Math.round(Number(v))));
    const [spend, setSpend] = useState(spendText(row.ad_spend));
    const [reach, setReach] = useState(reachText(row.ad_reach));
    const [spendDirty, setSpendDirty] = useState(false);
    const [reachDirty, setReachDirty] = useState(false);
    const [spendFrom, setSpendFrom] = useState(row.ad_spend);
    const [reachFrom, setReachFrom] = useState(row.ad_reach);
    useEffect(() => { if (!spendDirty) { setSpend(spendText(row.ad_spend)); setSpendFrom(row.ad_spend); } }, [row.ad_spend]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!reachDirty) { setReach(reachText(row.ad_reach)); setReachFrom(row.ad_reach); } }, [row.ad_reach]);   // eslint-disable-line react-hooks/exhaustive-deps
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // ยิง PUT (route อัปเดตเฉพาะ field ที่ส่งมา จึงแยกบันทึกสถานะ/ตัวเลขได้โดยไม่ทับกัน)
    async function put(body) {
        setSaving(true); setSaved(false);
        try {
            await api(`/ads/${row.sub_id}`, { method: 'PUT', body });
            setSaved(true); onSaved();
            setTimeout(() => setSaved(false), 1600);
        } catch (err) { alert(err.message); }
        finally { setSaving(false); }
    }

    // บันทึกหมายเหตุ (เช่น Gencode ใช้ไม่ได้ / ยิงแอดไม่ได้) — เฉพาะเมื่อมีการเปลี่ยน
    const saveNote = () => { if (note !== (row.ad_note || '')) put({ ad_note: note || null }); };
    // เงินมีทศนิยมได้ (เก็บถึงสตางค์) — เทียบกันที่หน่วยสตางค์ ไม่ตัดจุดทิ้ง (ไม่งั้น 150.25 กลายเป็น 15,025)
    const money = v => Math.round((Number(String(v || '').replace(/[^0-9.]/g, '')) || 0) * 100) / 100;
    const sameMoney = (a, b) => Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
    function saveSpend() {
        if (!spendDirty) return;
        const v = money(spend);
        if (sameMoney(v, spendFrom)) { setSpendDirty(false); return; }
        // ถึงเกณฑ์ของแบรนด์เมื่อไหร่ ระบบสแตมป์ผล PFM ถาวร (ถ้ามียอดวิวและค่าตัวแล้ว / หรือทันทีที่ครบภายหลัง)
        // พิมพ์ผิดแก้คืนไม่ได้ จึงถามก่อนทุกครั้ง · เกณฑ์ต้องอ่านจากแถว ไม่ใช่เลขตายตัว ไม่งั้นแบรนด์ที่เกณฑ์ต่ำจะโดนล็อกเงียบ ๆ
        const at = stampAtOf(row);
        if (v >= at && !row.perf_stamp && !window.confirm(
            `ค่าแอดสะสม ฿${v.toLocaleString('th-TH')} ถึงเกณฑ์ ${stampAtText(at)} — ${row.stamp_waiting
                ? 'คลิปนี้รอค่าตัว/ยอดวิวอยู่ พอข้อมูลครบระบบจะล็อกผล PFM ด้วยยอดนี้ทันทีและแก้ไม่ได้'
                : 'ถ้าคลิปนี้มียอดวิวและค่าตัวครบ ระบบจะล็อกผล PFM ด้วยยอดนี้ไว้ถาวร แก้ไม่ได้'} ยืนยันยอดนี้ไหม?`)) {
            setSpend(spendText(spendFrom)); setSpendDirty(false);
            return;
        }
        setSpendDirty(false);
        put({ ad_spend: v, ad_spend_from: Number(spendFrom) || 0 });
    }
    function saveReach() {
        if (!reachDirty) return;
        const v = Math.round(Number(String(reach || '').replace(/[^0-9]/g, '')) || 0);
        setReachDirty(false);
        if (v === Math.round(Number(reachFrom) || 0)) return;
        put({ ad_reach: v, ad_reach_from: Math.round(Number(reachFrom) || 0) });
    }

    // สลับสถานะ — เมื่อกด "ยิงแล้ว" ให้ลงวันยิงแอด (ad_end) เป็นวันนี้อัตโนมัติ, ยกเลิกให้ล้างวันที่
    // ถ้ามีวันยิงแอดอยู่แล้ว (PFM ลงวันแรกที่มีค่าแอดให้) ใช้วันนั้นต่อ ไม่ทับด้วยวันที่กดยืนยัน
    function toggleStatus() {
        const next = adStatus === 'ยิงแล้ว' ? 'ยังไม่ยิง' : 'ยิงแล้ว';
        setAdStatus(next);
        if (next === 'ยิงแล้ว') {
            const d = new Date(); // วันที่ปัจจุบันตามเครื่องผู้ใช้ (local)
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const date = end || today;
            setEnd(date);
            put({ ad_status: next, ad_end: date });
        } else {
            setEnd('');
            put({ ad_status: next, ad_end: null });
        }
    }

    // ค่าแอดเดินแล้ว = แอดวิ่งไปแล้วแน่นอน แม้ยังไม่มีใครกดยืนยัน — โชว์ว่ายิงแล้วไปก่อน
    // (ไม่เขียนลงฐาน ปุ่มยังกดยืนยันได้ตามปกติ และไม่กระทบฟีดที่ beauterry ดึงไป)
    const ranBySpend = (Number(row.ad_spend) || 0) > 0;
    const shownStatus = (adStatus === 'ยิงแล้ว' || ranBySpend) ? 'ยิงแล้ว' : 'ยังไม่ยิง';
    const doneFromSpend = ranBySpend && adStatus !== 'ยิงแล้ว';
    const autoStatus = adStatusAuto(row);
    const noAdLabel = noAd && shownStatus !== 'ยิงแล้ว';

    // ระยะเวลายิง — นับจากวันพร้อมยิง (ข้อมูลครบชิ้นสุดท้าย: ลงคลิป / Gencode / ID Post / ทีมอนุมัติ) → วันยิงแอด (ดู data/adTiming.js)
    // แถวที่รู้จากค่าแอดก็นับได้ถ้า PFM ลงวันยิงแอดมาให้แล้ว
    const timing = shownStatus === 'ยิงแล้ว' && end ? adTiming(row, end) : null;
    // แจ้งเข้าระบบช้าไปกี่วันหลัง KOL ลงงานจริง — แยกให้เห็นว่ายิงแอดช้าเพราะเราช้าหรือเพราะเพิ่งได้รับแจ้ง
    const reportLag = (row.post_date && row.post_date_at)
        ? daysBetween(row.post_date, String(row.post_date_at).slice(0, 10))
        : null;

    // รหัสที่ KOL คนนี้รีวิวจริง (เดิมอยู่ช่อง PRODUCTS) — ช่อง PRODUCTS เปลี่ยนเป็นทุกสีที่ระบบยิงแอดยิงครอบ
    // รหัสในคลังโชว์แค่รหัส · ชื่อที่พิมพ์เอง (แบรนด์ที่ไม่มีคลังสินค้า) โชว์ทั้งข้อความ ไม่ตัดเหลือคำแรก
    const clipCodes = clipProductLabels(row.product);

    return (
        <div className="kol-track-entry">
            {/* IMAGE — รูปปกคลิป (TikTok ดึงอัตโนมัติ) กดเปิดโพสต์ */}
            <div className="ads-cell ads-thumb-cell"><PostThumb row={row} /></div>
            <div className="ads-name">
                <div className="ads-name-meta">
                    <span className="ads-acc">{row.account_name}</span>
                    <span className="ads-plat">{row.platform || '—'}</span>
                    {clipCodes.length > 0 && (
                        <div className="ads-clip-prods" title="รหัสสินค้าที่ KOL รีวิวในคลิปนี้">
                            <ProductChips products={clipCodes} collapseAt={2} />
                        </div>
                    )}
                </div>
            </div>
            <div className="ads-cell ads-camp">
                <span className="ads-camp-name">{row.project_name || '—'}</span>
                {row.brand && <span className="tag">{row.brand}</span>}
            </div>
            <div className="ads-cell ads-stack">
                {/* ทุกสีของสินค้าที่คลิปรีวิว (ระบบยิงแอดดึงค่าเดียวกันนี้ไปจากฟีด) — โชว์ 3 รหัสแรก ที่เหลือกด +N · ชี้ดูชื่อสีครบ */}
                <ProductSummary value={expandProductFamilies(row.product)} max={3} />
            </div>
            {/* CAMPAIGN (อยู่หน้า TARGET) — ตั้งไว้ที่ชุด Content Type ของกลุ่ม · แคมเปญที่บันทึกก่อนมีช่องนี้จะเป็น — */}
            <div className="ads-cell ads-stack">
                {row.campaign ? <span className="proc-ctype-chip camp">{row.campaign}</span> : <Link className="kol-track-gap" to={`/projects/${row.project_id}?tab=process`} title="ยังไม่มีค่า Campaign ในกลุ่ม เปิดแคมเปญเพื่อตรวจการตั้งค่า">ยังไม่ระบุ</Link>}
            </div>
            {/* Target ตั้งต่อ Platform และมีเฉพาะ Platform ที่ใช้ยิงแอด — ช่องว่างโชว์ — เหมือนหน้า On Process */}
            <div className="ads-cell ads-stack">
                {asTargetArray(row.target).length > 0
                    ? asTargetArray(row.target).map(t => <span className="proc-ads-tgt" key={t} title={t}>🎯 {t}</span>)
                    : <Link className="kol-track-gap" to={`/projects/${row.project_id}?tab=process`} title="ยังไม่มี Target ของแพลตฟอร์มนี้ เปิดแคมเปญเพื่อตรวจการตั้งค่า">ยังไม่ระบุ</Link>}
            </div>
            {/* CONTENT TYPE / FORMAT (Photo-VDO) — แยกคอลัมน์ละเรื่อง ไม่กองรวมในช่องเดียว
                (STYLE ไม่แสดงในหน้านี้ — ทีมแอดไม่ได้ใช้ ดูได้ในหน้าแคมเปญ / ฝั่งเอเจนซี่) */}
            <div className="ads-cell ads-stack">
                {/* Facebook / Instagram: ค่านี้คือ Campaign (ขึ้นคอลัมน์ CAMPAIGN แล้ว) ไม่ต้องโชว์ซ้ำ
                    ข้อมูลเดิมที่ไม่ใช่ Campaign (เช่น Instagram 'Review') ยังโชว์ที่ช่องนี้เหมือนเดิม */}
                {row.content_type && !(campaignIsCtype(row.platform) && row.campaign === row.content_type)
                    ? <span className="proc-ctype-chip">{row.content_type}</span> : <span className="muted">—</span>}
            </div>
            <div className="ads-cell ads-stack">
                {row.media_type ? <span className="proc-ctype-chip media">{row.media_type}</span> : <span className="muted">—</span>}
            </div>
            {/* คอลัมน์ POST (ไอคอนตาเปิดโพสต์) เอาออกแล้ว 1 ต.ค. 2026 — กดรูปปกในคอลัมน์ IMAGE เปิดโพสต์แทน */}
            {/* GENCODE — โค้ดยาว 65 ตัว แสดงไม่ครบแน่นอน จึงตัดด้วย ... แล้วให้กดปุ่มคัดลอกเอาไปใช้แทน */}
            <div className="ads-cell"><CopyCode value={row.gencode} none={row.no_gencode === true} label="Gencode" /></div>
            {/* ID POST — ตัวเลขยาว ~19 หลัก มักโดนตัด ... จึงมีปุ่มคัดลอกแบบเดียวกับ Gencode */}
            <div className="ads-cell"><CopyCode value={row.id_post} empty="ยังไม่มี" full label="ID Post" /></div>
            {/* วันลงงาน — ป้าย "แจ้งช้า" อยู่ช่องนี้เพราะเป็นเรื่องของวันลงงานโดยตรง (ลงจริงวันหนึ่ง แต่เพิ่งแจ้งอีกวันหนึ่ง) */}
            <div className="ads-cell ads-stack">
                {row.post_date ? <span className="ads-postdate">{fmtDate(row.post_date)}</span> : <span className="muted">—</span>}
                {reportLag !== null && reportLag >= 2 && (
                    <span className={'ads-lag ' + (reportLag <= 3 ? 'warn' : 'bad')}
                        title={`KOL ลงงาน ${fmtDate(row.post_date)} แต่เพิ่งแจ้งเข้าระบบ ${fmtDate(row.post_date_at)} — ช้าไป ${reportLag} วัน ทำให้เริ่มยิงแอดได้ช้าตามไปด้วย`}>
                        แจ้งช้า {reportLag} วัน
                    </span>
                )}
            </div>
            {/* วันยิงแอด — PFM ลงวันแรกที่มีค่าแอดให้เอง หรือระบบลงวันที่ตอนกดสถานะเป็น "ยิงแล้ว" */}
            <div className="ads-cell">
                {end
                    ? <span className="ads-postdate" title="วันที่ยิงแอด (วันแรกที่มีค่าแอดจาก PFM หรือวันที่กดสถานะเป็นยิงแล้ว)">{fmtDate(end)}</span>
                    : noAdLabel ? <span className="muted" title="คลิปนี้ไม่ต้องยิงแอด (กลุ่มที่ตั้งว่าไม่ใช้ Gencode)">—</span>
                    : doneFromSpend
                        /* ค่าแอดบอกว่ายิงแล้ว แต่ไม่รู้วันไหน — เขียน "ยังไม่ยิง" ตรงนี้จะขัดกับสถานะข้าง ๆ */
                        ? <span className="muted" title={autoStatus
                            ? 'ยิงไปแล้ว (รู้จากค่าแอด) — PFM ยังไม่ส่งวันยิงแอดมา'
                            : 'ยิงไปแล้ว (รู้จากค่าแอด) แต่ยังไม่มีวันยิงแอด — กดปุ่มสถานะเพื่อลงวันที่'}>—</span>
                        : <span className="muted">ยังไม่ยิง</span>}
            </div>
            <div className="ads-cell">
                {noAdLabel ? (
                    /* แท็บไม่ต้องยิงแอด: ป้ายอ่านอย่างเดียว — คลิปในกลุ่มที่ตั้งว่าไม่ใช้ Gencode ไม่ต้องยิง (และไม่ส่งให้ PFM) */
                    <span className="ads-status auto pending noad" title="คลิปในกลุ่มที่ตั้งว่าไม่ใช้ Gencode — ไม่ต้องยิงแอด และไม่ได้ส่งให้ PFM · ถ้าต้องยิง ให้ใส่ Gencode หรือเปลี่ยนตั้งค่ากลุ่มในหน้าแคมเปญ">
                        ไม่ต้องยิง<em>ไม่ใช้ Gencode</em>
                    </span>
                ) : autoStatus ? (
                    /* TikTok: ป้ายอ่านอย่างเดียว — สถานะมาจาก PFM (ไม่ใช่ปุ่ม กดไม่ได้) */
                    <span className={'ads-status auto ' + (shownStatus === 'ยิงแล้ว' ? 'done' : 'pending') + (doneFromSpend ? ' from-spend' : '')}
                        title={shownStatus === 'ยิงแล้ว'
                            ? 'TikTok ยิงแอดผ่านระบบ PFM — ระบบขึ้นยิงแล้วให้เอง (มี ad เกาะคลิป หรือมีค่าแอดแล้ว) · กดเองไม่ได้'
                            : 'TikTok ยิงแอดผ่านระบบ PFM — พอ PFM มี ad เกาะคลิปนี้ สถานะจะเปลี่ยนเป็นยิงแล้วเอง · กดเองไม่ได้'}>
                        {shownStatus === 'ยิงแล้ว' ? '✓ ยิงแล้ว' : 'ยังไม่ยิง'}
                        <em>{doneFromSpend ? 'จากค่าแอด' : 'อัตโนมัติ (PFM)'}</em>
                    </span>
                ) : (
                <button type="button"
                    className={'ads-status ' + (shownStatus === 'ยิงแล้ว' ? 'done' : 'pending') + (doneFromSpend ? ' from-spend' : '')}
                    onClick={toggleStatus} disabled={saving}
                    title={doneFromSpend
                        ? (end
                            ? 'รู้ว่ายิงแล้วจากค่าแอด (ค่าแอดเดินแล้ว) แต่ยังไม่มีใครกดยืนยัน — กดเพื่อยืนยัน (ใช้วันยิงแอดเดิม)'
                            : 'รู้ว่ายิงแล้วจากค่าแอด (ค่าแอดเดินแล้ว) แต่ยังไม่มีใครกดยืนยัน — กดเพื่อยืนยันและลงวันยิงแอดเป็นวันนี้')
                        : (shownStatus === 'ยิงแล้ว' ? 'กดเพื่อกลับเป็นยังไม่ยิง' : 'กดเมื่อยิงแอดคลิปนี้แล้ว')}>
                    {shownStatus === 'ยิงแล้ว' ? '✓ ยิงแล้ว' : 'ยังไม่ยิง'}
                    {doneFromSpend && <em>จากค่าแอด</em>}
                </button>
                )}
                {/* ย้ายตัวบอกสถานะการบันทึกมาจากช่อง CPM ที่เอาออกไป */}
                {saving ? <span className="proc-status">…</span> : saved ? <span className="proc-status ok">✓</span> : null}
            </div>
            {/* ค่าแอดสะสม + Reach — บันทึกเมื่อออกจากช่อง (ใช้คิด CPM ในหน้านี้และหน้าภาพรวม) */}
            <div className="ads-cell ads-spend">
                {row.spend_from_pfm ? (
                    <span className="ads-spend-pfm" title="ค่าแอดของโพสต์นี้ซิงก์จากระบบ PFM อัตโนมัติ — แก้เองไม่ได้">
                        {canCost ? fmtMoney(row.ad_spend) : '฿ •••'} <em>PFM</em>
                    </span>
                ) : canCost ? (
                    <input inputMode="decimal" value={spend} placeholder="ค่าแอด ฿" title="ค่าแอดสะสม (บาท) — โพสต์นี้ PFM ไม่ได้ซิงก์ให้ กรอกเองได้"
                        onChange={e => { setSpend(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setSpendDirty(true); }}
                        onBlur={saveSpend} />
                ) : (
                    <span className="muted" title="ค่าแอดดูและแก้ได้เฉพาะผู้ดูแลระบบและ Manager">—</span>
                )}
                <input inputMode="numeric" value={reach} placeholder="Reach" title="Reach สะสม — ซิงก์จาก PFM เมื่อมีข้อมูล หรือกรอกเองได้"
                    onChange={e => { setReach(e.target.value.replace(/[^0-9]/g, '')); setReachDirty(true); }} onBlur={saveReach} />
            </div>
            <div className="ads-cell ads-late">
                {timing === null
                    ? <span className="muted">—</span>
                    : timing.conflict
                        ? <span className="late-chip invalid" title={timingTip(timing)}>วันที่ขัดกัน</span>
                    : timing.late <= 0
                        ? <span className="late-chip ontime" title={timingTip(timing)}>ตรงเวลา</span>
                        : <span className={'late-chip ' + timingLevel(timing.late)} title={timingTip(timing)}>ช้า {timing.late} วัน</span>}
            </div>
            <div className="ads-cell"><StampCell row={row} /></div>
            <div className="ads-cell ads-stack">
                <LiveCell row={row} />
                {row.organic_metrics_status === 'snapshot_only' && <small className="muted" title="ต้นทางเก็บยอดเดิมไว้ แต่บริการอัปเดตผลงาน KOL ยังปิดอยู่">ยอดเดิมจากต้นทาง</small>}
                <button type="button" className="kol-track-perf-edit" onClick={() => setPerfOpen(true)}>กรอกผลงาน</button>
            </div>
            <div className="ads-cell kol-track-note">
                <input value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote}
                    placeholder="เช่น Gencode ใช้ไม่ได้ / ยิงไม่ได้" title={note || 'หมายเหตุจากทีมยิงแอด'} />
            </div>
            {perfOpen && <PerfModal sub={{ ...row, id: row.sub_id }} onClose={() => setPerfOpen(false)}
                notice={row.perf_stamp
                    ? 'บันทึกนี้ปรับผลงานปัจจุบัน โดยคง Stamp เดิมไว้'
                    : 'เมื่อค่าแอดถึงเกณฑ์และผลงานครบ ระบบจะ Stamp จากยอดตอนบันทึกนี้ ไม่ใช่ยอดย้อนหลัง ณ วันที่ค่าแอดถึงเกณฑ์'}
                onSave={async payload => {
                    await api(`/projects/${row.project_id}/submissions/${row.sub_id}`, { method: 'PUT', body: payload });
                    onSaved();
                }} />}
        </div>
    );
}

export default function Ads() {
    const { user } = useAuth();
    const BRANDS = visibleBrands(user);   // เห็นเฉพาะแบรนด์ที่ตัวเองดูแล
    const [month, setMonth] = useState(currentMonth());
    const [allTime, setAllTime] = useState(true);
    const [brand, setBrand] = useState('');
    const [status, setStatus] = useState('');
    const [platform, setPlatform] = useState('');
    const [late, setLate] = useState('');   // '' | ontime | warn | bad
    const [missingPerf, setMissingPerf] = useState(false);
    // ค้นหาชื่อ KOL / แคมเปญ / สินค้า / Gencode / ID Post — กรองฝั่งหน้าเว็บเหมือนตัวกรองอื่น (ดู data/adsSearch.js)
    const [search, setSearch] = useState('');
    // แท็บ ต้องยิงแอด / ไม่ต้องยิงแอด (5 ต.ค. 2026)
    const [tab, setTabState] = useState(readAdsTab);
    // เปลี่ยนแท็บ = ล้างตัวกรอง Platform / สถานะ / ระยะเวลายิง (คำค้นหาคงไว้) — ตัวกรองของอีกแท็บที่ปุ่มหายไปจะไม่ค้างจนตารางว่าง
    const setTab = t => {
        if (t !== tab) { setPlatform(''); setStatus(''); setLate(''); }
        setTabState(t);
        try { localStorage.setItem(ADS_TAB_KEY, t); } catch { /* จำไม่ได้ก็ไม่เป็นไร */ }
    };
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    // หัวตารางอยู่คนละกรอบกับแถว (เพื่อให้ล็อกไว้บนจอได้) — เลื่อนซ้ายขวากรอบไหน อีกกรอบตามไปตำแหน่งเดียวกัน
    const headRef = useRef(null);
    const bodyRef = useRef(null);
    const syncX = (from, to) => {
        if (from.current && to.current && to.current.scrollLeft !== from.current.scrollLeft) to.current.scrollLeft = from.current.scrollLeft;
    };
    const load = useCallback(() => {
        const q = new URLSearchParams();
        if (!allTime && month) {
            const { from, to } = monthToRange(month);
            q.set('from', from); q.set('to', to);
        }
        if (brand) q.set('brand', brand);
        // สถานะ/แพลตฟอร์ม/ความช้า กรองฝั่งหน้าเว็บทั้งหมด จะได้นับจำนวนบนปุ่มให้ตรงกันได้
        api(`/ads?${q.toString()}`)
            .then(res => setData(res.data))
            .catch(err => setError(err.message));
    }, [month, allTime, brand]);

    useEffect(() => { load(); }, [load]);

    const s = data?.summary;
    const allRows = data?.rows || [];
    // แยกแท็บ: คลิปในกลุ่มที่ไม่ใช้ Gencode ไปแท็บ "ไม่ต้องยิงแอด" · ตัวกรอง/ค้นหา/ตัวเลขบนปุ่ม คิดจากแท็บที่เปิดอยู่
    // การ์ดสรุปคิดจากคลิปที่ต้องยิงเสมอ (server นับให้แบบเดียวกัน)
    const adRowsAll = allRows.filter(r => !isNoAdRow(r));
    const noAdRows = allRows.filter(isNoAdRow);
    const tabRows = tab === 'noads' ? noAdRows : adRowsAll;
    // ค้นหาไม่เจอในแท็บนี้ แต่เจอในอีกแท็บ — บอกให้รู้ (ไม่งั้นนึกว่าคลิปหาย)
    const otherTabHits = search.trim() ? (tab === 'noads' ? adRowsAll : noAdRows).filter(r => matchAdsSearch(r, search)).length : 0;

    // จัดกลุ่มความช้า — นับเฉพาะโพสต์ที่ยิงแล้วและมีวันครบทั้งสองฝั่ง
    // เขียว = ช้าไม่เกิน 3 วัน (รวมยิงตรงวัน) · เหลือง = 4-5 วัน · แดง = 6 วันขึ้นไป
    // ตัวกรองคอลัมน์ระยะเวลายิง — กติกาเดียวกับป้ายในแถว (data/adTiming.js)
    const lateBucket = r => {
        if ((r.ad_status_shown || r.ad_status) !== 'ยิงแล้ว' || !r.ad_end) return null;
        const t = adTiming(r, r.ad_end);
        return t ? timingLevel(t.late) : null;
    };
    // skip = ข้ามตัวกรองตัวนั้น ใช้ตอนนับเลขบนปุ่ม (เลขบอกว่า "ถ้ากดปุ่มนี้จะเหลือกี่รายการ")
    // ใช้สถานะที่โชว์ (ad_status_shown) เพื่อให้เลขบนปุ่มตรงกับที่ตาเห็นในตาราง
    // แถวเก่าก่อนมีฟิลด์นี้ค่อยถอยไปใช้ ad_status
    const shownStatusOf = r => r.ad_status_shown || r.ad_status;
    // คำค้นหาไม่มี skip — เลขบนปุ่มกรองนับเฉพาะแถวที่ตรงกับคำค้นหาด้วย จะได้ตรงกับที่เหลือในตารางจริง
    const matches = (r, skip) =>
        (skip === 'platform' || !platform || r.platform === platform) &&
        (skip === 'status' || !status || shownStatusOf(r) === status) &&
        (skip === 'late' || !late || lateBucket(r) === late) &&
        (!missingPerf || !r.performance) &&
        matchAdsSearch(r, search);

    // ลำดับแถวตามที่ server ส่งมา (วันลงงานใหม่สุดก่อน แล้วตาม id) — ไม่เรียงตามสถานะแล้ว
    // กดเปลี่ยนเป็น "ยิงแล้ว" แถวต้องอยู่ที่เดิม เปลี่ยนแค่ป้ายสถานะ (เดิมเด้งลงไปท้ายตาราง ทีมหาแถวที่เพิ่งกดไม่เจอ)
    // อยากดูเฉพาะที่ยังไม่ยิง ใช้ปุ่มกรอง ▾ ที่หัวคอลัมน์สถานะแทน
    const rows = tabRows.filter(r => matches(r));
    const reachRows = adRowsAll.filter(r => Number(r.ad_reach) > 0);
    const paidRows = adRowsAll.filter(r => Number(r.ad_spend) > 0);
    const measuredRows = paidRows.filter(r => Number(r.ad_reach) > 0);
    const measuredReach = measuredRows.reduce((sum, r) => sum + Number(r.ad_reach), 0);
    const measuredSpend = measuredRows.reduce((sum, r) => sum + Number(r.ad_spend), 0);
    const costPerThousandReach = measuredReach > 0 ? Math.round(measuredSpend / (measuredReach / 1000)) : null;
    const canSeeSpend = s?.total_spend != null;

    const countIf = (skip, pred) => tabRows.filter(r => matches(r, skip) && pred(r)).length;
    const platformOptions = [...new Set(tabRows.map(r => r.platform).filter(Boolean))].sort();
    // ดรอปดาวน์ Platform: Platform ที่เลือกค้างไว้แต่แท็บนี้ไม่มีคลิป ยังต้องอยู่ในรายการ (ไม่งั้นช่องโชว์ "ทุก Platform" ทั้งที่ยังกรองอยู่)
    const platformPick = platform && !platformOptions.includes(platform) ? [...platformOptions, platform] : platformOptions;
    const hasFilter = !!(platform || status || late || search.trim() || missingPerf);
    const clearFilters = () => { setPlatform(''); setStatus(''); setLate(''); setSearch(''); setMissingPerf(false); };
    const ratedCount = tabRows.filter(r => r.performance).length;
    const dateConflicts = tabRows.filter(r => lateBucket(r) === 'invalid').length;
    // ค่า insight เพิ่มเติม (คำนวณจากข้อมูลที่มี)
    const topBrand = s && s.by_brand && s.by_brand.length ? s.by_brand[0] : null;
    const donePct = s && s.total_posts ? Math.round((s.done_count / s.total_posts) * 100) : 0;
    const maxBrandSpend = s && s.by_brand ? Math.max(1, ...s.by_brand.map(b => b.spend)) : 1;

    return (
        <div className="ads-page">
            <header className="page-head">
                <div>
                    <h1>ADS</h1>
                    <p className="page-sub">ติดตามสถานะการยิงแอดของแต่ละโพสต์ และสรุปค่าแอด</p>
                </div>
            </header>

            <div className="kol-track-health" role="status">
                <span>PFM คำนวณได้ {ratedCount}/{tabRows.length} โพสต์</span>
                <button type="button" aria-pressed={missingPerf} onClick={() => setMissingPerf(v => !v)}>
                    {missingPerf ? 'แสดงผลงานทั้งหมด' : `ดูโพสต์ที่ยังคำนวณไม่ได้ (${tabRows.length - ratedCount})`}
                </button>
                {dateConflicts > 0 && <button type="button" onClick={() => setLate('invalid')}>วันที่ขัดกัน {dateConflicts} โพสต์</button>}
                <small>ค่าแอด / Reach กับ Views / Engagement เป็นคนละข้อมูล · ยอดผลงานที่ขาดกรอกได้ในตาราง</small>
            </div>
            {/* ตัวกรอง */}
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                <label className="bud-month">
                    เดือน:
                    <input type="month" value={month} disabled={allTime} onChange={e => setMonth(e.target.value)} />
                </label>
                <button className={'brand-chip' + (allTime ? ' active' : '')} onClick={() => setAllTime(a => !a)}>
                    {allTime ? '✓ ทุกเดือน' : 'ดูทุกเดือน'}
                </button>
            </div>

            {/* แบรนด์ + Platform เป็นดรอปดาวน์ (ผู้ใช้สั่ง 7 ต.ค. 2026 — เดิมเป็นปุ่มเรียงยาว) · หน้าตาเดียวกับตัวกรองหน้า Campaign Reports
                Platform ใช้ state ตัวเดียวกับตัวกรองในหัวคอลัมน์ KOL · เลขในวงเล็บนับตามแท็บที่เปิดอยู่ */}
            <div className="brand-filter report-filters ads-dd-filters">
                <span className="brand-filter-label">▼ แบรนด์:</span>
                <select className="campaign-select" aria-label="กรองตามแบรนด์" value={brand} onChange={e => setBrand(e.target.value)}>
                    <option value="">ทุกแบรนด์</option>
                    {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {(platformPick.length > 1 || platform) && (
                    <>
                        <span className="brand-filter-label">▼ Platform:</span>
                        <select className="campaign-select" aria-label="กรองตาม Platform" value={platform} onChange={e => setPlatform(e.target.value)}>
                            <option value="">ทุก Platform ({countIf('platform', () => true)})</option>
                            {platformPick.map(pf => <option key={pf} value={pf}>{pf} ({countIf('platform', r => r.platform === pf)})</option>)}
                        </select>
                    </>
                )}
            </div>

            {/* แท็บ ต้องยิงแอด / ไม่ต้องยิงแอด (5 ต.ค. 2026) — หน้าตาเดียวกับแท็บหน้าแคมเปญ · เลขในดรอปดาวน์ Platform ด้านบนนับตามแท็บที่เปิดอยู่ */}
            <div className="agency-tabs hub-tabs proj-type-tabs ads-tabs" role="tablist" aria-label="แยกคลิปที่ต้องยิงแอด">
                <button type="button" role="tab" aria-selected={tab === 'ads'} className={tab === 'ads' ? 'active' : ''} onClick={() => setTab('ads')}>
                    ต้องยิงแอด <span className="agency-tab-count">{data ? adRowsAll.length : '…'}</span>
                </button>
                <button type="button" role="tab" aria-selected={tab === 'noads'} className={tab === 'noads' ? 'active' : ''} onClick={() => setTab('noads')}
                    title="คลิปในกลุ่มที่ตั้งว่าไม่ใช้ Gencode — ไม่ต้องยิงแอด">
                    <span className="ads-tab-long">ไม่ต้องยิงแอด / ไม่ใช้ Gencode</span><span className="ads-tab-short">ไม่ต้องยิงแอด</span>
                    {' '}<span className="agency-tab-count">{data ? noAdRows.length : '…'}</span>
                </button>
            </div>

            {error && <div className="alert-error">{error}</div>}

            {/* โพสต์ที่เอเจนซี่ส่งมาแต่ทีมยังไม่ตรวจ — ยังไม่ขึ้นตารางนี้ บอกว่ารออยู่ที่แคมเปญไหน */}
            {s && s.check_waiting > 0 && (
                <div className="ads-check-banner">
                    🕵 ยังไม่ขึ้นหน้านี้:
                    {s.check_pending > 0 && <span>รอทีมตรวจ <b>{s.check_pending}</b> โพสต์</span>}
                    {s.check_returned > 0 && <span>ส่งกลับให้เอเจนซี่แก้ <b>{s.check_returned}</b> โพสต์</span>}
                    —
                    {(s.check_waiting_projects || []).map(p => (
                        <Link key={p.project_id} to={`/projects/${p.project_id}?tab=process&check=1`} className="ads-check-link"
                            title={`รอทีมตรวจ ${p.pending || 0} · ส่งกลับให้แก้ ${p.returned || 0}`}>
                            {p.project_name || 'แคมเปญ'} ({p.count})
                        </Link>
                    ))}
                </div>
            )}

            {tab === 'noads' && (
                <div className="ads-noad-note">
                    คลิปในกลุ่มที่ตั้งว่า <b>ไม่ใช้ Gencode</b> (ขีด -) และยังไม่มี Gencode — ไม่ต้องยิงแอด · ไม่นับในการ์ดสรุปของแท็บต้องยิง และไม่ได้ส่งให้ PFM
                    · ถ้าคลิปไหนต้องยิง ให้ใส่ Gencode หรือเปลี่ยนตั้งค่ากลุ่มในหน้าแคมเปญ แล้วคลิปจะย้ายไปแท็บต้องยิงเอง
                </div>
            )}

            {/* การ์ดสรุปค่าแอด — นับเฉพาะคลิปที่ต้องยิง (แสดงเฉพาะแท็บต้องยิง) */}
            {tab === 'ads' && (
            <div className="summary-grid">
                <div className="summary-card">
                    <div className="summary-label">ยิงแอดแล้ว</div>
                    <div className="summary-value">{s ? `${s.done_count}/${s.total_posts}` : '—'}</div>
                    <div className="ads-progress"><span style={{ width: `${donePct}%` }} /></div>
                    <div className="summary-sub">{s ? `เหลือยังไม่ยิง ${s.pending_count} โพสต์ · ${donePct}%` : '—'}</div>
                    {canSeeSpend && <div className="summary-sub">ค่าแอดสะสม {fmtMoney(s.total_spend)}</div>}
                </div>
                <div className="summary-card">
                    <div className="summary-label">Reach จากแอด</div>
                    <div className="summary-value">{Number(s?.total_reach) > 0 ? fmtNum(s.total_reach) : '—'}</div>
                    <div className="summary-sub">{!s ? '—' : reachRows.length
                        ? `มีข้อมูล ${reachRows.length}/${s.total_posts} โพสต์`
                        : 'ยังไม่มีข้อมูล Reach · กรอกในตารางได้'}</div>
                </div>
                <div className="summary-card">
                    <div className="summary-label">ต้นทุนต่อ 1,000 Reach ที่มีข้อมูล</div>
                    <div className="summary-value">{canSeeSpend && costPerThousandReach !== null ? fmtMoney(costPerThousandReach) : '—'}</div>
                    <div className="summary-sub">{!s ? '—' : !canSeeSpend ? 'เฉพาะผู้มีสิทธิ์ดูต้นทุน'
                        : measuredRows.length ? `คำนวณจาก ${measuredRows.length}/${paidRows.length} โพสต์ที่มีค่าแอด`
                            : 'รอ Reach ของโพสต์ที่มีค่าแอด'}</div>
                </div>
                {/* CPE รวม (2 ต.ค. 2026 — เดิมเป็นข้อความตายตัว "PFM ยังไม่ส่ง Engagement") = ค่าตัว ÷ engagement จริงในฐาน (ไม่รวมค่าแอด · 5 ต.ค.)
                    ของโพสต์ที่แสดงอยู่ · สูตรเดียวกับ CPE รายคลิป · คิดเฉพาะโพสต์ที่ใส่ค่าตัวแล้วและมี engagement */}
                <div className="summary-card">
                    <div className="summary-label">CPE (ค่าตัว / 1 engagement)</div>
                    <div className="summary-value">{canSeeSpend && s?.cpe != null ? fmtMoney(s.cpe) : '—'}</div>
                    <div className="summary-sub">{!s ? '—' : !canSeeSpend ? 'เฉพาะผู้มีสิทธิ์ดูต้นทุน'
                        : s.cpe_clips > 0 ? `คิดจาก ${s.cpe_clips}/${s.eng_posts} โพสต์ที่มี Engagement · เกณฑ์ ≤ ${GOOD_CPE}`
                            : s.eng_posts > 0 ? `มี Engagement ${s.eng_posts} โพสต์ แต่ยังไม่ใส่ค่าตัว / ยังไม่มีต้นทุน`
                                : 'ยังไม่มีโพสต์ที่มี Engagement'}</div>
                </div>
            </div>
            )}

            {/* ตารางติดตามการยิงแอดรายโพสต์ — การ์ดนี้กินเต็มความกว้างหน้า (.ads-tbl-panel) ให้เห็นคอลัมน์ได้มากที่สุด */}
            <div className="panel ads-tbl-panel">
                <div className="dash-section-head ads-tbl-bar">
                    <h3>ติดตามการยิงแอดรายโพสต์ <span className="dash-section-sub">
                        {data ? `แสดง ${rows.length} จาก ${tabRows.length} โพสต์ · ` : ''}
                        กดปุ่ม ▾ ที่หัวคอลัมน์เพื่อกรอง
                    </span></h3>
                    {/* ค้นหา — หน้าตาเดียวกับช่องค้นหาหน้า KOL Analytics (.ka-search) */}
                    <div className="ka-search ads-search">
                        <Icon name="search" size={15} />
                        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหาโพสต์"
                            placeholder="ค้นหาชื่อ KOL / แคมเปญ / สินค้า / Gencode / ID Post..." />
                        {search && (
                            <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>
                        )}
                    </div>
                    {rows.length > 0 && (
                        <button type="button" className="ads-jump-btn"
                            onClick={() => bodyRef.current?.querySelector('.kol-track-entry')?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' })}>
                            ↓ ดูรายการ
                        </button>
                    )}
                    {hasFilter && (
                        <button type="button" className="btn-clearfilter" onClick={clearFilters}>
                            ✕ ล้างตัวกรอง
                        </button>
                    )}
                </div>
                {!data ? (
                    <p className="empty" style={{ padding: '20px 0' }}>กำลังโหลด...</p>
                ) : rows.length === 0 ? (
                    <div className="empty-illus">
                        <div className="empty-illus-icon"><Icon name="target" size={30} /></div>
                        <div className="empty-illus-title">{hasFilter
                            ? (search.trim() ? `ไม่เจอโพสต์ที่ตรงกับ "${search.trim()}"` : 'ไม่มีโพสต์ตรงกับตัวกรอง')
                            : tab === 'noads' ? 'ไม่มีคลิปในกลุ่มที่ไม่ใช้ Gencode' : 'ยังไม่มีโพสต์ที่ยิงแอด'}</div>
                        {otherTabHits > 0 && (
                            <button type="button" className="btn-ghost ads-other-tab" onClick={() => setTab(tab === 'noads' ? 'ads' : 'noads')}>
                                เจอ {otherTabHits} โพสต์ในแท็บ{tab === 'noads' ? 'ต้องยิงแอด' : 'ไม่ต้องยิงแอด'} — ไปดู
                            </button>
                        )}
                        <p className="empty-illus-sub">
                            {hasFilter
                                ? 'ลองกด "ล้างตัวกรอง" หรือเลือกเงื่อนไขอื่นดู'
                                : tab === 'noads' ? 'คลิปที่อยู่ในกลุ่มที่ตั้งว่าไม่ใช้ Gencode (ขีด -) จะมาอยู่แท็บนี้เอง'
                                : 'เมื่อ KOL ลงงานและทีมใส่ลิงก์โพสต์ในแท็บ On Process แล้ว โพสต์จะขึ้นมาที่นี่ให้ติดตามค่าแอดอัตโนมัติ'}
                        </p>
                    </div>
                ) : (
                    <>
                    {/* หัวคอลัมน์ล็อกไว้บนจอตอนเลื่อนลง — ต้องอยู่นอกกรอบเลื่อนซ้ายขวา (sticky ในกรอบ overflow จะติดกับกรอบ ไม่ใช่หน้าจอ) */}
                    <div className="ads-tbl-headwrap" ref={headRef} onScroll={() => syncX(headRef, bodyRef)}>
                        <div className="ads-tbl">
                            <div className="ads-tbl-head">
                                <span title="รูปปกคลิป — TikTok ดึงให้อัตโนมัติ · กดรูปเพื่อเปิดโพสต์">IMAGE</span>
                                <span>KOL
                                    <ColumnFilter label="Platform" value={platform} onPick={setPlatform}
                                        options={[{ value: '', label: 'ทุก Platform', count: countIf('platform', () => true) },
                                        ...platformOptions.map(p => ({ value: p, label: p, count: countIf('platform', r => r.platform === p) }))]} />
                                </span>
                                <span>BRANDS</span><span>PRODUCTS</span><span>CAMPAIGN</span><span>TARGET</span><span>CONTENT TYPE</span><span>FORMAT</span>
                                <span>GENCODE</span><span>ID POST</span><span>วันลงงาน</span><span>วันยิงแอด</span>
                                <span>สถานะ
                                    <ColumnFilter label="สถานะยิงแอด" value={status} onPick={setStatus}
                                        options={[{ value: '', label: 'ทุกสถานะ', count: countIf('status', () => true) },
                                        ...STATUSES.map(st => ({ value: st, label: st === 'ยิงแล้ว' ? '✓ ยิงแล้ว' : st, count: countIf('status', r => shownStatusOf(r) === st) }))]} />
                                </span>
                                <span title="ค่าแอดสะสม (บาท) และ Reach — กรอกเองได้ บันทึกเมื่อออกจากช่อง">ค่าแอด / REACH</span>
                                <span title="นับจากวันที่ข้อมูลครบพร้อมยิง (ลงคลิป / Gencode / ID Post / ทีมอนุมัติ) ถึงวันยิงแอด — ภายใน 3 วัน = ตรงเวลา">ระยะเวลายิง
                                    <ColumnFilter label="ระยะเวลายิง" value={late} onPick={setLate}
                                        options={[{ value: '', label: 'ทั้งหมด', count: countIf('late', () => true) },
                                        ...TIMING_OPTS.map(([v, l]) => ({ value: v, label: l, dot: v, count: countIf('late', r => lateBucket(r) === v) }))]} />
                                </span>
                                <span title="ผลที่ระบบล็อกไว้ตอนค่ายิงแอดสะสมถึงเกณฑ์ของแบรนด์นั้น — แก้ไม่ได้ (ชี้ที่ป้ายในแถวเพื่อดูตัวเลขของแบรนด์)">STAMPED PFM 🔒</span>
                                <span title="ผลตอนนี้ คำนวณสดจากข้อมูลล่าสุด — ใช้ตัดสินว่าควรยิงต่อหรือหยุด">PFM</span>
                                <span>หมายเหตุ</span>
                            </div>
                        </div>
                    </div>
                    <div className="ads-tbl-scroll" ref={bodyRef} onScroll={() => syncX(bodyRef, headRef)}>
                        <div className="ads-tbl">
                            {rows.map(r => <AdRow key={r.sub_id} row={r} onSaved={load} canCost={seesAllBrands(user)} noAd={isNoAdRow(r)} />)}
                        </div>
                    </div>
                    </>
                )}
            </div>
        </div>
    );
}
