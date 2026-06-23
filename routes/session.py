from flask import Blueprint, request, jsonify, session as flask_session
from database import get_db

session_bp = Blueprint('session', __name__)

@session_bp.route("/api/sessions", methods=["GET"])
def list_sessions():
    user_id = flask_session.get('user_id')
    db = get_db()
    rows = db.execute(
        """SELECT s.session_id, s.title, s.created_at, s.updated_at, s.is_pinned,
                  COUNT(m.id) AS message_count
           FROM sessions s
           LEFT JOIN messages m ON s.session_id = m.session_id
           WHERE s.user_id = ?
           GROUP BY s.session_id
           ORDER BY s.is_pinned DESC, s.updated_at DESC
           LIMIT 100""", (user_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])

@session_bp.route("/api/sessions/<session_id>", methods=["PUT"])
def rename_session(session_id):
    user_id = flask_session.get('user_id')
    data  = request.json or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "标题不能为空"}), 400
    db = get_db()
    with db:
        db.execute(
            "UPDATE sessions SET title=? WHERE session_id=? AND user_id=?",
            (title[:50], session_id, user_id)
        )
    return jsonify({"ok": True})

@session_bp.route("/api/sessions/<session_id>/pin", methods=["POST"])
def toggle_pin(session_id):
    user_id = flask_session.get('user_id')
    data = request.json or {}
    is_pinned = int(data.get("is_pinned", 0))
    db = get_db()
    with db:
        db.execute(
            "UPDATE sessions SET is_pinned=? WHERE session_id=? AND user_id=?",
            (is_pinned, session_id, user_id)
        )
    return jsonify({"ok": True})

@session_bp.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    user_id = flask_session.get('user_id')
    db = get_db()
    with db:
        # 验证归属
        sess = db.execute("SELECT session_id FROM sessions WHERE session_id=? AND user_id=?", (session_id, user_id)).fetchone()
        if sess:
            db.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            db.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    return jsonify({"ok": True})

@session_bp.route("/api/sessions/<session_id>/messages", methods=["GET"])
def get_session_messages(session_id):
    user_id = flask_session.get('user_id')
    db = get_db()
    
    sess = db.execute("SELECT session_id FROM sessions WHERE session_id=? AND user_id=?", (session_id, user_id)).fetchone()
    if not sess:
        return jsonify([])
        
    rows = db.execute(
        """SELECT role, content, created_at
           FROM messages WHERE session_id=?
           ORDER BY created_at ASC""",
        (session_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])
