from flask import Blueprint, request, jsonify, send_file
from llm_service import markdown_to_docx

export_bp = Blueprint('export', __name__)

@export_bp.route("/api/export-docx", methods=["POST"])
def export_docx():
    try:
        import docx  # noqa
    except ImportError:
        return jsonify({"error": "请先安装 python-docx：uv add python-docx"}), 500

    data     = request.json or {}
    content  = data.get("content", "")
    filename = (data.get("filename", "") or "小进文档").strip()

    if not content:
        return jsonify({"error": "内容不能为空"}), 400

    try:
        buf = markdown_to_docx(content)
        return send_file(
            buf,
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            as_attachment=True,
            download_name=f"{filename}.docx",
        )
    except Exception as e:
        return jsonify({"error": f"文档生成失败：{str(e)}"}), 500
