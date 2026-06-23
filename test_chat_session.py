import json
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from routes.chat import web_search_tool
from llm_service import model

tools = [web_search_tool]
llm_with_tools = model.bind_tools(tools)

# Simulate Turn 1
messages = [
    SystemMessage(content="你是助手。"),
    HumanMessage(content="2026年5月新闻")
]
print("--- Turn 1 ---")
ai_chunk = None
for chunk in llm_with_tools.stream(messages):
    if ai_chunk is None:
        ai_chunk = chunk
    else:
        ai_chunk += chunk

print("T1 Tool calls:", ai_chunk.tool_calls)
for tc in ai_chunk.tool_calls:
    res = web_search_tool.invoke(tc["args"])
    print("T1 Tool Result:", res[:100], "...")

# Simulate saving history WITHOUT tool calls (just content)
t1_reply = "我找到了5月新闻。参考：..."

# Simulate Turn 2
messages = [
    SystemMessage(content="你是助手。"),
    HumanMessage(content="2026年5月新闻"),
    AIMessage(content=t1_reply),
    HumanMessage(content="那2026年6月新闻呢")
]
print("\n--- Turn 2 ---")
ai_chunk = None
for chunk in llm_with_tools.stream(messages):
    if ai_chunk is None:
        ai_chunk = chunk
    else:
        ai_chunk += chunk

print("T2 Tool calls:", ai_chunk.tool_calls)
for tc in ai_chunk.tool_calls:
    res = web_search_tool.invoke(tc["args"])
    print("T2 Tool Result:", res[:100], "...")
    messages.append(ai_chunk)
    messages.append(ToolMessage(tool_call_id=tc["id"], name=tc["name"], content=res))

print("--- Generating T2 Final Reply ---")
final_chunk = None
for chunk in llm_with_tools.stream(messages):
    if final_chunk is None:
        final_chunk = chunk
    else:
        final_chunk += chunk
print("T2 Final Reply:\n", final_chunk.content)
