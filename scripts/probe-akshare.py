"""AkShare 可用性探针：验证关键接口在当前环境的连通性（结论进 DESIGN §7.1）。

运行：PYTHONPATH=.pylibs python scripts/probe-akshare.py
接口选取原则：覆盖腾讯源（已知可达）、东财源（已知不可达）、新浪源的美股/港股，
用于判定"AkShare 桥"在大陆部署环境下的真实价值边界。
"""
import sys

import akshare as ak

sys.stdout.reconfigure(encoding="utf-8")


def probe(label, fn):
    try:
        df = fn()
        print(f"OK    {label}: {len(df)} 行")
        tail = df.tail(2).to_string().replace("\n", "\n      ")
        print(f"      {tail}")
    except Exception as error:  # 探针逐接口打印失败，不中断其余接口
        print(f"FAIL  {label}: {type(error).__name__}: {error}")


probe(
    "stock_zh_a_hist_tx 腾讯源 sh600519",
    lambda: ak.stock_zh_a_hist_tx(symbol="sh600519", start_date="20260901", end_date="20261002"),
)
probe(
    "stock_zh_a_hist 东财源 600519",
    lambda: ak.stock_zh_a_hist(symbol="600519", period="daily", start_date="20260901", end_date="20261002", adjust="qfq"),
)
probe(
    "stock_us_daily 美股 NVDA（新浪源）",
    lambda: ak.stock_us_daily(symbol="NVDA"),
)
probe(
    "stock_hk_daily 港股 00700",
    lambda: ak.stock_hk_daily(symbol="00700"),
)
