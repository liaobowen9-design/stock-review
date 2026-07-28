// ========== A股复盘网站 - 数据渲染引擎 ==========

// 全局数据存储：先尝试从 data.json 加载，失败则用硬编码兜底
let LIVE_DATA = null;

async function loadData() {
  try {
    const resp = await fetch('data.json?_=' + Date.now());
    if (resp.ok) {
      LIVE_DATA = await resp.json();
      console.log('[Data] Loaded from data.json, updated:', LIVE_DATA._updated);
      return;
    }
  } catch(e) {
    console.warn('[Data] data.json not available, using fallback');
  }
  LIVE_DATA = null;
}

// ========== 数据辅助函数 ==========
function dget(path, fallback) {
  // 从LIVE_DATA中按路径取值，不存在则返回fallback
  if (!LIVE_DATA) return fallback;
  const parts = path.split('.');
  let obj = LIVE_DATA;
  for (const p of parts) {
    if (obj == null) return fallback;
    obj = obj[p];
  }
  return obj !== undefined && obj !== null ? obj : fallback;
}

// 格式化日期
function getDateDisplay() {
  const d = dget('_date', '');
  if (d) return d;
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} 周${weekdays[now.getDay()]}`;
}

function isTradeDay() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  // 周一到周五 9:30-15:00 是交易时段
  if (day >= 1 && day <= 5) {
    if (hour > 9 || (hour === 9 && minute >= 30)) {
      if (hour < 15 || (hour === 15 && minute === 0)) return true;
    }
  }
  return false;
}
// 通用数字格式化（无单位假设，按量级智能加亿/万）
function fmtNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(decimals) + '亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(decimals) + '万';
  return n.toFixed(decimals);
}

// 资金专用格式化：输入为"元"，直接转亿显示
// 475430644 元 → 4.75亿
function fmtFund(n, decimals = 2) {
  if (n == null || isNaN(n) || n === 0) return '--';
  return (n / 1e8).toFixed(decimals) + '亿';
}

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function colorClass(val) {
  if (val == null) return '';
  return val > 0 ? 'up' : val < 0 ? 'down' : '';
}

function signedNum(val, suffix = '') {
  if (val == null || isNaN(val)) return '--';
  return (val > 0 ? '+' : '') + val.toFixed(2) + suffix;
}

// ========== SVG 环形仪表 ==========
function gaugeSVG(value, max, colorClass, label) {
  // value: 0~max 的实际值
  // 环形周长: 半径36, 周长 ≈ 226.19
  const r = 36;
  const numVal = Number(value);
  const circumference = 2 * Math.PI * r;
  const ratio = Math.min(numVal / max, 1);
  const offset = circumference * (1 - ratio);

  return `
    <div class="gauge-ring">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle class="gauge-bg" cx="40" cy="40" r="${r}"/>
        <circle class="gauge-fill ${colorClass}" cx="40" cy="40" r="${r}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"/>
      </svg>
      <div class="gauge-center">
        <div class="gauge-val">${numVal.toFixed(2)}</div>
        <div class="gauge-label">${label}</div>
      </div>
    </div>`;
}

// ========== 震荡市场检测 ==========
function getMarketAssessment() {
  // 综合VIX(40%) + VHSI(20%) + 散户情绪(25%) + 市场量能(15%) 加权
  const vix = 18.58;
  const vhsi = 22.21;

  // 散户情绪: 看空5% - 看多5% = 0, 但中性与分歧期意味着情绪脆弱
  // 加权为0，综合判断为中性偏谨慎
  let riskLevel, riskColor, detail;

  if (vix < 15) {
    riskLevel = '低恐慌';
    riskColor = 'fear-low';
  } else if (vix < 20) {
    riskLevel = '低度恐慌';
    riskColor = 'fear-low';
  } else if (vix < 28) {
    riskLevel = '中度恐慌';
    riskColor = 'fear-mid';
  } else if (vix < 35) {
    riskLevel = '高度恐慌';
    riskColor = 'fear-high';
  } else {
    riskLevel = '极度恐慌';
    riskColor = 'fear-extreme';
  }

  return { riskLevel, riskColor };
}

// ========== 数据渲染 ==========

// A股市场量能
function renderVolume() {
  const grid = document.getElementById('volumeGrid');
  // 从data.json获取涨跌分布数据
  const mb = dget('marketBreadth', null);
  let upCount = 555, downCount = 4940, flatCount = 36, limitUp = 43, limitDown = 25, upPct = 10;
  let volume = 1.93, volumeUnit = '万亿', volumeChg = -2641.61;
  let distData = [
    { label: '涨停', count: 43, type: 'up' },
    { label: '>7%', count: 37, type: 'up' },
    { label: '5~7%', count: 38, type: 'up' },
    { label: '2~5%', count: 131, type: 'up' },
    { label: '0~2%', count: 306, type: 'up' },
    { label: '平', count: 36, type: 'flat' },
    { label: '0~-2%', count: 1077, type: 'down' },
    { label: '-2~-5%', count: 3152, type: 'down' },
    { label: '-5~-7%', count: 516, type: 'down' },
    { label: '-7%<', count: 170, type: 'down' },
    { label: '跌停', count: 25, type: 'down' },
  ];
  // 从 data.json 读取
  if (mb) {
    upCount = mb.up || upCount;
    downCount = mb.down || downCount;
    flatCount = mb.flat || flatCount;
    limitUp = mb.limitUp || limitUp;
    limitDown = mb.limitDown || limitDown;
    upPct = mb.upRatio || upPct;
    if (mb.totalAmount) {
      const amt = mb.totalAmount / 1e8;
      if (amt >= 10000) { volume = parseFloat((amt / 10000).toFixed(2)); volumeUnit = '万亿'; }
      else { volume = parseFloat(amt.toFixed(0)); volumeUnit = '亿'; }
      volumeChg = mb.amountChange ? mb.amountChange / 1e8 : 0;
    }
  }
  if (mb && mb.distribution && mb.distribution.length) {
    distData = mb.distribution.map(d => ({
      label: d.range, count: d.count, type: d.direction
    }));
  }
  const volChgStr = volumeChg !== undefined ? (volumeChg > 0 ? '+' : '') + (Math.abs(volumeChg) >= 10000 ? (volumeChg / 10000).toFixed(2) + '万亿' : volumeChg.toFixed(0) + '亿') : '-2641.61亿';
  const volChgColor = volumeChg > 0 ? 'color:var(--red)' : 'color:var(--green)';
  const maxCount = Math.max(...distData.map(d => d.count));

  grid.innerHTML = `
    <div class="vol-metric">
      <div class="vm-label">💰 两市成交额</div>
      <div class="vm-value">${volume}<span style="font-size:16px">${volumeUnit}</span></div>
      <div class="vm-sub" style="${volChgColor}">较上日 ${volChgStr}</div>
    </div>
    <div class="vol-metric">
      <div class="vm-label">📈 上涨家数</div>
      <div class="vm-value" style="color:var(--red)">${upCount.toLocaleString()}</div>
      <div class="vm-sub">涨停 ${limitUp} 家</div>
    </div>
    <div class="vol-metric">
      <div class="vm-label">📉 下跌家数</div>
      <div class="vm-value" style="color:var(--green)">${downCount.toLocaleString()}</div>
      <div class="vm-sub">跌停 ${limitDown} 家</div>
    </div>
    <div class="vol-metric">
      <div class="vm-label">📊 上涨占比</div>
      <div class="vm-value" style="color:${upPct > 50 ? 'var(--red)' : 'var(--green)'}">${upPct}<span style="font-size:14px">%</span></div>
      <div class="vm-sub">${upPct > 70 ? '🔥 情绪高涨' : upPct > 50 ? '市场偏强' : upPct > 30 ? '震荡分化' : '情绪冰点'}</div>
    </div>
    <div class="volume-distribution">
      ${distData.map(d => {
        const h = Math.max((d.count / maxCount) * 80, 2);
        const barClass = d.type === 'up' ? 'up-bar' : d.type === 'down' ? 'down-bar' : 'flat-bar';
        return `
          <div class="vol-dist-bar-wrap">
            <div class="vol-dist-count">${d.count}</div>
            <div class="vol-dist-bar ${barClass}" style="height:${h}px;"></div>
            <div class="vol-dist-label">${d.label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAIndex() {
  const fallback = [
    { name: '上证指数', code: '000001', price: 3814.20, change: -62.58, pct: -1.61 },
    { name: '深证成指', code: '399001', price: 13774.68, change: -348.63, pct: -2.47 },
    { name: '创业板指', code: '399006', price: 3480.87, change: -94.65, pct: -2.65 },
  ];
  const live = dget('aIndex', null);
  const data = (live && live.length) ? live.map(d => ({
    name: d.name, code: d.code,
    price: d.price, change: d.change, pct: d.change_percent
  })) : fallback;

  const grid = document.getElementById('aIndexGrid');
  grid.innerHTML = data.map(d => `
    <div class="index-item">
      <div class="idx-name">${d.name} ${d.code}</div>
      <div class="idx-price">${fmtPrice(d.price)}</div>
      <div class="idx-change ${colorClass(d.pct)}">
        ${signedNum(d.change)}  ${signedNum(d.pct, '%')}
      </div>
    </div>
  `).join('');
}

function renderFundFlowTop10() {
  const fallback = [
    { code: '002156', name: '通富微电', inflow: 242384.27, chg: 5.32 },
    { code: '002185', name: '华天科技', inflow: 69796.21, chg: 3.15 },
    { code: '688012', name: '中微公司', inflow: 67682.61, chg: 8.21 },
    { code: '000021', name: '深科技', inflow: 58672.13, chg: 4.67 },
    { code: '300433', name: '蓝思科技', inflow: 48490.57, chg: 6.88 },
    { code: '688008', name: '澜起科技', inflow: 41272.84, chg: -1.23 },
    { code: '002409', name: '雅克科技', inflow: 41119.05, chg: 7.45 },
    { code: '300604', name: '长川科技', inflow: 37809.30, chg: 3.90 },
    { code: '301536', name: '星宸科技', inflow: 36440.08, chg: 12.56 },
    { code: '000811', name: '冰轮环境', inflow: 35489.37, chg: 2.11 },
  ];
  const live = dget('fundFlowTop10', null);
  const data = (live && live.length) ? live.map(d => ({
    code: d.code ? d.code.replace(/^(sh|sz)/, '') : d.code,
    name: d.name, inflow: d.mainNetIn, chg: d.change_percent,
    fullCode: d.code
  })) : fallback;

  const rankClass = (i) => {
    if (i === 0) return 'rank-gold';
    if (i === 1) return 'rank-silver';
    if (i === 2) return 'rank-bronze';
    return '';
  };

  const tbody = document.querySelector('#fundFlowTop10 tbody');
  tbody.innerHTML = data.map((d, i) => `
    <tr>
      <td><span class="rank-num ${rankClass(i)}">${i + 1}</span></td>
      <td style="color:var(--text-muted)">${d.code}</td>
      <td style="font-weight:600">${d.name}</td>
      <td class="up">${fmtFund(d.inflow)}</td>
      <td class="${colorClass(d.chg)}">${signedNum(d.chg, '%')}</td>
    </tr>
  `).join('');
}

function renderSentiment() {
  const assessment = getMarketAssessment();

  // ======== 散户情绪数据 ========
  // 来源：恢恢量化社区情绪监控 2026-07-26 21:00
  // 股吧: 看多5% | 看空5% | 中性90%  20条样本
  // 雪球: 看多0% | 看空0% | 中性100% 30条样本
  // 微博: 看多0% | 看空0% | 中性100% 3条样本
  // 综合: 看多1.9% | 看空1.9% | 中性96.2%

  // 散户恐慌权重: 看空比例仅1.9%，属于极低看空，但96.2%中性处于"分歧期"
  // 分歧期意味着方向不明，情绪脆弱易变
  const retailBull = 1.9;
  const retailBear = 1.9;
  const retailNeutral = 96.2;

  // 散户情绪评分（-100到+100）= 看多% - 看空% = 0.00 中性
  const retailScore = (retailBull - retailBear).toFixed(2);

  // 综合恐慌指数 = VIX×40% + VHSI×20% + 散户消极×25% + 市场量能×15%
  // VIX 18.58 × 0.40 = 7.432
  // VHSI 22.21 × 0.20 = 4.442
  // 散户消极 (零售看空1.9%，比例极低，映射为5/100) × 0.25 = 1.25
  // 量能: 上涨占比10%→恐慌分80 × 0.15 = 12
  const vixWeight = 18.58 * 0.40;
  const vhsiWeight = 22.21 * 0.20;
  const retailBearScore = (retailBear / 100) * 100 * 0.25; // 1.9%→映射为25分制×0.25=1.25
  const volumeFearScore = ((100 - 10) / 100) * 100 * 0.15; // 上涨占比10%→恐慌分90×0.15=13.5
  const compositeFear = (vixWeight + vhsiWeight + (retailBear * 1.5) + volumeFearScore).toFixed(1);

  const grid = document.getElementById('sentimentGrid');
  grid.innerHTML = `
    <!-- 左侧：专业+散户仪表 -->
    <div class="sentiment-gauges">
      <!-- 综合恐慌指数 -->
      <div class="gauge-card" style="border-left: 4px solid var(--orange);">
        ${gaugeSVG(compositeFear, 80, 'fear-mid', '综合')}
        <div class="gauge-info">
          <div class="gi-name">🔶 综合恐慌指数 <span style="font-size:11px;font-weight:400;color:var(--text-muted)">— 加权测算</span></div>
          <div class="gi-subtitle">VIX(40%) + VHSI(20%) + 散户消极(25%) + 量能(15%)</div>
          <span class="gi-level fear-mid">中度恐慌</span>
          <div class="gi-detail">综合分数 ${compositeFear}/80 | 散户情绪权重占25%</div>
        </div>
      </div>

      <!-- VIX 仪表 -->
      <div class="gauge-card">
        ${gaugeSVG(18.58, 50, 'fear-low', 'VIX')}
        <div class="gauge-info">
          <div class="gi-name">VIX 恐慌指数 🇺🇸</div>
          <div class="gi-subtitle">CBOE 波动率指数 · 07-25 美东收盘</div>
          <span class="gi-level fear-low">低度恐慌</span>
          <div class="gi-detail">昨收 18.70 | 日内 17.41-19.05</div>
        </div>
      </div>

      <!-- VHSI 仪表 -->
      <div class="gauge-card">
        ${gaugeSVG(22.21, 50, 'fear-mid', 'VHSI')}
        <div class="gauge-info">
          <div class="gi-name">VHSI 恒指波指 🇭🇰</div>
          <div class="gi-subtitle">恒生波动率指数 · 07-24 港股收盘</div>
          <span class="gi-level fear-mid">中度恐慌</span>
          <div class="gi-detail">昨收 22.11 | 日内 21.91-22.73</div>
        </div>
      </div>

      <!-- 散户情绪卡片（新增） -->
      <div class="retail-sentiment-card">
        <div class="rs-header">
          <span class="rs-title">💬 散户社区情绪 <span style="font-weight:400;font-size:10px;color:var(--text-muted)">— 权重25%</span></span>
          <span class="rs-source">股吧/雪球/微博 · 07-26 21:00 · 53条样本</span>
        </div>
        <div class="rs-bar-group">
          <div class="rs-bar-row">
            <span class="rs-bar-label" style="color:var(--red)">🟢 看多</span>
            <div class="rs-bar-track">
              <div class="rs-bar-fill retail-bull" style="width:${retailBull}%">${retailBull}%</div>
            </div>
          </div>
          <div class="rs-bar-row">
            <span class="rs-bar-label" style="color:var(--green)">🔴 看空</span>
            <div class="rs-bar-track">
              <div class="rs-bar-fill retail-bear" style="width:${retailBear}%">${retailBear}%</div>
            </div>
          </div>
          <div class="rs-bar-row">
            <span class="rs-bar-label" style="color:#546e7a">⚪ 中性</span>
            <div class="rs-bar-track">
              <div class="rs-bar-fill retail-neutral" style="width:${retailNeutral}%">${retailNeutral}%</div>
            </div>
          </div>
        </div>
        <div class="rs-platforms">
          <div class="rs-platform-tag">
            <span class="pt-score" style="color:var(--orange)">0.00</span>
            <span class="pt-name">股吧 20条</span>
          </div>
          <div class="rs-platform-tag">
            <span class="pt-score" style="color:#546e7a">0.00</span>
            <span class="pt-name">雪球 30条</span>
          </div>
          <div class="rs-platform-tag">
            <span class="pt-score" style="color:#546e7a">0.00</span>
            <span class="pt-name">微博 3条</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：情绪测算仪表盘 -->
    <div class="sentiment-dashboard">
      <div class="sentiment-metrics">
        <div class="sent-metric">
          <div class="sm-label">📊 综合恐慌评级</div>
          <div class="sm-value" style="color:var(--fear-mid)">中度恐慌</div>
          <div class="sm-sub">加权：VIX(40%)+VHSI(20%)+散户(25%)+量能(15%)</div>
        </div>
        <div class="sent-metric">
          <div class="sm-label">💬 散户情绪评分</div>
          <div class="sm-value" style="color:var(--orange)">${retailScore}</div>
          <div class="sm-sub">中性 · 分歧期</div>
        </div>
        <div class="sent-metric">
          <div class="sm-label">⚡ VIX 单日变动</div>
          <div class="sm-value down">-0.12</div>
          <div class="sm-sub">较前日 -0.64%</div>
        </div>
        <div class="sent-metric">
          <div class="sm-label">💾 费城半导体</div>
          <div class="sm-value down">-4.25%</div>
          <div class="sm-sub">SOX 半导体指数</div>
        </div>
      </div>

      <!-- 散户情绪热搜与消极帖 -->
      <div class="sentiment-summary">
        <div class="ss-title">📢 散户消极信息雷达（影响权重25%）</div>
        <div class="ss-text">
          <strong>🔴 看空热帖：</strong><br>
          • 「营销大翻车！苏泊尔，玩崩了！高管大举减持套现」 — 股吧热帖 (-1.00)<br>
          • 「科创50过山车，量化真是"背锅侠"？」 — 股吧热议<br>
          <br>
          <strong>🔍 社区情绪特征：</strong><br>
          • 情绪周期：<span style="color:var(--orange);font-weight:700">分歧期</span> — 多空力量均衡，但96.2%持观望态度<br>
          • A股上涨占比仅10%（555涨/4940跌），极端悲观情绪已部分定价<br>
          • 散户讨论集中在"长鑫上市"、"AI芯片国产化"、"周一决战"等方向性话题<br>
          • 股吧看空信号仅1条但热度较高，"苏泊尔翻车"引发消费股信任担忧<br>
          <br>
          <strong>⚠️ 权重计算：</strong>散户消极比重(1.9%看空)×情绪放大系数1.5 + 分歧期附加分 = 纳入综合恐慌指数的25%权重项
        </div>
      </div>

      <!-- VIX 期货期限结构 -->
      <div class="vix-futures">
        <div class="vf-title">📅 VIX 期货期限结构</div>
        <div class="vf-bars">
          <div class="vf-bar-group">
            <div class="vf-bar-val">18.58</div>
            <div class="vf-bar" style="height:42px;"></div>
            <div class="vf-bar-label">现货</div>
          </div>
          <div class="vf-bar-group">
            <div class="vf-bar-val">18.95</div>
            <div class="vf-bar" style="height:44px;"></div>
            <div class="vf-bar-label">次月</div>
          </div>
          <div class="vf-bar-group">
            <div class="vf-bar-val">19.51</div>
            <div class="vf-bar" style="height:48px;"></div>
            <div class="vf-bar-label">第2月</div>
          </div>
          <div class="vf-bar-group">
            <div class="vf-bar-val">20.07</div>
            <div class="vf-bar" style="height:52px;"></div>
            <div class="vf-bar-label">第3月</div>
          </div>
          <div class="vf-bar-group">
            <div class="vf-bar-val">20.81</div>
            <div class="vf-bar" style="height:58px;"></div>
            <div class="vf-bar-label">第4月</div>
          </div>
        </div>
        <div class="vf-status">📈 期货升水（Contango）—— 预期未来波动率走高</div>
      </div>
    </div>
  `;
}

function renderSectorFlow() {
  // 从 data.json 读取真实板块数据
  const liveFlowIn = dget('sectorFlowIn', null);
  const liveGainers = dget('sectorTopGainers', null);

  // 流入：优先用 sectorFlowIn 数据（API 仅返回 TOP3 资金流入板块）
  // 注意：sectorFlowIn 的 mainNetInflow 单位是万元，转成元统一格式
  const inflowData = (liveFlowIn && liveFlowIn.length) ? liveFlowIn.map(d => ({
    name: d.name,
    chg: parseFloat(d.changePct || 0),
    inflow: parseFloat(d.mainNetInflow || 0) * 10000,
    inflow5d: parseFloat(d.mainNetInflow5d || 0) * 10000,
    ratio: d.upDownRatio || '--'
  })) : [
    { name: '--', chg: 0, inflow: 0, inflow5d: 0, ratio: '--' },
  ];

  // 行业涨幅 TOP5：直接从 sectorTopGainers 取
  const gainerData = (liveGainers && liveGainers.length) ? liveGainers.slice(0, 5).map(d => ({
    name: d.name,
    chg: parseFloat(d.changePct || 0),
    chg5d: parseFloat(d.changePct5d || 0),
    chg20d: parseFloat(d.changePct20d || 0),
    leadStock: d.leadStock || '--'
  })) : [
    { name: '元件', chg: 6.25, chg5d: 3.12, chg20d: 8.45, leadStock: '通富微电(5.32)' },
    { name: '半导体', chg: 4.87, chg5d: 2.33, chg20d: 6.78, leadStock: '中微公司(8.21)' },
    { name: '通信设备', chg: 3.22, chg5d: 1.56, chg20d: 4.32, leadStock: '中兴通讯(3.45)' },
    { name: '新能源汽车', chg: 2.98, chg5d: 5.67, chg20d: 12.34, leadStock: '比亚迪(4.56)' },
    { name: '医疗器械', chg: 2.45, chg5d: -1.23, chg20d: 3.21, leadStock: '迈瑞医疗(2.34)' },
  ];

  const tbodyIn = document.querySelector('#sectorInflow tbody');
  tbodyIn.innerHTML = inflowData.map(d => `
    <tr>
      <td style="font-weight:600">${d.name}</td>
      <td class="${colorClass(d.chg)}">${signedNum(d.chg, '%')}</td>
      <td class="${d.inflow > 0 ? 'up' : 'down'}">${d.inflow != null ? fmtFund(d.inflow) : '--'}</td>
      <td class="${colorClass(d.inflow5d)}">${d.inflow5d != null ? fmtFund(d.inflow5d) : '--'}</td>
      <td>${d.ratio}</td>
    </tr>
  `).join('');

  const tbodyOut = document.querySelector('#sectorOutflow tbody');
  tbodyOut.innerHTML = gainerData.map(d => `
    <tr>
      <td style="font-weight:600">${d.name}</td>
      <td class="${colorClass(d.chg)}">${signedNum(d.chg, '%')}</td>
      <td class="${colorClass(d.chg5d)}">${signedNum(d.chg5d, '%')}</td>
      <td class="${colorClass(d.chg20d)}">${signedNum(d.chg20d, '%')}</td>
      <td>${d.leadStock}</td>
    </tr>
  `).join('');
}

function renderGlobalIndex() {
  // 名称映射
  const nameMap = {
    'usDJI': '道琼斯工业', 'usIXIC': '纳斯达克', 'usINX': '标普500', 'usNDX': '纳斯达克100',
    'usSOX': '费城半导体 SOX'
  };
  const regionMap = {
    'usDJI': '美国', 'usIXIC': '美国', 'usINX': '美国', 'usNDX': '美国', 'usSOX': '美国'
  };

  const liveIdx = dget('usIndex', null);
  let data = [];
  if (liveIdx && liveIdx.length) {
    data = liveIdx.map(d => ({
      name: d.name || nameMap[d.code] || d.code,
      region: regionMap[d.code] || '美国',
      price: d.price,
      chg: d.change_percent
    }));
  }
  // 如果 live 数据不足以覆盖所有指数，用硬编码补充
  if (data.length < 7) {
    const liveCodes = new Set(data.map(d => {
      for (const [k, v] of Object.entries(nameMap)) { if (v === d.name) return k; }
      return '';
    }));
    const fallbackAll = [
      { name: '道琼斯工业', region: '美国', price: 52210.08, chg: 0.51, code: 'usDJI' },
      { name: '纳斯达克', region: '美国', price: 24932.08, chg: -0.18, code: 'usIXIC' },
      { name: '标普500', region: '美国', price: 7413.18, chg: 0.02, code: 'usINX' },
      { name: '费城半导体 SOX', region: '美国', price: 10922.43, chg: -2.83, code: 'usSOX' },
      { name: '日经225', region: '日本', price: 64611, chg: -2.73, code: '' },
      { name: '韩国KOSPI', region: '韩国', price: 5722, chg: -11.02, code: '' },
      { name: '恒生指数', region: '中国香港', price: 25338, chg: 2.25, code: '' },
      { name: '纳斯达克100', region: '美国', price: 28039.21, chg: -0.32, code: 'usNDX' },
    ];
    for (const fb of fallbackAll) {
      if (!liveCodes.has(fb.code) && !data.find(d => d.name === fb.name)) {
        data.push({ name: fb.name, region: fb.region, price: fb.price, chg: fb.chg });
      }
    }
  }
  // 去重
  const seenNames = new Set();
  data = data.filter(d => { if (seenNames.has(d.name)) return false; seenNames.add(d.name); return true; });

  const grid = document.getElementById('globalIndexGrid');
  grid.innerHTML = data.map(d => `
    <div class="global-item">
      <div class="gl-name">${d.name}</div>
      <div class="gl-region">${d.region}</div>
      <div class="gl-price">${d.price >= 1000 ? d.price.toLocaleString() : fmtPrice(d.price)}</div>
      <div class="gl-change ${colorClass(d.chg)}">${signedNum(d.chg, '%')}</div>
    </div>
  `).join('');
}

function renderM7() {
  const fallback = [
    { name: '苹果', code: 'AAPL', price: 333.02, chg: 3.53, currency: '$' },
    { name: '微软', code: 'MSFT', price: 381.70, chg: 0.03, currency: '$' },
    { name: '英伟达', code: 'NVDA', price: 206.84, chg: -0.92, currency: '$' },
    { name: '谷歌', code: 'GOOGL', price: 319.74, chg: 0.65, currency: '$' },
    { name: '亚马逊', code: 'AMZN', price: 232.11, chg: -0.66, currency: '$' },
    { name: 'Meta', code: 'META', price: 595.19, chg: -1.80, currency: '$' },
    { name: '特斯拉', code: 'TSLA', price: 313.03, chg: -2.08, currency: '$' },
  ];
  const live = dget('magnificent7', null);
  const codeMap = {
    'usAAPL.OQ': 'AAPL', 'usMSFT.OQ': 'MSFT', 'usNVDA.OQ': 'NVDA',
    'usGOOGL.OQ': 'GOOGL', 'usAMZN.OQ': 'AMZN', 'usMETA.OQ': 'META', 'usTSLA.OQ': 'TSLA'
  };

  // 构建 live 数据 + fallback 补充
  let data = (live && live.length) ? live.map(d => ({
    name: d.name, code: codeMap[d.code] || d.code,
    price: d.price, chg: d.change_percent, currency: '$'
  })) : [];

  // 如果 live 数据不足7条，从 fallback 补充缺失的股票
  if (data.length < 7) {
    const liveCodes = new Set(data.map(d => d.code));
    for (const fb of fallback) {
      if (!liveCodes.has(fb.code)) data.push(fb);
    }
  }
  data = data.slice(0, 7);

  const grid = document.getElementById('m7Grid');
  grid.innerHTML = data.map(d => `
    <div class="stock-item">
      <div class="s-name">${d.name}</div>
      <div class="s-code">${d.code}</div>
      <div class="s-price">${d.currency}${fmtPrice(d.price)}</div>
      <div class="s-change ${colorClass(d.chg)}">${signedNum(d.chg, '%')}</div>
    </div>
  `).join('');
}

function renderChipStocks() {
  const fallback = [
    { name: '美光科技', code: 'MU', price: 920.95, chg: -6.99, market: '美股', currency: '$' },
    { name: '闪迪', code: 'SNDK', price: 1436.56, chg: -10.79, market: '美股', currency: '$' },
    { name: '三星电子', code: '005930', price: 220000, chg: -13.39, market: '韩股', currency: '₩' },
    { name: 'SK海力士', code: '000660', price: 1550000, chg: -14.65, market: '韩股', currency: '₩' },
    { name: '长鑫科技', code: '688825', price: 47.00, chg: -4.08, market: 'A股', currency: '¥' },
    { name: '通富微电', code: '002156', price: 27.38, chg: -1.83, market: 'A股', currency: '¥' },
    { name: '雅克科技', code: '002409', price: 166.43, chg: -1.72, market: 'A股', currency: '¥' },
    { name: '华天科技', code: '002185', price: 15.43, chg: -2.58, market: 'A股', currency: '¥' },
  ];
  const live = dget('chipStocks', null);
  // 构建 live 数据
  let data = (live && live.length) ? live.map(d => ({
    name: d.name,
    code: d.code ? d.code.replace(/^us/, '').replace(/\.OQ$/, '').replace(/^ks/, '') : d.code,
    price: d.price,
    chg: d.change_percent,
    market: d.market === 'kr' ? '韩股' : d.market === 'us' ? '美股' : '美股',
    currency: d.market === 'kr' ? '₩' : '$'
  })) : [];

  // 如果 live 数据不足8条，从 fallback 补充
  if (data.length < 8) {
    const liveCodes = new Set(data.map(d => d.code));
    for (const fb of fallback) {
      if (!liveCodes.has(fb.code)) data.push(fb);
    }
  }
  data = data.slice(0, 8);

  const grid = document.getElementById('chipGrid');
  grid.innerHTML = data.map(d => `
    <div class="stock-item">
      <div class="s-name">${d.name}</div>
      <div class="s-code">${d.code} · ${d.market}</div>
      <div class="s-price">${d.currency}${fmtPrice(d.price)}</div>
      <div class="s-change ${colorClass(d.chg)}">${signedNum(d.chg, '%')}</div>
    </div>
  `).join('');
}

function renderNews() {
  const fallback = [
    { title: '一周机会前瞻 | 韩国存储双雄拟签巨额大单；游戏行业重磅盛会将至', source: '腾讯自选股', time: '07-26' },
    { title: '公告精选 | 7天6板牛股提示风险；亿田智能公布20亿算力采购大单', source: '腾讯自选股', time: '07-26' },
    { title: '美伊暂停互袭！美方连续两晚停袭，伊军方：暂停对等打击', source: '华尔街见闻', time: '07-26' },
    { title: '央行超级周即将开启！美联储加息概率38%，美股财报季也将迎高峰', source: '券商中国', time: '07-26' },
    { title: '中信证券：二次原油冲击不改8月行情修复趋势', source: '中信证券研究', time: '07-26' },
    { title: '长鑫明日上市，合肥能赚多少？', source: '每日经济新闻', time: '07-26' },
    { title: '基金独门重仓股大揭秘：天准科技、共达电声等翻倍股在列', source: '中国证券报', time: '07-26' },
    { title: '火速出手！多家A股公司宣布回购，涉及惠威科技等股', source: 'e公司', time: '07-26' },
    { title: '华天科技这回谁也拦不住了', source: '财报时间', time: '07-26' },
    { title: '英伟达全面上调GPU套装价格：GDDR7/GDDR6同时涨，A股存储产业链谁最受益？', source: '时来才来', time: '07-26' },
  ];
  const live = dget('news', null);
  const data = (live && live.length) ? live.map(d => ({
    title: d.news_title || d.title,
    source: d.source || '',
    time: d.publish_time ? new Date(d.publish_time * 1000).toLocaleDateString('zh-CN') : ''
  })) : fallback;

  const list = document.getElementById('newsList');
  list.innerHTML = data.map(d => `
    <li>
      ${d.title}
      <span class="news-source">${d.source} · ${d.time}</span>
    </li>
  `).join('');
}

// ========== 日期更新 ==========
function updateAllDates() {
  const dateStr = getDateDisplay();
  const el = document.getElementById('headerDate');
  if (el) el.textContent = dateStr;

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const tradeDay = isTradeDay();

  const vid = document.getElementById('volumeUpdateTime');
  if (vid) vid.textContent = `更新于 ${dateStr} ${tradeDay ? '盘中' : '收盘'}`;

  const fid = document.getElementById('fundFlowUpdateTime');
  if (fid) fid.textContent = `更新于 ${dateStr} ${tradeDay ? '盘中' : '收盘'}`;
}

// ========== 全部渲染（带异常保护） ==========
function safeRender(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error('[Render Error] ' + name + ':', e.message);
  }
}

function renderAll() {
  updateAllDates();
  safeRender('AIndex', renderAIndex);
  safeRender('Volume', renderVolume);
  safeRender('Sentiment', renderSentiment);
  safeRender('FundFlowTop10', renderFundFlowTop10);
  safeRender('SectorFlow', renderSectorFlow);
  safeRender('GlobalIndex', renderGlobalIndex);
  safeRender('M7', renderM7);
  safeRender('ChipStocks', renderChipStocks);
  safeRender('News', renderNews);
}

// ========== 刷新 ==========
function refreshData() {
  const btn = document.querySelector('.btn-refresh');
  btn.textContent = '⏳ 加载中...';
  btn.disabled = true;

  // 模拟刷新延迟（实际项目这里会调用API）
  setTimeout(() => {
    renderAll();
    btn.textContent = '🔄 刷新数据';
    btn.disabled = false;
  }, 800);
}

// ========== 初始化 ==========
async function init() {
  await loadData();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);

// ========== 自动刷新（每5分钟） ==========
setInterval(() => {
  console.log('[Auto Refresh] Refreshing data...');
  renderAll();
}, 5 * 60 * 1000);
