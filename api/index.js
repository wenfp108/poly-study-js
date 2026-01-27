const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 1. 安全门神
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 2. 智能时间逻辑 (The Time Machine) ===
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    // 当前基础时间
    const currDay = now.getDate();
    const currMonthIdx = now.getMonth();
    const currYear = now.getFullYear();

    // A. 月份逻辑 (15号切分)
    // 默认只看本月。如果今天 >= 15号，额外看下个月。
    let targetMonths = [months[currMonthIdx]];
    if (currDay >= 15) {
        const nextMonthIdx = (currMonthIdx + 1) % 12;
        targetMonths.push(months[nextMonthIdx]);
    }

    // B. 年份逻辑 (10月切分)
    // 默认只看今年。如果现在是10月(Index 9)或以后，额外看明年。
    let targetYears = [String(currYear)];
    if (currMonthIdx >= 9) { 
        targetYears.push(String(currYear + 1));
    }

    // C. 日期逻辑 (T+0, T+1, T+2)
    // 你的例子：今天1月27，搜1月28(T+1)和1月29(T+2)。
    // 为了保险，我加上了 T+0 (今天)，防止漏掉正在进行的今日决算。
    const getFmtDate = (dateObj) => `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
    
    const t0 = new Date(now);
    const t1 = new Date(now.getTime() + 86400000);     // 明天
    const t2 = new Date(now.getTime() + 86400000 * 2); // 后天
    
    const targetDates = [getFmtDate(t0), getFmtDate(t1), getFmtDate(t2)];

    // === 🔍 3. 指令生成器 (按照你的标题格式) ===
    let searchQueries = [];

    // 3.1 月份类问题
    targetMonths.forEach(m => {
        searchQueries.push(`What will Gold (GC) settle at in ${m}?`);
        searchQueries.push(`What will Gold (GC) hit__ by end of ${m}?`);
        searchQueries.push(`Fed decision in ${m}?`);
        searchQueries.push(`What price will Bitcoin hit in ${m}?`);
    });

    // 3.2 年份类问题
    targetYears.forEach(y => {
        searchQueries.push(`How many Fed rate cuts in ${y}?`);
    });

    // 3.3 固定问题 (无时间)
    searchQueries.push(`Bitcoin all time high by ___?`);

    // 3.4 日期类问题 (T+0, T+1, T+2)
    targetDates.forEach(d => {
        searchQueries.push(`Bitcoin price on ${d}?`);
        searchQueries.push(`Bitcoin above ___ on ${d}?`);
    });

    // ===========================================

    let scoutedSlugs = new Set();
    let debugLog = [];

    // 🚀 第一阶段：搜索 (Scouting)
    for (const q of searchQueries) {
      // 这里的 limit 设为 10，保证每个问题抓前10个最相关的
      const url = `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(q)}&active=true&closed=false&limit=10`;
      const resp = await axios.get(url, { headers });
      const items = resp.data || [];
      
      items.forEach(item => {
          // 简单校验：只要 slug 存在就加入待抓取列表
          if(item.eventSlug || item.slug) {
              scoutedSlugs.add(item.eventSlug || item.slug);
          }
      });
      debugLog.push(`Query [${q}] found ${items.length} items`);
    }

    // 🚀 第二阶段：提取 (Fetching)
    let processedData = [];

    for (const slug of scoutedSlugs) {
      try {
        const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers });
        const event = eventResp.data[0];
        
        if (!event || !event.markets) continue;

        event.markets.forEach(m => {
            // 🛡️ 基础过滤：只看活跃且未结束的
            if (!m.active || m.closed) return;

            // 🛡️ 垃圾过滤：成交量或流动性太低的不看 (防止只有$1的测试盘)
            const vol = Number(m.volume || 0);
            const liq = Number(m.liquidity || 0);
            if (vol < 100 && liq < 100) return;

            // 解析价格
            let prices = [];
            let outcomes = [];
            try {
                prices = JSON.parse(m.outcomePrices) || [];
                outcomes = JSON.parse(m.outcomes) || [];
            } catch (e) { return; }

            // 格式化输出: "Yes: 20% | No: 80%"
            let priceStr = outcomes.map((o, i) => {
                const pVal = (Number(prices[i]) * 100).toFixed(1);
                return `${o}: ${pVal}%`;
            }).join(" | ");

            processedData.push({
                slug: slug,
                ticker: m.slug,
                question: m.groupItemTitle || m.question, // 优先用短标题
                eventTitle: event.title,
                prices: priceStr,
                volume: Math.round(vol),
                liquidity: Math.round(liq),
                endDate: m.endDate ? m.endDate.split("T")[0] : "N/A"
            });
        });

      } catch (e) {
          console.error(`Error fetching slug ${slug}:`, e.message);
      }
    }

    // 按成交量排序，大的在前面
    processedData.sort((a, b) => b.volume - a.volume);

    // 🚀 第三阶段：GitHub 存档
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    
    // 文件名：Finance_LIVE_2026-01-28_14-30-05.json
    const fileName = `Finance_LIVE_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    
    const contentPayload = processedData.length > 0 ? processedData : [{ info: "No active markets found for current queries", debug: debugLog }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `woon-poly-datav1: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentPayload, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ woon-poly-datav1 运行成功！生成文件: ${fileName} (含 ${processedData.length} 条数据)`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`❌ Error: ${err.message}`);
  }
}
