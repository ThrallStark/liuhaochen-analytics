/**
 * 刘昊辰个人网站 - 数据统计服务
 * 隐私保护：只收集必要的统计数据，不存储个人身份信息
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据存储目录
const DATA_DIR = path.join(__dirname, 'data');

// 内存缓存
let dailyData = [];

// 确保目录存在
async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
ensureDirs();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 隐私保护：对访客ID进行哈希处理
function hashId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'u' + Math.abs(hash).toString(36);
}

// 获取今日日期字符串
function getToday() {
  return new Date().toISOString().split('T')[0];
}

// 保存数据到文件
async function saveDailyData() {
  const today = getToday();
  const filePath = path.join(DATA_DIR, `${today}.json`);
  try {
    await fs.writeFile(filePath, JSON.stringify(dailyData, null, 2));
    console.log(`[${new Date().toISOString()}] 数据已保存: ${dailyData.length} 条记录`);
  } catch (error) {
    console.error('保存数据失败:', error);
  }
}

// 加载今日数据
async function loadDailyData() {
  const today = getToday();
  const filePath = path.join(DATA_DIR, `${today}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    dailyData = JSON.parse(data);
    console.log(`[${new Date().toISOString()}] 已加载今日数据: ${dailyData.length} 条记录`);
  } catch {
    dailyData = [];
  }
}

// 初始化加载数据
loadDailyData();

// 接收埋点数据（隐私保护）
app.post('/api/track', async (req, res) => {
  try {
    const { type, timestamp, visitorId, sessionId, isNewVisitor, pagePath, pageName, referrer, duration } = req.body;
    
    // 隐私保护：哈希处理访客ID
    const privacySafeRecord = {
      type,
      timestamp,
      visitorHash: hashId(visitorId),
      sessionHash: hashId(sessionId),
      isNewVisitor,
      pagePath,
      pageName,
      referrer: referrer || 'direct',
      duration,
      hour: new Date(timestamp).getHours()
    };
    
    dailyData.push(privacySafeRecord);
    
    // 每50条数据保存一次
    if (dailyData.length % 50 === 0) {
      await saveDailyData();
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('埋点接收失败:', error);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 生成每日报告
function generateReport(data, date) {
  const pageViews = data.filter(d => d.type === 'pageview');
  const pageLeaves = data.filter(d => d.type === 'pageleave');
  
  const uniqueVisitors = new Set(pageViews.map(d => d.visitorHash)).size;
  const totalPV = pageViews.length;
  const newVisitors = pageViews.filter(d => d.isNewVisitor).length;
  const returnVisitors = uniqueVisitors - newVisitors;
  
  // 页面统计
  const pageStats = {};
  pageViews.forEach(pv => {
    const path = pv.pagePath || '/';
    if (!pageStats[path]) {
      pageStats[path] = { path, name: pv.pageName || path, pv: 0, uv: new Set() };
    }
    pageStats[path].pv++;
    pageStats[path].uv.add(pv.visitorHash);
  });
  const pageStatsArray = Object.values(pageStats)
    .map(p => ({ ...p, uv: p.uv.size }))
    .sort((a, b) => b.pv - a.pv);
  
  // 来源统计
  const sourceStats = {};
  pageViews.forEach(pv => {
    const source = pv.referrer || 'direct';
    if (!sourceStats[source]) {
      sourceStats[source] = { source, uv: new Set(), count: 0 };
    }
    sourceStats[source].uv.add(pv.visitorHash);
    sourceStats[source].count++;
  });
  const sourceStatsArray = Object.values(sourceStats)
    .map(s => ({ 
      source: s.source === 'direct' ? '直接访问' : 
              s.source === 'search_baidu' ? '百度搜索' :
              s.source === 'search_google' ? '谷歌搜索' :
              s.source === 'social_weibo' ? '微博' :
              s.source === 'social_zhihu' ? '知乎' :
              s.source === 'social_linkedin' ? 'LinkedIn' : '其他',
      uv: s.uv.size, 
      percentage: Math.round((s.count / totalPV) * 100) 
    }))
    .sort((a, b) => b.uv - a.uv);
  
  // 平均停留时长
  let totalDuration = 0;
  let durationCount = 0;
  pageLeaves.forEach(pl => {
    if (pl.duration && pl.duration > 0 && pl.duration < 3600000) {
      totalDuration += pl.duration;
      durationCount++;
    }
  });
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount / 1000) : 0;
  
  // 跳出率
  const visitorPages = {};
  pageViews.forEach(pv => {
    if (!visitorPages[pv.visitorHash]) {
      visitorPages[pv.visitorHash] = new Set();
    }
    visitorPages[pv.visitorHash].add(pv.pagePath);
  });
  const singlePageVisitors = Object.values(visitorPages).filter(pages => pages.size === 1).length;
  const bounceRate = uniqueVisitors > 0 ? (singlePageVisitors / uniqueVisitors) : 0;
  
  // 24小时数据
  const hourlyData = [];
  for (let i = 0; i < 24; i++) {
    const hourPV = pageViews.filter(pv => pv.hour === i).length;
    const hourUV = new Set(pageViews.filter(pv => pv.hour === i).map(pv => pv.visitorHash)).size;
    hourlyData.push({
      hour: `${i.toString().padStart(2, '0')}:00`,
      pv: hourPV,
      uv: hourUV
    });
  }
  
  // 智能洞察
  const insights = [];
  const peakHour = hourlyData.reduce((max, h) => h.pv > max.pv ? h : max, hourlyData[0]);
  if (peakHour.pv > 0) {
    insights.push(`流量高峰出现在 ${peakHour.hour}，PV达到 ${peakHour.pv} 次`);
  }
  if (pageStatsArray.length > 0) {
    const topPage = pageStatsArray[0];
    insights.push(`「${topPage.name}」是最受欢迎的页面，占总流量的 ${((topPage.pv / totalPV) * 100).toFixed(1)}%`);
  }
  if (bounceRate < 0.4) {
    insights.push('跳出率表现优秀，用户粘性很高');
  } else if (bounceRate < 0.6) {
    insights.push('跳出率控制在合理范围内');
  } else {
    insights.push('跳出率偏高，建议优化页面内容');
  }
  insights.push(newVisitors > returnVisitors ? '新访客占比较高，获客效果良好' : '回访客占比较高，用户忠诚度良好');
  
  return {
    date,
    summary: {
      pv: totalPV,
      uv: uniqueVisitors,
      newVisitors,
      returnVisitors,
      avgSessionDuration: avgDuration,
      bounceRate: parseFloat(bounceRate.toFixed(3)),
      pagesPerSession: uniqueVisitors > 0 ? parseFloat((totalPV / uniqueVisitors).toFixed(2)) : 0
    },
    hourlyData,
    pageStats: pageStatsArray,
    sourceStats: sourceStatsArray,
    insights
  };
}

// 获取今日报告
app.get('/api/report/latest', async (req, res) => {
  const today = getToday();
  const report = generateReport(dailyData, today);
  res.json(report);
});

// 获取指定日期报告
app.get('/api/report/:date', async (req, res) => {
  const { date } = req.params;
  const filePath = path.join(DATA_DIR, `${date}.json`);
  
  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const report = generateReport(data, date);
    res.json(report);
  } catch {
    res.status(404).json({ error: '该日期暂无数据' });
  }
});

// 获取可用日期列表
app.get('/api/dates', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const dates = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort((a, b) => b.localeCompare(a));
    res.json(dates);
  } catch {
    res.json([]);
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    today: getToday(),
    records: dailyData.length
  });
});

// 定期保存数据（每5分钟）
setInterval(async () => {
  if (dailyData.length > 0) {
    await saveDailyData();
  }
}, 5 * 60 * 1000);

// 每天凌晨保存并清空数据
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 5) {
    await saveDailyData();
    dailyData = [];
    console.log(`[${now.toISOString()}] 新的一天，数据已重置`);
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
});
