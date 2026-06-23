import random
import string
from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash
from database import get_db

admin_bp = Blueprint('admin', __name__)


def is_admin():
    user_id = session.get('user_id')
    if not user_id:
        return False
    db = get_db()
    user = db.execute("SELECT role, is_banned FROM users WHERE id=?", (user_id,)).fetchone()
    return bool(user and user['role'] == 'admin' and not user['is_banned'])


def log_admin_action(db, admin_id, action, target_id=None, detail=None):
    """记录管理员操作日志"""
    db.execute(
        "INSERT INTO admin_logs (admin_id, action, target_id, detail) VALUES (?, ?, ?, ?)",
        (admin_id, action, target_id, detail)
    )


@admin_bp.before_request
def admin_required():
    if not is_admin():
        return jsonify({'error': '无权访问'}), 403


@admin_bp.route('/api/admin/users', methods=['GET'])
def list_users():
    db = get_db()
    rows = db.execute("""
        SELECT u.id, u.username, u.role, u.is_banned, u.banned_at, u.created_at,
               COUNT(DISTINCT s.session_id) AS session_count,
               COUNT(m.id) AS message_count,
               MAX(m.created_at) AS last_message_at
        FROM users u
        LEFT JOIN sessions s ON u.id = s.user_id
        LEFT JOIN messages m ON s.session_id = m.session_id AND m.role = 'user'
        GROUP BY u.id
        ORDER BY u.id ASC
    """).fetchall()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/users/<int:user_id>/ban', methods=['POST'])
def set_user_ban(user_id):
    current_user_id = session.get('user_id')
    if user_id == current_user_id:
        return jsonify({'error': '不能封禁当前登录的管理员'}), 400

    data = request.json or {}
    banned = 1 if data.get('banned', True) else 0
    db = get_db()
    user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    with db:
        db.execute(
            "UPDATE users SET is_banned=?, banned_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?",
            (banned, banned, user_id)
        )
        action = 'ban_user' if banned else 'unban_user'
        log_admin_action(db, current_user_id, action, target_id=user_id)
    return jsonify({'ok': True, 'is_banned': banned})


@admin_bp.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    if user_id == session.get('user_id'):
        return jsonify({'error': '不能注销当前登录的管理员账户'}), 400
    db = get_db()
    user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    with db:
        db.execute(
            "DELETE FROM messages WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id=?)",
            (user_id,)
        )
        db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        db.execute("UPDATE invite_codes SET used_by=NULL, is_used=0, used_at=NULL WHERE used_by=?", (user_id,))
        db.execute("DELETE FROM users WHERE id=?", (user_id,))
        log_admin_action(db, session.get('user_id'), 'delete_user', target_id=user_id)
    return jsonify({'ok': True})


@admin_bp.route('/api/admin/messages', methods=['GET'])
def list_user_messages():
    limit = request.args.get('limit', 100, type=int)
    user_id = request.args.get('user_id', type=int)
    limit = max(1, min(limit, 500))

    params = []
    where = "WHERE m.role = 'user'"
    if user_id:
        where += " AND u.id = ?"
        params.append(user_id)
    params.append(limit)

    db = get_db()
    rows = db.execute(f"""
        SELECT m.id, m.content, m.created_at,
               s.session_id, s.title AS session_title,
               u.id AS user_id, u.username, u.is_banned
        FROM messages m
        JOIN sessions s ON m.session_id = s.session_id
        JOIN users u ON s.user_id = u.id
        {where}
        ORDER BY m.created_at DESC
        LIMIT ?
    """, params).fetchall()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/invite-codes', methods=['GET'])
def list_invite_codes():
    db = get_db()
    rows = db.execute("""
        SELECT i.id, i.code, i.is_used, i.created_at, i.used_at,
               creator.username as creator_name,
               user.username as user_name
        FROM invite_codes i
        LEFT JOIN users creator ON i.created_by = creator.id
        LEFT JOIN users user ON i.used_by = user.id
        ORDER BY i.created_at DESC
    """).fetchall()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/invite-codes', methods=['POST'])
def generate_invite_codes():
    data = request.json or {}
    count = int(data.get('count', 1))
    if count < 1 or count > 100:
        return jsonify({'error': '一次最多生成 100 个邀请码'}), 400

    db = get_db()
    admin_id = session.get('user_id')
    codes = []

    with db:
        for _ in range(count):
            rand_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
            code = f"XJ-{rand_str}"
            db.execute("INSERT INTO invite_codes (code, created_by) VALUES (?, ?)", (code, admin_id))
            codes.append(code)
        log_admin_action(db, admin_id, 'generate_codes', detail=f'生成 {count} 个邀请码')

    return jsonify({'ok': True, 'codes': codes, 'message': f'成功生成 {count} 个邀请码'})


@admin_bp.route('/api/admin/invite-codes/unused', methods=['DELETE'])
def delete_unused_invite_codes():
    db = get_db()
    with db:
        result = db.execute("DELETE FROM invite_codes WHERE is_used = 0")
        deleted = result.rowcount
        log_admin_action(db, session.get('user_id'), 'delete_unused_codes',
                         detail=f'批量删除 {deleted} 个未使用邀请码')
    return jsonify({'ok': True, 'deleted_count': deleted})


@admin_bp.route('/api/admin/invite-codes/<int:code_id>', methods=['DELETE'])
def delete_invite_code(code_id):
    db = get_db()
    with db:
        code = db.execute("SELECT is_used FROM invite_codes WHERE id=?", (code_id,)).fetchone()
        if not code:
            return jsonify({'error': '未找到该邀请码'}), 404
        if code['is_used'] == 1:
            return jsonify({'error': '无法删除已使用的邀请码'}), 400
        db.execute("DELETE FROM invite_codes WHERE id=?", (code_id,))
        log_admin_action(db, session.get('user_id'), 'delete_code', detail=f'删除邀请码 ID={code_id}')
    return jsonify({'ok': True})


@admin_bp.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    db = get_db()
    stats = {}

    row = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()
    stats['total_users'] = row['c']

    row = db.execute("SELECT COUNT(*) AS c FROM users WHERE is_banned = 1").fetchone()
    stats['banned_users'] = row['c']

    row = db.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()
    stats['total_sessions'] = row['c']

    row = db.execute("SELECT COUNT(*) AS c FROM messages").fetchone()
    stats['total_messages'] = row['c']

    row = db.execute("SELECT COUNT(*) AS c FROM invite_codes WHERE is_used = 0").fetchone()
    stats['unused_codes'] = row['c']

    row = db.execute("SELECT COUNT(*) AS c FROM invite_codes WHERE is_used = 1").fetchone()
    stats['used_codes'] = row['c']

    row = db.execute("""
        SELECT COUNT(DISTINCT s.user_id) AS c
        FROM messages m
        JOIN sessions s ON m.session_id = s.session_id
        WHERE DATE(m.created_at) = DATE('now')
    """).fetchone()
    stats['today_active_users'] = row['c']

    row = db.execute("""
        SELECT COUNT(*) AS c FROM messages m
        WHERE DATE(m.created_at) = DATE('now')
    """).fetchone()
    stats['today_messages'] = row['c']

    return jsonify(stats)


@admin_bp.route('/api/admin/users/<int:user_id>/role', methods=['PUT'])
def set_user_role(user_id):
    current_user_id = session.get('user_id')
    if user_id == current_user_id:
        return jsonify({'error': '不能修改自己的角色'}), 400

    data = request.json or {}
    new_role = data.get('role')
    if new_role not in ('admin', 'user'):
        return jsonify({'error': '角色必须是 admin 或 user'}), 400

    db = get_db()
    user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    with db:
        db.execute("UPDATE users SET role=? WHERE id=?", (new_role, user_id))
        log_admin_action(db, current_user_id, 'change_role', target_id=user_id,
                         detail=f'角色变更为 {new_role}')
    return jsonify({'ok': True, 'role': new_role})


@admin_bp.route('/api/admin/users/<int:user_id>/reset-password', methods=['POST'])
def reset_user_password(user_id):
    db = get_db()
    user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    data = request.json or {}
    new_password = data.get('new_password', 'Xj@123456')
    hashed = generate_password_hash(new_password)

    with db:
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hashed, user_id))
        log_admin_action(db, session.get('user_id'), 'reset_password', target_id=user_id)
    return jsonify({'ok': True, 'message': '密码已重置'})


@admin_bp.route('/api/admin/users/<int:user_id>/sessions', methods=['GET'])
def list_user_sessions(user_id):
    db = get_db()
    rows = db.execute("""
        SELECT s.session_id, s.title, s.created_at, s.updated_at,
               COUNT(m.id) AS message_count
        FROM sessions s
        LEFT JOIN messages m ON s.session_id = m.session_id
        WHERE s.user_id = ?
        GROUP BY s.session_id
        ORDER BY s.updated_at DESC
    """, (user_id,)).fetchall()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/sessions/<session_id>/messages', methods=['GET'])
def list_session_messages(session_id):
    db = get_db()
    rows = db.execute("""
        SELECT m.id, m.role, m.content, m.created_at
        FROM messages m
        WHERE m.session_id = ?
        ORDER BY m.created_at ASC
    """, (session_id,)).fetchall()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/logs', methods=['GET'])
def list_admin_logs():
    limit = request.args.get('limit', 50, type=int)
    limit = max(1, min(limit, 200))
    db = get_db()
    rows = db.execute("""
        SELECT l.id, l.action, l.detail, l.created_at,
               a.username AS admin_name,
               t.username AS target_name
        FROM admin_logs l
        LEFT JOIN users a ON l.admin_id = a.id
        LEFT JOIN users t ON l.target_id = t.id
        ORDER BY l.created_at DESC
        LIMIT ?
    """, (limit,)).fetchall()
    return jsonify([dict(r) for r in rows])