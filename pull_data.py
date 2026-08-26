#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
A股复盘数据拉取脚本
= 数据源迁移说明 (2026-08-26) =
  原依赖 westock-data/westock-tool 本地 node 脚本 (E:/workbuddy/.../builtin-skills/.../scripts/index.js)，
  该目录已随 westock 迁移为 MCP 连接器而不复存在，导致旧脚本拉取全部失败。
  现改为：新浪 hq.sinajs.cn 直连 + akshare(新浪系) + 东财资讯接口。
  同时禁用系统代理(Clash 127.0.0.1:7897 未运行会阻断所有 requests 请求)。
数据契约保持 data.json 字段结构 100% 兼容前端 (index.html/script.js)。
"""
import json
import os
import urllib.request
from datetime import datetime

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')

# ---------------------------------------------------------------------------
# 1) 禁用失效的系统代理 (Clash 127.0.0.1:7897 未运行 -> 所有 requests 都会被阻断)
#    - 清空代理环境变量
#    - 清理 requests 从 Windows 注册表读到的系统代理
# ---------------------------------------------------------------------------
def _disable_proxy():
    for k in ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
              'all_proxy', 'ALL_PROXY']:
        os.environ.pop(k, None)
    os.environ['NO_PROXY'] = '*'
    try:
        import requests
        _orig = requests.sessions.Session.request

        def _patched(self, *args, **kwargs):
            # 强制直连，忽略环境/注册表代理
            kwargs.setdefault('proxies', {'http': None, 'https': None})
            return _orig(self, *args, **kwargs)

        requests.sessions.Session.request = _patched
    except Exception:
        pass


_disable_proxy()

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'


def _sina_quotes(codes):
    """新浪 hq.sinajs.cn 批量行情直连，返回 {code: [字段...]}"""
    url = 'https://hq.sinajs.cn/list=' + ','.join(codes)
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Referer': 'https://finance.sina.com.cn'})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        raw = resp.read().decode('gbk', 'ignore')
    except Exception as e:
        print(f'  [WARN] 新浪行情失败: {e}')
        return {}
    out = {}
    for line in raw.splitlines():
        if '="' not in line:
            continue
        # 形如: var hq_str_sh000001="名称,今开,昨收,...";
        prefix, _, payload = line.partition('="')
        code = prefix.split('_str_')[-1]
        payload = payload.rstrip('";')
        out[code] = payload.split(',')
    return out


# A股指数: 名称,今开,昨收,现价,最高,最低,... 时间,日期
def fetch_a_index(result):
    codes = ['sh000001', 'sz399001', 'sz399006']
    names = {'sh000001': '上证指数', 'sz399001': '深证成指', 'sz399006': '创业板指'}
    q = _sina_quotes(codes)
    result['aIndex'] = []
    for c in codes:
        f = q.get(c)
        if not f or len(f) < 6 or not f[3]:
            continue
        try:
            price = float(f[3])
            prev = float(f[2])
        except (ValueError, IndexError):
            continue
        change = price - prev
        pct = round(change / prev * 100, 2) if prev else 0.0
        result['aIndex'].append({
            'code': c, 'name': names[c], 'price': price,
            'prev_close': prev, 'change': round(change, 2),
            'change_percent': pct,
            'time': f[30] if len(f) > 30 else datetime.now().strftime('%Y-%m-%d'),
        })
    print(f'  -> aIndex {len(result["aIndex"])}条')


# 涨跌分布 (新浪乐咕) + 分档分布 (基于个股行情统计会太重, 这里用乐咕总数 + 推定分档留空)
def fetch_market_breadth(result):
    try:
        import akshare as ak
        df = ak.stock_market_activity_legu()
        mp = dict(zip(df['item'], df['value']))
        def g(k):
            v = mp.get(k, 0)
            try:
                return int(float(v))
            except (ValueError, TypeError):
                return 0
        up = g('上涨')
        down = g('下跌')
        flat = g('平盘')
        # 乐咕返回"涨停"/"跌停"若无则用 0
        result['marketBreadth'] = {
            'up': up, 'down': down, 'flat': flat,
            'limitUp': g('涨停'), 'limitDown': g('跌停'),
            'upRatio': round(up / (up + down + flat) * 100, 2) if (up + down + flat) else 0,
            'totalAmount': 0, 'amountChange': 0,
            'distribution': [],  # 分档明细无公开稳定新浪源，留空供前端兜底
        }
        print(f'  -> marketBreadth 上涨{up} 下跌{down} 平{flat}')
    except Exception as e:
        print(f'  [WARN] 涨跌分布失败: {e}')


# 主力资金 TOP10 (新浪 stock_fund_flow_individual)
# 注意：新浪该接口"净额"列为字符串(如 "9987.90万")，需解析单位换算为"元"
def _parse_amount(s):
    """把 '9987.90万' / '1.23亿' 转成元(float)"""
    if s is None:
        return 0.0
    s = str(s).strip()
    mult = 1.0
    if s.endswith('亿'):
        mult, s = 1e8, s[:-1]
    elif s.endswith('万'):
        mult, s = 1e4, s[:-1]
    try:
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


def _parse_pct(s):
    """把 '2.22%' 转成 float"""
    if s is None:
        return 0.0
    s = str(s).strip().replace('%', '')
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def fetch_fund_flow_top10(result):
    try:
        import akshare as ak
        df = ak.stock_fund_flow_individual(symbol='即时')
        if df is None or df.empty:
            print('  [WARN] 主力资金: 空数据')
            return
        # 解析净额为数值，再排序
        df = df.copy()
        df['_net'] = df['净额'].apply(_parse_amount)
        df = df.dropna(subset=['_net']).sort_values('_net', ascending=False).head(10)
        result['fundFlowTop10'] = [
            {
                'code': str(int(x['股票代码'])).zfill(6),
                'name': x['股票简称'],
                'mainNetIn': round(float(x['_net']), 0),
                'price': float(x['最新价']),
                'change_percent': _parse_pct(x['涨跌幅']),
            }
            for _, x in df.iterrows()
        ]
        print(f'  -> fundFlowTop10 {len(result["fundFlowTop10"])}条')
    except Exception as e:
        print(f'  [WARN] 主力资金失败: {e}')


# 板块排行 (新浪行业) -> 映射 sectorTopGainers / sectorConceptGainers / sectorFlowIn
def fetch_sectors(result):
    try:
        import akshare as ak
        df = ak.stock_sector_spot(indicator='新浪行业')
        # 按涨跌幅排序
        df = df.copy()
        df['涨跌幅'] = df['涨跌幅'].astype(float)
        top = df.sort_values('涨跌幅', ascending=False).head(6)
        result['sectorTopGainers'] = top.apply(lambda r: {
            'name': r['板块'],
            'changePct': str(round(float(r['涨跌幅']), 2)),
            'turnoverRate': '',
            'changePct5d': '', 'changePct20d': '',
            'leadStock': f"{r['股票名称']}({round(float(r['个股-涨跌幅']), 2)})",
        }, axis=1).tolist()
        # 概念涨幅：新浪行业无独立概念口径，复用行业数据（保证字段存在）
        result['sectorConceptGainers'] = result['sectorTopGainers'][:6]
        # 资金流入 TOP3：用总成交额近似排序（新浪行业无主力净流入字段）
        df['总成交额'] = df['总成交额'].astype(float)
        flow = df.sort_values('总成交额', ascending=False).head(3)
        result['sectorFlowIn'] = flow.apply(lambda r: {
            'name': r['板块'],
            'changePct': str(round(float(r['涨跌幅']), 2)),
            'mainNetInflow': '',
            'mainNetInflow5d': '',
            'upDownRatio': '',
        }, axis=1).tolist()
        print(f'  -> sectorTopGainers {len(result["sectorTopGainers"])}条 | sectorFlowIn {len(result["sectorFlowIn"])}条')
    except Exception as e:
        print(f'  [WARN] 板块排行失败: {e}')


# 美股指数 (新浪 index_us_stock_sina) — 含费城半导体
def fetch_us_index(result):
    result['usIndex'] = []
    syms = {
        '.DJI': ('usDJI', '道琼斯工业'),
        '.IXIC': ('usIXIC', '纳斯达克'),
        '.INX': ('usINX', '标普500'),
        '.NDX': ('usNDX', '纳斯达克100'),
        '.SOX': ('usSOX', '费城半导体SOX'),
    }
    try:
        import akshare as ak
        for sina_sym, (code, name) in syms.items():
            try:
                df = ak.index_us_stock_sina(symbol=sina_sym)
                last = df.iloc[-1]
                prev = df.iloc[-2] if len(df) > 1 else last
                close = float(last['close'])
                prev_close = float(prev['close'])
                pct = round((close - prev_close) / prev_close * 100, 2) if prev_close else 0.0
                result['usIndex'].append({
                    'code': code, 'name': name, 'price': round(close, 2),
                    'change_percent': pct,
                    'time': str(last.get('date', ''))[:10],
                })
            except Exception:
                continue
        print(f'  -> usIndex {len(result["usIndex"])}条')
    except Exception as e:
        print(f'  [WARN] 美股指数失败: {e}')


# 七姐妹 (新浪 gb_ 前缀)
def fetch_magnificent7(result):
    m7 = {
        'gb_aapl': ('usAAPL.OQ', '苹果'), 'gb_msft': ('usMSFT.OQ', '微软'),
        'gb_nvda': ('usNVDA.OQ', '英伟达'), 'gb_googl': ('usGOOGL.OQ', '谷歌'),
        'gb_amzn': ('usAMZN.OQ', '亚马逊'), 'gb_meta': ('usMETA.OQ', 'Meta'),
        'gb_tsla': ('usTSLA.OQ', '特斯拉'),
    }
    q = _sina_quotes(list(m7.keys()))
    result['magnificent7'] = []
    for c, (code, name) in m7.items():
        f = q.get(c)
        if not f or len(f) < 2 or not f[1]:
            continue
        try:
            price = float(f[1])
            pct = float(f[2]) if len(f) > 2 and f[2] else 0.0
        except (ValueError, IndexError):
            continue
        result['magnificent7'].append({
            'code': code, 'name': name, 'price': price, 'change_percent': pct,
        })
    print(f'  -> magnificent7 {len(result["magnificent7"])}条')


# 芯片股 (美股 gb_ 前缀 + A股芯片) — 韩股无稳定免费源
def fetch_chip_stocks(result):
    us_chips = {'gb_mu': ('usMU.OQ', '美光科技'), 'gb_sndk': ('usSNDK.OQ', '闪迪')}
    a_chips = {'sh688981': ('688981', '中芯国际'), 'sh688008': ('688008', '澜起科技'),
               'sh688256': ('688256', '寒武纪')}
    q = _sina_quotes(list(us_chips.keys()) + list(a_chips.keys()))
    result['chipStocks'] = []
    for c, (code, name) in us_chips.items():
        f = q.get(c)
        if not f or len(f) < 2 or not f[1]:
            continue
        try:
            price = float(f[1])
            pct = float(f[2]) if len(f) > 2 and f[2] else 0.0
        except (ValueError, IndexError):
            continue
        result['chipStocks'].append({
            'code': code, 'name': name, 'price': price, 'change_percent': round(pct, 2), 'market': 'us',
        })
    for c, (code, name) in a_chips.items():
        f = q.get(c)
        if not f or len(f) < 4 or not f[3]:
            continue
        try:
            price = float(f[3])
            prev = float(f[2])
            pct = round((price - prev) / prev * 100, 2) if prev else 0.0
        except (ValueError, IndexError):
            continue
        result['chipStocks'].append({
            'code': code, 'name': name, 'price': price, 'change_percent': pct, 'market': 'cn',
        })
    print(f'  -> chipStocks {len(result["chipStocks"])}条')


# 资讯 (东财 stock_info_global_em, 该域名未被阻断)
# 列: 标题/摘要/发布时间/链接
def fetch_news(result):
    try:
        import akshare as ak
        import time as _time
        df = ak.stock_info_global_em()
        items = []
        for _, r in df.head(10).iterrows():
            title = str(r.get('标题', ''))
            if not title:
                continue
            # 发布时间 -> unix 秒时间戳
            ts = 0
            pub = str(r.get('发布时间', ''))
            if pub:
                try:
                    ts = int(_time.mktime(_time.strptime(pub.strip(), '%Y-%m-%d %H:%M:%S')))
                except (ValueError, OverflowError):
                    ts = 0
            items.append({
                'news_id': str(r.get('链接', ''))[-20:],
                'news_title': title,
                'rank': str(len(items) + 1),
                'publish_time': ts,
                'source': '东方财富',
            })
        result['news'] = items
        print(f'  -> news {len(result["news"])}条')
    except Exception as e:
        print(f'  [WARN] 资讯失败: {e}')


def main():
    result = {
        '_updated': datetime.now().isoformat(),
        '_date': datetime.now().strftime('%Y/%m/%d'),
    }
    print('[1/7] A股指数...')
    fetch_a_index(result)
    print('[2/7] 涨跌分布...')
    fetch_market_breadth(result)
    print('[3/7] 主力资金TOP10...')
    fetch_fund_flow_top10(result)
    print('[4/7] 板块排行...')
    fetch_sectors(result)
    print('[5/7] 美股指数...')
    fetch_us_index(result)
    print('[5.5/7] 美股七姐妹...')
    fetch_magnificent7(result)
    print('[6/7] 芯片股...')
    fetch_chip_stocks(result)
    print('[7/7] 资讯...')
    fetch_news(result)

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'\nDone -> {OUT}')
    for k in ['aIndex', 'marketBreadth', 'fundFlowTop10', 'sectorTopGainers',
              'sectorConceptGainers', 'sectorFlowIn', 'usIndex', 'magnificent7',
              'chipStocks', 'news']:
        v = result.get(k)
        n = len(v) if isinstance(v, (list, dict)) else (1 if v else 0)
        print(f'  {k}: {n}条')


if __name__ == '__main__':
    main()
