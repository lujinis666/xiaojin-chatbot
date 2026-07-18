from flask import Blueprint, request, jsonify, session
from database import get_db, get_setting
from werkzeug.security import generate_password_hash, check_password_hash

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/api/auth/me', methods=['GET'])
def get_me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'authenticated': False})
    db = get_db()
    user = db.execute("SELECT id, username, role, avatar, is_banned FROM users WHERE id=?", (user_id,)).fetchone()
    if not user or user['is_banned']:
        session.clear()
        return jsonify({'authenticated': False, 'error': '账号已被封禁' if user else '未登录'})
    return jsonify({
        'authenticated': True,
        'id': user['id'],
        'username': user['username'],
        'role': user['role'],
        'avatar': user['avatar']
    })

@auth_bp.route('/api/auth/profile', methods=['PUT'])
def update_profile():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': '未登录'}), 401
        
    if request.is_json:
        new_username = (request.json.get('username') or '').strip()
    else:
        new_username = request.form.get('username', '').strip()
    
    if not new_username:
        return jsonify({'error': '用户名不能为空'}), 400
        
    db = get_db()
    with db:
        existing = db.execute("SELECT id FROM users WHERE username=? AND id!=?", (new_username, user_id)).fetchone()
        if existing:
            return jsonify({'error': '用户名已被占用'}), 400
            
        db.execute("UPDATE users SET username=? WHERE id=?", (new_username, user_id))
        
    return jsonify({'success': True})

@auth_bp.route('/api/auth/register-config', methods=['GET'])
def register_config():
    """前端用来判断注册时是否需要邀请码"""
    db = get_db()
    require = get_setting(db, 'require_invite_code', '1')
    return jsonify({'require_invite_code': require == '1'})


@auth_bp.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    invite_code = data.get('invite_code', '').strip()

    db = get_db()
    require_invite = get_setting(db, 'require_invite_code', '1') == '1'

    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400

    if require_invite and not invite_code:
        return jsonify({'error': '邀请码不能为空'}), 400

    with db:
        # 需要邀请码时校验
        invite = None
        if require_invite:
            invite = db.execute("SELECT * FROM invite_codes WHERE code=?", (invite_code,)).fetchone()
            if not invite:
                return jsonify({'error': '无效的邀请码'}), 400
            if invite['is_used'] == 1:
                return jsonify({'error': '该邀请码已被使用'}), 400
        
        # 校验用户名
        existing_user = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if existing_user:
            return jsonify({'error': '用户名已被占用'}), 400
        
        # 创建用户
        hashed_pwd = generate_password_hash(password)
        cursor = db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hashed_pwd)
        )
        user_id = cursor.lastrowid
        
        # 标记邀请码已使用（仅在需要邀请码时）
        if require_invite and invite:
            db.execute(
                "UPDATE invite_codes SET is_used=1, used_by=?, used_at=CURRENT_TIMESTAMP WHERE id=?",
                (user_id, invite['id'])
            )
    
    # 自动登录
    session['user_id'] = user_id
    session.permanent = True
    return jsonify({'ok': True, 'message': '注册成功'})

@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': '用户名或密码错误'}), 401
    if user['is_banned']:
        return jsonify({'error': '账号已被封禁，请联系管理员'}), 403
    
    session['user_id'] = user['id']
    session.permanent = True
    return jsonify({'ok': True, 'message': '登录成功'})

@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True, 'message': '已登出'})

@auth_bp.route('/api/auth/password', methods=['PUT'])
def change_password():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': '未登录'}), 401
        
    data = request.json or {}
    old_password = data.get('old_password', '')
    new_password = data.get('new_password', '')
    
    if not old_password or not new_password:
        return jsonify({'error': '密码不能为空'}), 400
        
    db = get_db()
    with db:
        user = db.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
        if not user or not check_password_hash(user['password_hash'], old_password):
            return jsonify({'error': '原密码错误'}), 400
            
        hashed_pwd = generate_password_hash(new_password)
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hashed_pwd, user_id))
        
    return jsonify({'ok': True, 'message': '密码修改成功'})
