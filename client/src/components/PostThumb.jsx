import Icon from './Icon.jsx';
import useLazyImage from '../utils/useLazyImage.js';
import { okThumbPath, postHref, platformShort } from '../data/postThumb.js';

// รูปปกคลิปในคอลัมน์ IMAGE หน้า Ads — แนวตั้งมุมมน กดแล้วเปิดโพสต์ในแท็บใหม่
// TikTok: server ดึงปกมาเก็บไว้ให้ (row.thumb) · แพลตฟอร์มอื่น / ดึงไม่ได้: กล่องไอคอน + ชื่อแพลตฟอร์ม (ยังกดเปิดโพสต์ได้)
export default function PostThumb({ row }) {
    const path = okThumbPath(row.thumb) ? row.thumb : '';
    const [box, img] = useLazyImage(path);
    const href = postHref(row.post_url);

    let inner;
    let title;
    if (img.url) {
        inner = <img src={img.url} alt="" decoding="async" />;
        title = 'เปิดโพสต์';
    } else if (path && !img.failed) {
        inner = <span className="ads-thumb-wait" aria-hidden="true" />;
        title = 'กำลังโหลดรูปปก…';
    } else {
        inner = (
            <span className="ads-thumb-none" aria-hidden="true">
                <Icon name={path ? 'play' : 'image'} size={16} />
                <em>{platformShort(row.platform)}</em>
            </span>
        );
        title = path
            ? 'ดึงรูปปกไม่ได้ (คลิปอาจถูกลบหรือตั้งเป็นส่วนตัว) — กดเพื่อเปิดโพสต์'
            : 'ไม่มีรูปปก (ดึงอัตโนมัติได้เฉพาะ TikTok) — กดเพื่อเปิดโพสต์';
    }

    if (!href) {
        return <span ref={box} className="ads-thumb off" title="ยังไม่มีลิงก์โพสต์">{inner}</span>;
    }
    return (
        <a ref={box} className="ads-thumb" href={href} target="_blank" rel="noopener noreferrer"
            title={title} aria-label={`เปิดโพสต์ของ ${row.account_name || 'KOL'}`}>
            {inner}
        </a>
    );
}
