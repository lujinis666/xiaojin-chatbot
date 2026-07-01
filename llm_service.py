import os
import io
import requests
import re as _re
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

load_dotenv()

# ── 模型初始化 ───────────────────────────────────────────────
base_url   = os.getenv("LONGCAT_BASE_URL")
api_key    = os.getenv("LONGCAT_API_KEY")
model_name = os.getenv("LONGCAT_MODEL_NAME", "LongCat-2.0")

model = init_chat_model(
    model=model_name,
    model_provider="openai",
    base_url=base_url,
    api_key=api_key,
    timeout=90,       # 请求超时90秒则报错，避免永久挂起
    max_retries=0,    # 不重试，失败就失败
)

def do_search(query: str, max_results: int = 5) -> str:
    try:
        from ddgs import DDGS
        
        # 针对时效性词汇自动限制搜索范围为最近一个月（'m'）或最近一年（'y'）
        timelimit = None
        if any(w in query.lower() for w in ["最新", "今天", "最近", "新闻", "news", "latest"]):
            timelimit = "m"
            
        with DDGS() as ddgs:
            results = list(ddgs.text(query, timelimit=timelimit, max_results=max_results))
        if not results:
            return "搜索完毕，但未找到相关结果。请直接告知用户当前网络搜索未找到信息，不要捏造参考资料。"
        parts = []
        for i, r in enumerate(results, 1):
            title = r.get('title', '')
            href = r.get('href', '')
            body = r.get('body', '')
            parts.append(f"[{i}] [{title}]({href})\n{body}")
        return "\n\n".join(parts)
    except Exception as e:
        import traceback
        print(f"[Search Error] {e}")
        traceback.print_exc()
        return f"搜索失败: 无法获取信息 ({e})。请直接告诉用户网络搜索出现故障，无法提供最新链接。"

def get_weather(city: str) -> str:
    """查询指定城市的天气"""
    try:
        # format=j1 返回 JSON 数据
        url = f"https://wttr.in/{city}?format=j1"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            # 简单提取有用的天气信息
            current = data.get("current_condition", [{}])[0]
            temp = current.get("temp_C", "")
            desc = current.get("lang_zh", [{}])[0].get("value", current.get("weatherDesc", [{}])[0].get("value", ""))
            return f"{city} 当前天气：{desc}，气温：{temp}℃"
        return "无法获取天气信息，服务异常。"
    except Exception as e:
        return f"获取天气失败: {e}"

def markdown_to_docx(content: str) -> io.BytesIO:
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(11)

    def add_inline(para, text: str):
        tokens = _re.split(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)', text)
        for t in tokens:
            if t.startswith("**") and t.endswith("**"):
                doc_run = para.add_run(t[2:-2]); doc_run.bold = True
            elif t.startswith("*") and t.endswith("*"):
                doc_run = para.add_run(t[1:-1]); doc_run.italic = True
            elif t.startswith("`") and t.endswith("`"):
                doc_run = para.add_run(t[1:-1])
                doc_run.font.name = "Courier New"
                doc_run.font.color.rgb = RGBColor(0xD9, 0x48, 0x00)
            else:
                para.add_run(t)

    lines = content.split("\n")
    in_code, code_lines = False, []
    for line in lines:
        if line.strip().startswith("```"):
            if not in_code:
                in_code = True; code_lines = []
            else:
                in_code = False
                for cl in code_lines:
                    p = doc.add_paragraph(style="No Spacing")
                    run = p.add_run(cl)
                    run.font.name = "Courier New"; run.font.size = Pt(9.5)
                    run.font.color.rgb = RGBColor(0x2D, 0x74, 0xDA)
                    p.paragraph_format.left_indent = Inches(0.3)
            continue
        if in_code:
            code_lines.append(line); continue

        if   line.startswith("#### "): doc.add_heading(line[5:], level=4)
        elif line.startswith("### "):  doc.add_heading(line[4:], level=3)
        elif line.startswith("## "):   doc.add_heading(line[3:], level=2)
        elif line.startswith("# "):    doc.add_heading(line[2:], level=1)
        elif line.startswith("- ") or line.startswith("* "):
            p = doc.add_paragraph(style="List Bullet"); add_inline(p, line[2:])
        elif _re.match(r"^\d+\. ", line):
            p = doc.add_paragraph(style="List Number")
            add_inline(p, _re.sub(r"^\d+\. ", "", line))
        elif line.strip() in ("---", "***", "___"):
            p = doc.add_paragraph()
            pPr = p._p.get_or_add_pPr()
            pBdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single"); bottom.set(qn("w:sz"), "6")
            bottom.set(qn("w:space"), "1"); bottom.set(qn("w:color"), "CCCCCC")
            pBdr.append(bottom); pPr.append(pBdr)
        elif line.strip() == "":
            doc.add_paragraph("")
        else:
            p = doc.add_paragraph(); add_inline(p, line)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
