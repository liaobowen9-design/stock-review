// ========== A股复盘数据拉取脚本 ==========
// 用法: node fetch-data.js
// 拉取所有板块所需的实时数据，输出到 data.json

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WESTOCK_DATA = 'E:/workbuddy/WorkBuddyAI/resources/app.asar.unpacked/resources/builtin-skills/westock-data/scripts/index.js';
const WESTOCK_TOOL = 'E:/workbuddy/WorkBuddyAI/resources/app.asar.unpacked/resources/builtin-skills/westock-tool/scripts/index.js';
const DATA_FILE = path.resolve(__dirname, 'data.json');

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 30000 });
    return out.trim();
  } catch(e) {
    console.error('[ERROR]', cmd.substring(0, 80), e.message.substring(0, 200));
    return null;
  }
}

function parseJSON(raw) {
  if (!raw) return null;
  try {
    // westock-tool --raw 直接就是JSON数组
    if (raw.startsWith('[')) return JSON.parse(raw);
    // westock-data --raw 返回的是 { success, data: [...] }
    if (raw.startsWith('{')) return JSON.parse(raw);
    return null;
  } catch(e) {
    return null;
  }
}

function extractQuotes(parsed) {
  if (!parsed || !parsed.data) return [];
  return parsed.data.map(d => d.data || d);
}

async function main() {
  const ts = new Date().toISOString();
  const result = { _updated: ts, _date: new Date().toLocaleDateString('zh-CN') };

  // 1. A股三大指数
  console.log('[1/8] 拉取 A股指数...');
  const aIdxRaw = run(`node "${WESTOCK_DATA}" quote sh000001,sz399001,sz399006 --raw`);
  const aIdxParsed = parseJSON(aIdxRaw);
  result.aIndex = extractQuotes(aIdxParsed).map(d => ({
    code: d.symbol,
    name: d.name,
    price: d.price,
    prev_close: d.prev_close,
    change: d.change,
    change_percent: d.change_percent,
    time: d.time
  }));

  // 2. A股涨跌分布+量能
  console.log('[2/8] 拉取 涨跌分布...');
  const changedistRaw = run(`node "${WESTOCK_DATA}" changedist --raw`);
  const changedistParsed = parseJSON(changedistRaw);
  if (changedistParsed && changedistParsed.data) {
    result.marketBreadth = changedistParsed.data;
  }

  // 3. 主力资金净流入 TOP10
  console.log('[3/8] 拉取 主力资金TOP10...');
  const fundTopRaw = run(`node "${WESTOCK_TOOL}" ranking cap_main_net --limit 10 --raw`);
  const fundTopParsed = parseJSON(fundTopRaw);
  if (Array.isArray(fundTopParsed)) {
    result.fundFlowTop10 = fundTopParsed.slice(0, 10).map(d => ({
      code: d['代码'],
      name: d['名称'],
      mainNetIn: d.MainNetIn
    }));
    // 补充涨跌幅
    if (result.fundFlowTop10.length > 0) {
      const codes = result.fundFlowTop10.map(d => d.code).join(',');
      const quotesRaw = run(`node "${WESTOCK_DATA}" quote ${codes} --raw`);
      const quotesParsed = parseJSON(quotesRaw);
      if (quotesParsed && quotesParsed.data) {
        const quotes = extractQuotes(quotesParsed);
        result.fundFlowTop10.forEach((d, i) => {
          const q = quotes[i];
          if (q) {
            d.name = q.name || d.name;
            d.price = q.price;
            d.change_percent = q.change_percent;
          }
        });
      }
    }
  }

  // 4. 板块资金流向
  console.log('[4/8] 拉取 板块排行...');
  const sectorRaw = run(`node "${WESTOCK_DATA}" sector ranking --raw`);
  const sectorParsed = parseJSON(sectorRaw);
  if (sectorParsed && sectorParsed.data) {
    result.sectorFlow = sectorParsed.data;
  }

  // 5. 美股指数（可能盘前数据）
  console.log('[5/8] 拉取 美股指数...');
  const usIdxRaw = run(`node "${WESTOCK_DATA}" quote usDJI,usIXIC,usINX,usNDX --raw`);
  const usIdxParsed = parseJSON(usIdxRaw);
  result.usIndex = extractQuotes(usIdxParsed).map(d => ({
    code: d.symbol,
    name: d.name || d.symbol,
    price: d.price,
    prev_close: d.prev_close,
    change_percent: d.change_percent,
    time: d.time
  }));

  // 6. 美股七姐妹
  console.log('[6/8] 拉取 美股七姐妹...');
  const m7Raw = run(`node "${WESTOCK_DATA}" quote usAAPL.OQ,usMSFT.OQ,usNVDA.OQ,usGOOGL.OQ,usAMZN.OQ,usMETA.OQ,usTSLA.OQ --raw`);
  const m7Parsed = parseJSON(m7Raw);
  result.magnificent7 = extractQuotes(m7Parsed).map(d => ({
    code: d.symbol,
    name: d.name,
    price: d.price,
    change_percent: d.change_percent
  }));

  // 7. 存储芯片
  console.log('[7/8] 拉取 存储芯片个股...');
  const chipRaw = run(`node "${WESTOCK_DATA}" quote usMU.OQ,usSNDK.OQ --raw`);
  const chipParsed = parseJSON(chipRaw);
  result.chipStocks = extractQuotes(chipParsed).map(d => ({
    code: d.symbol,
    name: d.name,
    price: d.price,
    change_percent: d.change_percent
  }));
  // 韩股
  const krChipRaw = run(`node "${WESTOCK_DATA}" quote ks005930,ks000660 --raw`);
  if (krChipRaw) {
    const lines = krChipRaw.split('\n').filter(l => l.includes('ks00'));
    lines.forEach(line => {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length >= 5 && parts[0].startsWith('ks')) {
        result.chipStocks.push({
          code: parts[0],
          name: parts[1],
          price: parseFloat(parts[2]),
          change_percent: parseFloat(parts[3]),
          market: 'kr'
        });
      }
    });
  }

  // 8. 今日资讯
  console.log('[8/8] 拉取 热点资讯...');
  const newsRaw = run(`node "${WESTOCK_DATA}" hot news --limit 10 --raw`);
  const newsParsed = parseJSON(newsRaw);
  if (newsParsed && newsParsed.data) {
    result.news = (newsParsed.data || []).map(d => ({
      title: d.news_title,
      source: d.source,
      time: d.publish_time
    }));
  }

  // 写文件
  fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ 数据已保存到 ${DATA_FILE}`);
  console.log(`   A股指数: ${result.aIndex?.length || 0}条`);
  console.log(`   主力资金: ${result.fundFlowTop10?.length || 0}条`);
  console.log(`   美股指数: ${result.usIndex?.length || 0}条`);
  console.log(`   七姐妹: ${result.magnificent7?.length || 0}条`);
  console.log(`   芯片个股: ${result.chipStocks?.length || 0}条`);
  console.log(`   资讯: ${result.news?.length || 0}条`);
}

main().catch(e => { console.error(e); process.exit(1); });
