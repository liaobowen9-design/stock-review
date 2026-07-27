#!/usr/bin/env python
"""A股复盘数据拉取脚本 - 每次运行从westock-data/--raw拉取全量数据写入data.json"""
import json, subprocess, os

ND = 'C:/Users/31471/.workbuddy/binaries/node/versions/22.22.2/node.exe'
WD = 'E:/workbuddy/WorkBuddyAI/resources/app.asar.unpacked/resources/builtin-skills/westock-data/scripts/index.js'
WT = 'E:/workbuddy/WorkBuddyAI/resources/app.asar.unpacked/resources/builtin-skills/westock-tool/scripts/index.js'
OUT = os.path.join(os.path.dirname(__file__), 'data.json')

def run(*args):
    try:
        r = subprocess.run([ND, *args], capture_output=True, text=True, timeout=30)
        return r.stdout.strip()
    except Exception as e:
        print(f'  [WARN] {e}')
        return None

def parse_quotes(raw):
    """通用quote解析：兼容单股[{}]、批量{data:[{data:{}}]}、批量{data:[{}]}"""
    if not raw: return []
    d = json.loads(raw)
    items = []
    if isinstance(d, list):
        items = d
    elif isinstance(d, dict):
        data_list = d.get('data', [])
        if isinstance(data_list, list):
            for elem in data_list:
                if isinstance(elem, dict):
                    inner = elem.get('data', elem)  # 有嵌套data.data就取内层
                    if isinstance(inner, dict) and 'price' in inner:
                        items.append(inner)
    # 按symbol去重
    seen = set()
    result = []
    for x in items:
        sym = x.get('symbol') or x.get('code', '')
        if sym and sym not in seen:
            seen.add(sym)
            result.append(x)
    return result

result = {'_updated': '', '_date': ''}
from datetime import datetime
result['_updated'] = datetime.now().isoformat()
result['_date'] = datetime.now().strftime('%Y/%m/%d')

# 1. A股三大指数
print('[1/7] A股指数...')
raw = run(WD, 'quote', 'sh000001,sz399001,sz399006', '--raw')
if raw:
    items = parse_quotes(raw)
    result['aIndex'] = [
        {'code': x.get('symbol',''), 'name': x.get('name',''), 'price': x.get('price'),
         'prev_close': x.get('prev_close'), 'change': x.get('change'),
         'change_percent': x.get('change_percent'), 'time': x.get('time','')}
        for x in items if x.get('price')
    ]
    print(f'  -> {len(result["aIndex"])}条')

# 2. 涨跌分布
print('[2/7] 涨跌分布...')
raw = run(WD, 'changedist', '--raw')
if raw:
    d = json.loads(raw)
    result['marketBreadth'] = {
        'up': d.get('upCount', 0),
        'down': d.get('downCount', 0),
        'flat': d.get('flatCount', 0),
        'limitUp': d.get('upLimitCount', 0),
        'limitDown': d.get('downLimitCount', 0),
        'upRatio': d.get('upRatio', 0),
        'totalAmount': d.get('totalAmount', 0),
        'amountChange': d.get('amountChange', 0),
        'distribution': [{'range': x['section'], 'count': x['count'], 'direction': 'up' if x['flag'] == 1 else 'down' if x['flag'] == -1 else 'flat'} for x in d.get('detail', [])]
    }
    print(f'  上涨{result["marketBreadth"]["up"]}家 下跌{result["marketBreadth"]["down"]}家 占比{result["marketBreadth"]["upRatio"]}%')

# 3. 主力资金TOP10 + 补充涨跌幅
print('[3/7] 主力资金TOP10...')
raw = run(WT, 'ranking', 'cap_main_net', '--limit', '10', '--raw')
if raw:
    data = json.loads(raw)
    codes = [x['代码'] for x in data[:10]]
    # 补充个股涨跌幅
    quotes_raw = run(WD, 'quote', ','.join(codes), '--raw')
    quotes = {}
    for x in parse_quotes(quotes_raw):
        quotes[x.get('symbol', '')] = x
    result['fundFlowTop10'] = []
    for x in data[:10]:
        q = quotes.get(x['代码'], {})
        result['fundFlowTop10'].append({
            'code': x['代码'],
            'name': q.get('name', '') or x.get('名称', ''),
            'mainNetIn': x['MainNetIn'],
            'price': q.get('price'),
            'change_percent': q.get('change_percent')
        })
    print(f'  -> {len(result["fundFlowTop10"])}条')

# 3.5. 板块资金排行（流入/流出）
print('[3.5/7] 板块排行...')
raw = run(WD, 'sector', 'ranking', '--raw')
if raw:
    d = json.loads(raw)
    sections = d.get('sections', [])
    if len(sections) >= 1:
        result['sectorTopGainers'] = sections[0]  # 行业涨幅
    if len(sections) >= 2:
        result['sectorConceptGainers'] = sections[1]  # 概念涨幅
    if len(sections) >= 3:
        result['sectorFlowIn'] = sections[2]  # 资金流入TOP
    print(f'  板块涨幅: {len(result.get("sectorTopGainers", []))}条 | 资金流入: {len(result.get("sectorFlowIn", []))}条')

# 4. 美股指数七姐妹
print('[4/7] 美股数据...')
result['usIndex'] = []
result['magnificent7'] = []
raw = run(WD, 'quote', 'usDJI,usIXIC,usINX,usNDX', '--raw')
for x in parse_quotes(raw):
    if x.get('price'):
        result['usIndex'].append({
            'code': x.get('symbol',''), 'name': x.get('name', x.get('symbol','')),
            'price': x.get('price'), 'change_percent': x.get('change_percent'),
            'time': x.get('time','')
        })
print(f'  美股指数: {len(result["usIndex"])}条')

raw = run(WD, 'quote', 'usAAPL.OQ,usMSFT.OQ,usNVDA.OQ,usGOOGL.OQ,usAMZN.OQ,usMETA.OQ,usTSLA.OQ', '--raw')
for x in parse_quotes(raw):
    if x.get('price'):
        result['magnificent7'].append({
            'code': x.get('symbol',''), 'name': x.get('name', x.get('symbol','')),
            'price': x.get('price'), 'change_percent': x.get('change_percent')
        })
print(f'  七姐妹: {len(result["magnificent7"])}条')

# 5. 芯片股（美股+韩股）
print('[5/7] 芯片股...')
result['chipStocks'] = []
raw = run(WD, 'quote', 'usMU.OQ,usSNDK.OQ', '--raw')
for x in parse_quotes(raw):
    if x.get('price'):
        result['chipStocks'].append({
            'code': x.get('symbol',''), 'name': x.get('name', x.get('symbol','')),
            'price': x.get('price'), 'change_percent': x.get('change_percent')
        })

raw = run(WD, 'quote', 'ks005930,ks000660', '--raw')
for x in parse_quotes(raw):
    if x.get('price'):
        result['chipStocks'].append({
            'code': x.get('symbol', x.get('code','')), 'name': x.get('name',''),
            'price': x.get('price'),
            'change_percent': x.get('change_percent', x.get('changePct', 0)),
            'market': 'kr'
        })
print(f'  -> {len(result["chipStocks"])}条')

# 6. 资讯
print('[6/7] 资讯...')
raw = run(WD, 'hot', 'news', '--limit', '10', '--raw')
if raw:
    d = json.loads(raw)
    result['news'] = d.get('data', []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
    print(f'  -> {len(result["news"])}条')

json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'\nDone -> {OUT}')
for k in ['aIndex','fundFlowTop10','usIndex','magnificent7','chipStocks','news']:
    v = result.get(k, [])
    print(f'  {k}: {len(v) if isinstance(v, list) else "OK"}条')
