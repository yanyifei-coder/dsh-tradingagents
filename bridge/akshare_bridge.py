"""AkShare stdio JSON 桥（最小协议 v0.1）。

协议（JSONL over stdio，UTF-8）：
1. 启动后完成 akshare 慢导入，写一行 ready 消息：
   {"id":"__ready__","ok":true,"version":"1.19.1","available":["fn",...]}
2. 之后逐行读取请求 {"id":"...","fn":"接口名","params":{...}}，顺序执行，逐行写响应：
   {"id":"...","ok":true,"records":[{...}],"rowCount":N}
   {"id":"...","ok":false,"error":"..."}

安全边界：接口白名单（本文件的 ALLOWLIST）；白名单外一律拒绝。
运行：python bridge/akshare_bridge.py（PYTHONPATH 指向 akshare 安装处）。
"""
import json
import sys

# 新浪系接口（CN 部署环境实测可达，见 DESIGN §7.1）；键为 akshare 函数名。
ALLOWLIST = {
    "stock_financial_analysis_indicator": "新浪财经-财务分析-财务指标",
    "stock_financial_report_sina": "新浪财经-财务报表-三大报表",
    "stock_financial_abstract": "新浪财经-财务摘要",
}


def emit(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def dataframe_to_records(df):
    """DataFrame → JSON records（numpy 标量/NaT/NaN 经 to_json 归一为原生类型与 null）。"""
    return json.loads(df.to_json(orient="records", force_ascii=False))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except AttributeError:
        # 旧版 Python 无 reconfigure；桥要求 3.9+，此处容忍缺失。
        pass

    import pandas as pd

    import akshare as ak

    available = sorted(fn for fn in ALLOWLIST if hasattr(ak, fn))
    emit({"id": "__ready__", "ok": True, "version": ak.__version__, "available": available})

    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue
        try:
            request = json.loads(line)
            request_id = request["id"]
            fn = request["fn"]
            params = request.get("params") or {}
        except Exception as error:  # 坏行：无法知道 id，用 null 应答后继续服务
            emit({"id": None, "ok": False, "error": f"bad request line: {error}"})
            continue

        if fn == "ping":
            emit({"id": request_id, "ok": True, "records": [], "rowCount": 0})
            continue
        if fn not in ALLOWLIST:
            emit({"id": request_id, "ok": False, "error": f"接口不在白名单：{fn}"})
            continue
        if not hasattr(ak, fn):
            emit({"id": request_id, "ok": False, "error": f"当前 akshare 版本无此接口：{fn}"})
            continue

        try:
            df = getattr(ak, fn)(**params)
            if not isinstance(df, pd.DataFrame):
                emit({"id": request_id, "ok": False, "error": f"接口返回非 DataFrame：{type(df).__name__}"})
                continue
            records = dataframe_to_records(df)
            emit({"id": request_id, "ok": True, "records": records, "rowCount": len(records)})
        except Exception as error:  # 接口级失败不终止桥，逐请求应答
            emit({"id": request_id, "ok": False, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
