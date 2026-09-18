import { Component } from 'react';

// กันจอขาวเมื่อหน้าใดหน้าหนึ่งพัง (เช่นโหลดไฟล์ของหน้าไม่ได้หลัง deploy / เน็ตหลุด)
// แสดงข้อความพร้อมปุ่มโหลดใหม่ทั้งหน้า — ต้องโหลดทั้งหน้าเท่านั้น เพราะ React จำผลที่โหลดไม่สำเร็จไว้แล้ว
export default class PageErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        // ไว้ดูใน console ตอนแจ้งปัญหา — ไม่ส่งออกไปไหน
        console.error('page failed to render', error);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className={this.props.full ? 'page-loading' : 'page-loading-inline'}>
                <div className="auth-retry">
                    <p>โหลดหน้านี้ไม่สำเร็จ — อาจเป็นเพราะเน็ตไม่เสถียร หรือระบบเพิ่งอัปเดต</p>
                    <button type="button" className="btn-primary" onClick={() => window.location.reload()}>โหลดใหม่</button>
                </div>
            </div>
        );
    }
}
