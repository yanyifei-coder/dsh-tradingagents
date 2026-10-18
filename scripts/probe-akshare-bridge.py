"""AkShare 桥端到端探针：真实拉起桥进程，走 ready → ping → 白名单接口 → 白名单拒绝 四步。

运行（需能读取 akshare 安装处）：
    python scripts/probe-akshare-bridge.py [--python PATH]
结论进 DESIGN §7.1。
"""
import json
import subprocess
import sys
import threading
from pathlib import Path

READY_TIMEOUT = 120.0  # akshare 首次导入较慢
CALL_TIMEOUT = 60.0


def main() -> int:
    python = sys.argv[sys.argv.index("--python") + 1] if "--python" in sys.argv else sys.executable
    script = Path(__file__).resolve().parent.parent / "bridge" / "akshare_bridge.py"
    proc = subprocess.Popen(
        [python, str(script)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    assert proc.stdin is not None and proc.stdout is not None

    def reader(sink):
        for line in proc.stdout:
            sink.append(line.rstrip("\n"))

    lines: list[str] = []
    thread = threading.Thread(target=reader, args=(lines,), daemon=True)
    thread.start()

    def read_line(timeout):
        done = threading.Event()
        result = {}

        def wait():
            while not lines:
                if proc.poll() is not None:
                    result["value"] = None
                    done.set()
                    return
            result["value"] = lines.pop(0)
            done.set()

        threading.Thread(target=wait, daemon=True).start()
        if not done.wait(timeout):
            return None
        return result.get("value")

    def send(payload):
        proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    failures = 0

    ready = read_line(READY_TIMEOUT)
    if ready is None:
        print("FAIL  ready: 桥进程未输出就绪消息")
        proc.kill()
        return 1
    ready_msg = json.loads(ready)
    ok = ready_msg.get("id") == "__ready__" and ready_msg.get("ok") is True
    print(("OK    " if ok else "FAIL  ") + f"ready: version={ready_msg.get('version')} available={ready_msg.get('available')}")
    failures += 0 if ok else 1

    send({"id": "p1", "fn": "ping", "params": {}})
    pong = json.loads(read_line(CALL_TIMEOUT))
    ok = pong.get("id") == "p1" and pong.get("ok") is True
    print(("OK    " if ok else "FAIL  ") + "ping")
    failures += 0 if ok else 1

    send({"id": "f1", "fn": "stock_financial_analysis_indicator", "params": {"symbol": "600519", "start_year": "2024"}})
    fin = json.loads(read_line(CALL_TIMEOUT))
    ok = fin.get("ok") is True and fin.get("rowCount", 0) > 0
    sample = json.dumps(fin.get("records", [{}])[-1], ensure_ascii=False)[:110] if ok else fin.get("error")
    print(("OK    " if ok else "FAIL  ") + f"财务指标 600519: rowCount={fin.get('rowCount')} 末行={sample}")
    failures += 0 if ok else 1

    send({"id": "r1", "fn": "stock_financial_report_sina", "params": {"stock": "sh600519", "symbol": "利润表"}})
    rep = json.loads(read_line(CALL_TIMEOUT))
    ok = rep.get("ok") is True and rep.get("rowCount", 0) > 0
    sample = json.dumps(rep.get("records", [{}])[-1], ensure_ascii=False)[:110] if ok else rep.get("error")
    print(("OK    " if ok else "FAIL  ") + f"利润表 sh600519: rowCount={rep.get('rowCount')} 末行={sample}")
    failures += 0 if ok else 1

    send({"id": "x1", "fn": "stock_zh_a_hist", "params": {}})
    denied = json.loads(read_line(CALL_TIMEOUT))
    ok = denied.get("ok") is False and "白名单" in denied.get("error", "")
    print(("OK    " if ok else "FAIL  ") + f"白名单拒绝: {denied.get('error')}")
    failures += 0 if ok else 1

    proc.kill()
    print(f"===== 桥 e2e 结束：失败 {failures} 项 =====")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
