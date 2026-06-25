import os
import sqlite3
from flask import g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ====== 核心修改：智能识别 Railway 持久化卷路径 ======
if os.path.exists("/data"):
    # 如果在 Railway 云端，让数据库住进永不丢失的持久化卷
    DB_PATH = "/data/history.db"
else:
    # 如果在本地电脑开发，依然保存在项目目录下的 data/history.db
    DB_PATH = os.path.join(BASE_DIR, 'data', 'history.db')


# ===================================================

def get_db() -> sqlite3.Connection:
    """获取当前请求的数据库连接（通过 Flask g 缓存）"""
    if '_db' not in g:
        # 自动创建数据库文件所在的文件夹
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=15)  # 等待锁最多 15 秒
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")  # 比 FULL 快，仍保证数据安全
        g._db = conn
    return g._db


def close_db(e=None):
    db = g.pop('_db', None)
    if db:
        db.close()


def init_db():
    """创建数据库表（幂等操作）"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript("""
                           CREATE TABLE IF NOT EXISTS users
                           (
                               id
                               INTEGER
                               PRIMARY
                               KEY
                               AUTOINCREMENT,
                               username
                               TEXT
                               UNIQUE
                               NOT
                               NULL,
                               password_hash
                               TEXT
                               NOT
                               NULL,
                               role
                               TEXT
                               NOT
                               NULL
                               DEFAULT
                               'user',
                               avatar
                               TEXT
                               DEFAULT
                               NULL,
                               created_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP
                           );

                           CREATE TABLE IF NOT EXISTS invite_codes
                           (
                               id
                               INTEGER
                               PRIMARY
                               KEY
                               AUTOINCREMENT,
                               code
                               TEXT
                               UNIQUE
                               NOT
                               NULL,
                               created_by
                               INTEGER
                               NOT
                               NULL,
                               used_by
                               INTEGER
                               DEFAULT
                               NULL,
                               is_used
                               INTEGER
                               NOT
                               NULL
                               DEFAULT
                               0,
                               created_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP,
                               used_at
                               DATETIME
                               DEFAULT
                               NULL,
                               FOREIGN
                               KEY
                           (
                               created_by
                           ) REFERENCES users
                           (
                               id
                           ),
                               FOREIGN KEY
                           (
                               used_by
                           ) REFERENCES users
                           (
                               id
                           )
                               );

                           CREATE TABLE IF NOT EXISTS sessions
                           (
                               session_id
                               TEXT
                               PRIMARY
                               KEY,
                               user_id
                               INTEGER
                               NOT
                               NULL
                               DEFAULT
                               1,
                               title
                               TEXT
                               NOT
                               NULL
                               DEFAULT
                               '新对话',
                               is_pinned
                               INTEGER
                               NOT
                               NULL
                               DEFAULT
                               0,
                               created_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP,
                               updated_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP,
                               FOREIGN
                               KEY
                           (
                               user_id
                           ) REFERENCES users
                           (
                               id
                           )
                               );

                           CREATE TABLE IF NOT EXISTS messages
                           (
                               id
                               INTEGER
                               PRIMARY
                               KEY
                               AUTOINCREMENT,
                               session_id
                               TEXT
                               NOT
                               NULL,
                               role
                               TEXT
                               NOT
                               NULL, -- 'user' | 'assistant'
                               content
                               TEXT
                               NOT
                               NULL,
                               created_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP,
                               FOREIGN
                               KEY
                           (
                               session_id
                           ) REFERENCES sessions
                           (
                               session_id
                           ) ON DELETE CASCADE
                               );

                           CREATE INDEX IF NOT EXISTS idx_messages_session
                               ON messages(session_id, created_at);

                           CREATE TABLE IF NOT EXISTS admin_logs
                           (
                               id
                               INTEGER
                               PRIMARY
                               KEY
                               AUTOINCREMENT,
                               admin_id
                               INTEGER
                               NOT
                               NULL,
                               action
                               TEXT
                               NOT
                               NULL,
                               target_id
                               INTEGER
                               DEFAULT
                               NULL,
                               detail
                               TEXT
                               DEFAULT
                               NULL,
                               created_at
                               DATETIME
                               NOT
                               NULL
                               DEFAULT
                               CURRENT_TIMESTAMP,
                               FOREIGN
                               KEY
                           (
                               admin_id
                           ) REFERENCES users
                           (
                               id
                           )
                               );
                           """)

        # 自动迁移：尝试为现有的 sessions 表添加 is_pinned 和 user_id 字段
        try:
            conn.execute("ALTER TABLE sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError:
            pass

        # 尝试添加 avatar 字段（平滑迁移老数据）
        try:
            conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN banned_at DATETIME DEFAULT NULL")
        except sqlite3.OperationalError:
            pass

        # 初始化管理员账户
        from werkzeug.security import generate_password_hash
        admin = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        if not admin:
            hashed_pwd = generate_password_hash("XiaoJin@2026")
            conn.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                ('admin', hashed_pwd, 'admin')
            )


def load_recent_history(db: sqlite3.Connection, session_id: str, user_id: int, limit: int = 20):
    """加载最近 limit 条消息，需验证该 session 是否属于当前用户"""
    sess = db.execute("SELECT user_id FROM sessions WHERE session_id=?", (session_id,)).fetchone()
    if sess and sess['user_id'] != user_id:
        return []

    rows = db.execute(
        """SELECT role, content
           FROM messages
           WHERE session_id = ?
           ORDER BY created_at DESC LIMIT ?""",
        (session_id, limit)
    ).fetchall()
    return list(reversed(rows))


def get_message_count(db: sqlite3.Connection, session_id: str) -> int:
    row = db.execute(
        "SELECT COUNT(*) FROM messages WHERE session_id=?", (session_id,)
    ).fetchone()
    return row[0] if row else 0


def save_user_message_and_init_session(
        db: sqlite3.Connection,
        session_id: str,
        user_id: int,
        user_msg: str
):
    """保存用户消息并初始化 session"""
    count = get_message_count(db, session_id)
    title = user_msg[:30].strip()
    with db:
        db.execute(
            "INSERT OR IGNORE INTO sessions (session_id, user_id, title) VALUES (?, ?, ?)",
            (session_id, user_id, title)
        )
        if count == 0:
            db.execute(
                "UPDATE sessions SET title=? WHERE session_id=?",
                (title, session_id)
            )
        db.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)",
            (session_id, user_msg)
        )
        db.execute(
            "UPDATE sessions SET updated_at=CURRENT_TIMESTAMP WHERE session_id=?",
            (session_id,)
        )


def save_assistant_reply(
        db: sqlite3.Connection,
        session_id: str,
        reply: str
):
    """保存 AI 回复"""
    with db:
        db.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)",
            (session_id, reply)
        )
        db.execute(
            "UPDATE sessions SET updated_at=CURRENT_TIMESTAMP WHERE session_id=?",
            (session_id,)
        )