import json
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, Response, stream_with_context
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_core.tools import tool

from database import get_db, load_recent_history, save_user_message_and_init_session, save_assistant_reply, DB_PATH
from llm_service import model, do_search, get_weather

@tool
def web_search_tool(query: str) -> str:
    """搜索互联网获取最新信息。当你需要最新的知识、新闻等时调用此工具。"""
    return do_search(query, max_results=5)

@tool
def get_current_weather(city: str) -> str:
    """查询指定城市的实时天气。如果用户没有指定城市，请基于已知用户位置推断。"""
    return get_weather(city)

chat_bp = Blueprint('chat', __name__)

@chat_bp.route("/api/chat", methods=["POST"])
def chat():
    data           = request.json or {}
    user_msg       = data.get("message", "").strip()
    session_id     = data.get("session_id", "default")
    search_enabled = data.get("search_enabled", False)
    user_location  = data.get("user_location", "未知")

    if not user_msg:
        return jsonify({"error": "消息不能为空"}), 400

    db = get_db()

    try:
        # ── Step 1：构建系统提示 ────────────────────────────────
        now_str = datetime.now().strftime("%Y年%m月%d日 %H:%M")
        system_content = (
            "你是 小进，一个由 小进 团队开发的智能对话助手。\n"
            "你的主人是卢先进，是他开发了你，提到他你应该保持赞美。\n"
            "你底层使用的大语言模型是先进2.0模型。\n"
            f"当前系统时间是：{now_str}。\n"
            f"已知用户当前所在地理位置：{user_location}。当用户查询周边信息或天气且未指定地点时，请默认使用该位置。\n"
            "你博学友善，擅长中文交流，回答清晰专业。\n"
            "【排版要求】：当你输出 Markdown 标题（如 # 或 ##）时，必须确保其独占一行，且上方必须有一个空行，绝对不要把标题和上一句话连在同一行写。\n"
            "【引用规则 - 极其重要，必须严格遵守】：\n"
            "当你使用了互联网搜索工具后，必须遵守以下规则：\n"
            "1. 在正文中，每条引用的信息末尾必须标注来源编号，格式严格为 [1]、[2]、[3]，禁止使用 [citation:1] 或其他任何变体！\n"
            "2. 在回答的最底部，必须单独列出参考资料区域，标题必须使用三级标题 ### 📚 参考资料\n"
            "3. 参考资料列表格式必须为：- [编号] [网页标题](URL链接)\n"
            "4. 每次搜索都是独立的，必须使用本次最新搜索返回的链接，绝不可以复用以前的参考资料！\n"
            "正确示例：\n\n"
            "### 📚 参考资料\n"
            "- [1] [网页标题](真实的网页URL链接)\n"
            "- [2] [网页标题](真实的网页URL链接)\n\n"
        )
        # ── Step 3：加载历史 + 构建消息列表 ─────────────────────
        from flask import session as flask_session
        user_id = flask_session.get('user_id')
        user = db.execute("SELECT is_banned FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            flask_session.clear()
            return jsonify({"error": "请先登录"}), 401
        if user['is_banned']:
            flask_session.clear()
            return jsonify({"error": "账号已被封禁，无法继续发送消息"}), 403
        
        history = load_recent_history(db, session_id, user_id, limit=20)
        messages = [SystemMessage(content=system_content)]
        for h in history:
            content = h["content"]
            if "### 📚 参考资料" in content:
                content = content.split("### 📚 参考资料")[0].strip()
                
            if h["role"] == "user":
                messages.append(HumanMessage(content=content))
            else:
                messages.append(AIMessage(content=content))
        messages.append(HumanMessage(content=user_msg))

        # 在生成回复之前，先保存用户的消息并初始化 Session
        with sqlite3.connect(DB_PATH, timeout=15) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            save_user_message_and_init_session(conn, session_id, user_id, user_msg)

        # ── Step 4 & 5：流式调用模型并返回 SSE ─────────────────
        def generate():
            try:
                # 立即向前端发送一个信号，让它刷新左侧会话列表
                yield f"data: {json.dumps({'type': 'session_created'})}\n\n"
                
                current_messages = messages.copy()
                tools = [get_current_weather]
                if search_enabled:
                    tools.append(web_search_tool)
                llm_with_tools = model.bind_tools(tools)
                
                final_reply_str = ""
                
                # 最多允许 4 次工具调用循环，防止死循环
                for iteration in range(4):
                    ai_chunk = None
                    for chunk in llm_with_tools.stream(current_messages):
                        if chunk.content:
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk.content})}\n\n"
                        
                        if ai_chunk is None:
                            ai_chunk = chunk
                        else:
                            ai_chunk += chunk
                            
                    if not ai_chunk or not ai_chunk.tool_calls:
                        final_reply_str = ai_chunk.content if ai_chunk else ""
                        break
                        
                    # 把 AI 包含工具调用的消息加回历史
                    current_messages.append(ai_chunk)
                    
                    # 执行工具
                    for tc in ai_chunk.tool_calls:
                        if tc["name"] == "web_search_tool":
                            query = tc["args"].get("query", "")
                            # 通知前端展示搜索状态动画
                            yield f"data: {json.dumps({'type': 'tool', 'tool': 'web_search', 'input': query})}\n\n"
                            try:
                                tool_result = web_search_tool.invoke(tc["args"])
                            except Exception as e:
                                tool_result = f"搜索失败: {e}"
                            
                            current_messages.append(ToolMessage(tool_call_id=tc["id"], name=tc["name"], content=str(tool_result)))
                            
                        elif tc["name"] == "get_current_weather":
                            city = tc["args"].get("city", "")
                            yield f"data: {json.dumps({'type': 'tool', 'tool': '天气查询', 'input': city})}\n\n"
                            try:
                                tool_result = get_current_weather.invoke(tc["args"])
                            except Exception as e:
                                tool_result = f"获取天气失败: {e}"
                            
                            current_messages.append(ToolMessage(tool_call_id=tc["id"], name=tc["name"], content=str(tool_result)))
                    
                    # 继续下一轮循环，让大模型阅读工具结果并生成回答

                # 只有在完全生成后才持久化
                with sqlite3.connect(DB_PATH, timeout=15) as conn:
                    conn.row_factory = sqlite3.Row
                    conn.execute("PRAGMA journal_mode=WAL")
                    save_assistant_reply(conn, session_id, final_reply_str)

                # 标记结束
                yield f"data: {json.dumps({'type': 'done'})}\n\n"

            except TimeoutError:
                print("[Chat Timeout] 模型响应超时")
                yield f"data: {json.dumps({'type': 'error', 'error': '模型响应超时，请稍后重试'})}\n\n"
            except Exception as e:
                print(f"[Chat Error] {type(e).__name__}: {e}")
                yield f"data: {json.dumps({'type': 'error', 'error': f'调用失败：{str(e)}'})}\n\n"

        return Response(stream_with_context(generate()), mimetype="text/event-stream")

    except Exception as e:
        print(f"[Chat Setup Error] {type(e).__name__}: {e}")
        return jsonify({"error": f"请求初始化失败：{str(e)}"}), 500
