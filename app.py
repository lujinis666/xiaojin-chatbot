from flask import Flask, render_template, send_from_directory
from dotenv import load_dotenv
import os
from datetime import timedelta

# 加载环境变量
load_dotenv()

# 初始化数据库结构
from database import init_db, close_db
init_db()

app = Flask(__name__)

# 确保有稳定的 secret_key，避免重启服务器导致 session 失效
secret_key = os.getenv("FLASK_SECRET_KEY")
if not secret_key:
    # 尝试从本地持久化密钥文件读取，确保密钥稳定
    secret_key_file = os.path.join(app.root_path, '.secret_key')
    if os.path.exists(secret_key_file):
        with open(secret_key_file, 'r', encoding='utf-8') as f:
            secret_key = f.read().strip()
    else:
        # 生成一个 48 字符的随机 Hex 密钥并保存
        import secrets
        secret_key = secrets.token_hex(24)
        try:
            with open(secret_key_file, 'w', encoding='utf-8') as f:
                f.write(secret_key)
        except Exception:
            pass
app.secret_key = secret_key

# 设置登录会话过期时间为 30 天
app.permanent_session_lifetime = timedelta(days=30)

# 注册数据库关闭回调
app.teardown_appcontext(close_db)

# 注册各个功能路由蓝图
from routes.session import session_bp
from routes.chat import chat_bp
from routes.export import export_bp
from routes.auth import auth_bp
from routes.admin import admin_bp

app.register_blueprint(session_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(export_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp)

from flask import request, session, jsonify, redirect
from database import get_db

@app.before_request
def check_auth():
    # 保护除了鉴权相关以外的所有 /api/ 路由
    if request.path.startswith('/api/') and not request.path.startswith('/api/auth/'):
        if 'user_id' not in session:
            return jsonify({'error': '请先登录'}), 401

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/admin")
def admin_page():
    user_id = session.get('user_id')
    if not user_id:
        return redirect('/')
    db = get_db()
    user = db.execute("SELECT role, is_banned FROM users WHERE id=?", (user_id,)).fetchone()
    if not user or user['role'] != 'admin' or user['is_banned']:
        return redirect('/')
    return render_template("admin.html")

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.png', mimetype='image/png')

import os

# ... 你的其他 Flask 代码 ...

if __name__ == '__main__':
    # 1. 优先读取平台分配的端口，如果读取不到（比如在本地运行）则默认用 5000
    port = int(os.environ.get("PORT", 8080))

    # 2. 必须把 host 改为 "0.0.0.0"，让外网网关可以访问
    app.run(host="0.0.0.0", port=port)