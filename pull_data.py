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

result = {'_updated': '', '_date': ''}
from datetime import datetime
result['_updated'] = datetime.now().isoformat()
result['_date'] = datetime.now().strftime('%Y/%m/%d')

# 1. A股三大指数
print('[1/7] A股指数...')
raw = run(WD, 'quote', 'sh000001,sz399001,sz399006', '--raw')
if raw:
    d = json.loads(raw)
    result['aIndex'] = [
        {
            'code': x['data']['symbol'],
            'name': x['data']['name'],
            'price': x['data']['price'],
            'prev_close': x['data']['prev_close'],
            'change': x['data']['change'],
            'change_percent': x['data']['change_percent'],
            'time': x['data'].get('time', '')
        }
        for x in d.get('data', []) if x.get('data') and x['data'].get('price')
    ]
    print(f'  -> {len(result["aIndex"])}条')

# 2. 涨跌分布
print('[2/7] 涨跌分布...')
raw = run(WD, 'changedist', '--raw')
if raw:
    d = json.loads(raw)
    result['marketBreadth'] = d.get('data')
    print('  -> OK')

# 3. 主力资金TOP10 + 补充涨跌幅
print('[3/7] 主力资金TOP10...')
raw = run(WT, 'ranking', 'cap_main_net', '--limit', '10', '--raw')
if raw:
    data = json.loads(raw)
    codes = [x['代码'] for x in data[:10]]
    # 补充个股涨跌幅
    quotes_raw = run(WD, 'quote', ','.join(codes), '--raw')
    quotes = {}
    if quotes_raw:
        qd = json.loads(quotes_raw)
        for x in qd.get('data', []):
            if x.get('data'):
                quotes[x['data']['symbol']] = x['data']
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
if raw:
    d = json.loads(raw)
    for x in d.get('data', []):
        if x.get('data') and x['data'].get('price'):
            dd = x['data']
            result['usIndex'].append({
                'code': dd['symbol'], 'name': dd.get('name', dd['symbol']),
                'price': dd['price'], 'change_percent': dd.get('change_percent'),
                'time': dd.get('time', '')
            })
    print(f'  美股指数: {len(result["usIndex"])}条')

raw = run(WD, 'quote', 'usAAPL.OQ,usMSFT.OQ,usNVDA.OQ,usGOOGL.OQ,usAMZN.OQ,usMETA.OQ,usTSLA.OQ', '--raw')
if raw:
    d = json.loads(raw)
    for x in d.get('data', []):
        if x.get('data') and x['data'].get('price'):
            dd = x['data']
            result['magnificent7'].append({
                'code': dd['symbol'], 'name': dd.get('name', dd['symbol']),
                'price': dd['price'], 'change_percent': dd.get('change_percent')
            })
    print(f'  七姐妹: {len(result["magnificent7"])}条')

# 5. 芯片股（美股+韩股）
print('[5/7] 芯片股...')
result['chipStocks'] = []
raw = run(WD, 'quote', 'usMU.OQ,usSNDK.OQ', '--raw')
if raw:
    d = json.loads(raw)
    items = d.get('data', []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
    for x in items:
        if x.get('data') and x['data'].get('price'):
            dd = x['data']
            result['chipStocks'].append({
                'code': dd['symbol'], 'name': dd.get('name', dd['symbol']),
                'price': dd['price'], 'change_percent': dd.get('change_percent')
            })

raw = run(WD, 'quote', 'ks005930,ks000660', '--raw')
if raw:
    d = json.loads(raw)
    items_kr = d.get('data', []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
    for x in items_kr:
        if x.get('data') and x['data'].get('price'):
            dd = x['data']
            result['chipStocks'].append({
                'code': dd.get('code', ''), 'name': dd.get('name', ''),
                'price': dd['price'],
                'change_percent': dd.get('changePct', 0),
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
