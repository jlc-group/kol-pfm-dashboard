import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * ช่องกรอกรหัสผ่าน + ปุ่มตาเปิด/ปิดการมองเห็น
 * ใช้ร่วมกันทุกหน้าที่มีช่องรหัสผ่าน จะได้ทำงานเหมือนกันหมด
 */
export default function PasswordInput({ value, onChange, autoComplete = 'current-password', required, autoFocus, placeholder }) {
    const [show, setShow] = useState(false);
    return (
        <div className="pw-field">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                autoComplete={autoComplete}
                required={required}
                autoFocus={autoFocus}
                placeholder={placeholder}
            />
            <button type="button" className="pw-eye"
                onClick={() => setShow(v => !v)}
                title={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                tabIndex={-1}>
                <Icon name={show ? 'eye-off' : 'eye'} size={17} />
            </button>
        </div>
    );
}
