import PeopleTab from './PeopleTab.jsx';
import RatesTab from './RatesTab.jsx';

// แท็บ "คนและราคา" — รวมสองเรื่องที่ใช้ตอนตัดสินใจจ้าง: ประวัติคน/ค่าตัว กับการถามราคาก่อนจ้าง
// ตัวสลับเขียน ?tab=people|rates (ลิงก์เก่าของสองแท็บเดิมจึงยังพามาถูกที่)
const SUBS = [
    { key: 'people', label: 'คนที่เคยจ้าง' },
    { key: 'rates', label: 'ถามราคา' }
];

export default function PeopleRatesTab({ sub = 'people', onSub, rateOpen = 0, onRatesLoaded, rateSent = false }) {
    return (
        <div className="th-pr">
            <div className="th-seg" role="tablist" aria-label="คนและราคา">
                {SUBS.map(s => (
                    <button key={s.key} type="button" role="tab" aria-selected={sub === s.key}
                        className={'th-seg-btn' + (sub === s.key ? ' on' : '')}
                        onClick={() => sub !== s.key && onSub && onSub(s.key)}>
                        {s.label}
                        {s.key === 'rates' && rateOpen > 0 && (
                            <span className="agency-tab-count warn" title="ถามราคาที่ยังรอตอบ">{rateOpen}</span>
                        )}
                    </button>
                ))}
            </div>
            {sub === 'rates'
                ? <RatesTab onLoaded={onRatesLoaded} justSent={rateSent} />
                : <PeopleTab />}
        </div>
    );
}
