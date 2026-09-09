-- ============================================================
-- KOL Central Dashboard v2 — PostgreSQL Schema
-- ฐานข้อมูล: kol_dashboard
-- ============================================================
-- หลักการออกแบบ
--   • ทุกอย่างที่ค้นหา/กรอง/นับ = คอลัมน์จริง (ไม่ยัดลง JSON)
--   • JSONB ใช้เฉพาะข้อมูลที่ไม่มีรูปทรงตายตัวจริง ๆ (ad_groups, บรีฟรายสินค้า, สแตมป์ผลงาน)
--   • ของที่เดิมซ้อนอยู่ในแคมเปญ (ลิงก์เอเจนซี่ → ข้อความ → ไฟล์รายงาน) แยกเป็นตารางลูก
--     เพราะถูกเพิ่ม/แก้/ลบทีละรายการ ถ้าเก็บเป็นก้อน JSON จะชนกันเองเวลาหลายคนใช้พร้อมกัน
--   • ไฟล์อัปโหลดเก็บบนดิสก์ (โฟลเดอร์ uploads) ฐานข้อมูลเก็บแค่ metadata
--   • ทุก FK มี ON DELETE ชัดเจน — ลบแคมเปญแล้วข้อมูลลูกต้องไม่ค้างเป็นขยะ
-- ============================================================

-- ---------- teams ----------
CREATE TABLE IF NOT EXISTS teams (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- users ----------
-- role/status ตรงกับ server/src/data/roles.js (4 role, 3 สถานะ)
-- brands / agency_tokens เป็นรายการสั้น ๆ ต่อผู้ใช้ ใช้ JSONB พอ
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     VARCHAR(255),
    nickname      VARCHAR(255),
    role          VARCHAR(20)  NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'manager', 'member', 'agency')),
    status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('pending', 'active', 'rejected')),
    brands        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    agency_tokens JSONB        NOT NULL DEFAULT '[]'::jsonb,
    team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_team   ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- ---------- kols (ส่วนกลาง ทุกทีมเห็นเหมือนกัน) ----------
CREATE TABLE IF NOT EXISTS kols (
    id              SERIAL PRIMARY KEY,
    kol_code        VARCHAR(255) UNIQUE,
    name            VARCHAR(255) NOT NULL,
    username        VARCHAR(255),
    platform        VARCHAR(100),
    avatar          TEXT,
    followers       BIGINT       NOT NULL DEFAULT 0,
    engagement_rate NUMERIC(10,2),
    category        VARCHAR(150),
    tags            JSONB,
    contact_info    JSONB,
    extra_data      JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kols_name     ON kols(name);
CREATE INDEX IF NOT EXISTS idx_kols_platform ON kols(platform);
CREATE INDEX IF NOT EXISTS idx_kols_category ON kols(category);

-- ---------- projects (แคมเปญ) ----------
-- ad_groups = โครงกลุ่มงาน (Platform/สินค้า/จำนวนคลิป/allocations) รูปทรงยืดหยุ่นตามการใช้งานจริง → JSONB
-- product_briefs / platform_briefs = บรีฟรายสินค้า/รายแพลตฟอร์ม (key เป็นชื่อสินค้า/แพลตฟอร์ม) → JSONB
CREATE TABLE IF NOT EXISTS projects (
    id               SERIAL PRIMARY KEY,
    team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name             VARCHAR(500) NOT NULL,
    brand            VARCHAR(255),
    objective        TEXT,
    product          VARCHAR(255),
    products         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ad_groups        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    owner            VARCHAR(255),
    creator          VARCHAR(255),
    brief_link       TEXT,
    brief_file       JSONB,
    product_briefs   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    platform_briefs  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    platform_budgets JSONB       NOT NULL DEFAULT '{}'::jsonb,
    kol_target       INTEGER     NOT NULL DEFAULT 0,
    budget           NUMERIC(18,2) NOT NULL DEFAULT 0,
    start_date       DATE,
    end_date         DATE,
    status           VARCHAR(50) NOT NULL DEFAULT 'Draft',
    description      TEXT,
    share_token      VARCHAR(255) UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_team    ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_brand   ON projects(brand);
CREATE INDEX IF NOT EXISTS idx_projects_status  ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);

-- ---------- project_kols (KOL ส่วนกลางที่ถูกหยิบเข้าแคมเปญ) ----------
CREATE TABLE IF NOT EXISTS project_kols (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kol_id      INTEGER NOT NULL REFERENCES kols(id)     ON DELETE CASCADE,
    fee         NUMERIC(18,2) NOT NULL DEFAULT 0,
    views       BIGINT  NOT NULL DEFAULT 0,
    likes       BIGINT  NOT NULL DEFAULT 0,
    comments    BIGINT  NOT NULL DEFAULT 0,
    shares      BIGINT  NOT NULL DEFAULT 0,
    post_link   TEXT,
    posted_date DATE,
    status      VARCHAR(50) NOT NULL DEFAULT 'Pending',
    notes       TEXT,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, kol_id)
);
CREATE INDEX IF NOT EXISTS idx_project_kols_project ON project_kols(project_id);
CREATE INDEX IF NOT EXISTS idx_project_kols_kol     ON project_kols(kol_id);

-- ---------- agency_links (ลิงก์งานของเอเจนซี่แต่ละราย) ----------
-- เดิมซ้อนอยู่ใน projects.agency_links[] — แยกออกมาเพราะ token ต้อง unique ทั้งระบบ
-- (resolveToken ค้นข้ามทุกแคมเปญ) และถูกเพิ่ม/ลบทีละอัน
CREATE TABLE IF NOT EXISTS agency_links (
    id             SERIAL PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token          VARCHAR(255) UNIQUE NOT NULL,
    name           VARCHAR(255),
    groups         JSONB   NOT NULL DEFAULT '[]'::jsonb,
    products       JSONB   NOT NULL DEFAULT '[]'::jsonb,
    platforms      JSONB   NOT NULL DEFAULT '[]'::jsonb,
    kol_count      INTEGER NOT NULL DEFAULT 0,
    team_read_at   TIMESTAMPTZ,
    agency_read_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agency_links_project ON agency_links(project_id);

-- ---------- agency_messages (แชททีม ↔ เอเจนซี่) ----------
-- id เป็นสตริงสั้นเดาไม่ได้ (เช่น 'rmf3k2a9x') ไม่ใช่เลขรัน — คงรูปแบบเดิมไว้
-- คอลัมน์ msg_from ชื่อไม่ตรงกับฟิลด์เดิม ("from") เพราะ from เป็นคำสงวนของ SQL
-- เวลาอ่านออกไปจะ alias กลับเป็น "from" ให้เหมือนเดิมทุกครั้ง
CREATE TABLE IF NOT EXISTS agency_messages (
    id         VARCHAR(64) PRIMARY KEY,
    link_id    INTEGER NOT NULL REFERENCES agency_links(id) ON DELETE CASCADE,
    msg_from   VARCHAR(20),
    by_name    VARCHAR(255),
    text       TEXT,
    image      TEXT,
    thumb      TEXT,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at  TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agency_messages_link ON agency_messages(link_id, at);

-- ---------- agency_reports (ไฟล์รายงานที่เอเจนซี่แนบ) ----------
CREATE TABLE IF NOT EXISTS agency_reports (
    id          VARCHAR(64) PRIMARY KEY,
    link_id     INTEGER NOT NULL REFERENCES agency_links(id) ON DELETE CASCADE,
    kind        VARCHAR(50),
    filename    TEXT,
    original    TEXT,
    url         TEXT,
    size        BIGINT,
    note        TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_reports_link ON agency_reports(link_id);

-- ---------- submissions (รายชื่อ KOL ที่เอเจนซี่ส่งเข้ามา) ----------
-- ตารางกว้างโดยตั้งใจ: 1 แถว = 1 คลิป ของ 1 คน (คนเดียวกันผูกกันด้วย person_key)
-- ช่อง *_at / *_by คือรอยว่า "ใครแก้ลิงก์คลิป/Gencode/ID Post/วันลงงาน ล่าสุดเมื่อไหร่"
-- perf_stamp = ผลตัดสินคุ้ม/ไม่คุ้ม ที่ระบบล็อกไว้ ณ เวลาหนึ่ง ห้ามแก้จากภายนอก
CREATE TABLE IF NOT EXISTS submissions (
    id               SERIAL PRIMARY KEY,
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agency_token     VARCHAR(255),
    person_key       VARCHAR(64),
    clip_no          INTEGER NOT NULL DEFAULT 1,
    clip_name        TEXT,
    account_name     TEXT,
    followers        NUMERIC(20,2) NOT NULL DEFAULT 0,
    platform         VARCHAR(100),
    product          VARCHAR(255),
    budget           NUMERIC(18,2) NOT NULL DEFAULT 0,
    agency           VARCHAR(255),
    link_account     TEXT,
    group_key        VARCHAR(255),
    tier             VARCHAR(100),
    content_type     VARCHAR(150),
    content_format   VARCHAR(150),
    status           VARCHAR(30)  NOT NULL DEFAULT 'submitted',
    approved         BOOLEAN      NOT NULL DEFAULT FALSE,
    draft_status     VARCHAR(100),
    draft_link       TEXT, draft_link2 TEXT, draft_link3 TEXT, draft_link4 TEXT, draft_link5 TEXT,
    feedback         TEXT, feedback2  TEXT, feedback3  TEXT, feedback4  TEXT, feedback5  TEXT,
    concept          TEXT,
    gen_date         TEXT,
    gencode          VARCHAR(255),
    gencode_at       TIMESTAMPTZ,
    gencode_by       VARCHAR(255),
    post_url         TEXT,
    post_url_at      TIMESTAMPTZ,
    post_url_by      VARCHAR(255),
    id_post          VARCHAR(255),
    id_post_at       TIMESTAMPTZ,
    id_post_by       VARCHAR(255),
    post_date        TEXT,
    post_date_at     TIMESTAMPTZ,
    post_date_by     VARCHAR(255),
    code_expire      INTEGER      NOT NULL DEFAULT 60,
    ad_status        VARCHAR(50)  NOT NULL DEFAULT 'ยังไม่ยิง',
    ad_spend         NUMERIC(18,2) NOT NULL DEFAULT 0,
    ad_reach         NUMERIC(20,2) NOT NULL DEFAULT 0,
    ad_start         TEXT,
    ad_end           TEXT,
    ad_note          TEXT,
    ad_synced_at     TIMESTAMPTZ,
    views            NUMERIC(20,2) NOT NULL DEFAULT 0,
    likes            NUMERIC(20,2) NOT NULL DEFAULT 0,
    comments         NUMERIC(20,2) NOT NULL DEFAULT 0,
    saves            NUMERIC(20,2) NOT NULL DEFAULT 0,
    shares           NUMERIC(20,2) NOT NULL DEFAULT 0,
    reposts          NUMERIC(20,2) NOT NULL DEFAULT 0,
    perf_synced_at   TEXT,
    perf_stamp       JSONB,
    team_note        TEXT,
    agency_note      TEXT,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ,
    decided_by       VARCHAR(255),
    list_updated_at  TIMESTAMPTZ,
    work_updated_at  TIMESTAMPTZ,
    draft_updated_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_submissions_project  ON submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_submissions_token    ON submissions(agency_token);
CREATE INDEX IF NOT EXISTS idx_submissions_person   ON submissions(person_key);
CREATE INDEX IF NOT EXISTS idx_submissions_status   ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_gencode  ON submissions(gencode);
CREATE INDEX IF NOT EXISTS idx_submissions_idpost   ON submissions(id_post);

-- ---------- payments (สถานะเอกสาร/การจ่ายต่อแคมเปญ+เอเจนซี่) ----------
CREATE TABLE IF NOT EXISTS payments (
    id             SERIAL PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agency_name    VARCHAR(255),
    status         VARCHAR(50),
    payment_date   DATE,
    notes          TEXT,
    quotation      JSONB,
    quotation_link TEXT,
    invoice        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);

-- ---------- pay_batches (รอบทำจ่าย — สลิป 1 ใบ ครอบได้หลายงวด) ----------
CREATE TABLE IF NOT EXISTS pay_batches (
    id         SERIAL PRIMARY KEY,
    agency     VARCHAR(255),
    pay_date   DATE,
    note       TEXT,
    slip       JSONB,
    total      NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pay_batches_agency ON pay_batches(agency);

-- ---------- installments (งวดการจ่ายของแต่ละแคมเปญ+เอเจนซี่) ----------
-- batch_id ชี้ไปยังรอบทำจ่ายที่รวมงวดนี้ไปแล้ว — ลบรอบทิ้ง งวดต้องกลับมาเป็นค้างจ่าย
-- จึงเป็น ON DELETE SET NULL ไม่ใช่ CASCADE
CREATE TABLE IF NOT EXISTS installments (
    id           SERIAL PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agency       VARCHAR(255),
    group_key    VARCHAR(255),
    manual_id    VARCHAR(64),
    no           INTEGER,
    "of"         INTEGER,
    title        TEXT,
    percent      NUMERIC(10,4),
    amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
    due_date     DATE,
    status       VARCHAR(30) NOT NULL DEFAULT 'pending',
    batch_id     INTEGER REFERENCES pay_batches(id) ON DELETE SET NULL,
    invoice      JSONB,
    invoice_link TEXT,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_installments_project ON installments(project_id);
CREATE INDEX IF NOT EXISTS idx_installments_batch   ON installments(batch_id);
CREATE INDEX IF NOT EXISTS idx_installments_status  ON installments(status);
CREATE INDEX IF NOT EXISTS idx_installments_agency  ON installments(agency);

-- ---------- rate_requests (คำขอเรตจากทีม) ----------
CREATE TABLE IF NOT EXISTS rate_requests (
    id           SERIAL PRIMARY KEY,
    team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    brand        VARCHAR(255),
    kol_name     VARCHAR(255),
    link_account TEXT,
    platforms    JSONB NOT NULL DEFAULT '[]'::jsonb,
    products     JSONB NOT NULL DEFAULT '[]'::jsonb,
    budget       NUMERIC(18,2),
    no_budget    BOOLEAN NOT NULL DEFAULT FALSE,
    scope        TEXT,
    brief_link   TEXT,
    brief_note   TEXT,
    status       VARCHAR(50) NOT NULL DEFAULT 'open',
    created_by   VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_requests_brand ON rate_requests(brand);

-- ---------- activity_logs (ประวัติการแก้ไข) ----------
-- เก็บชื่อผู้ใช้/แคมเปญเป็นข้อความซ้ำไว้ด้วย เพราะประวัติต้องอ่านออกแม้ต้นทางถูกลบไปแล้ว
--
-- ตั้งใจ "ไม่ผูก foreign key" กับ users/teams/projects
-- เพราะนี่คือบันทึกประวัติ ไม่ใช่ข้อมูลที่มีชีวิต — ลบแคมเปญแล้วประวัติต้องคงเดิมทุกตัวอักษร
-- ถ้าผูก FK แบบ SET NULL ประวัติจะถูกแก้ย้อนหลังเมื่อของที่มันอ้างถึงหายไป ซึ่งทำให้หลักฐานเพี้ยน
-- (ถ้าผูกแบบ CASCADE ยิ่งแย่ ประวัติจะหายไปพร้อมกัน)
CREATE TABLE IF NOT EXISTS activity_logs (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER,
    user_name    VARCHAR(255),
    team_id      INTEGER,
    project_id   INTEGER,
    project_name VARCHAR(500),
    action       VARCHAR(100),
    summary      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id);

-- ---------- trigger: updated_at ขยับเองทุกครั้งที่แก้ ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['teams', 'users', 'kols', 'projects'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$s', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END $$;
