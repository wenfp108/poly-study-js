const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 1. 安全门神 (保持你的 key 逻辑)
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 2. 你的智能时间逻辑 (原样还原，包含下划线逻辑) ===
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currDay = now.getDate();
    const currMonthIdx = now.getMonth();
    const currYear = now.getFullYear();

    let targetMonths = [months[currMonthIdx]];
    if (currDay >= 15) {
        const nextMonthIdx = (currMonthIdx + 1) % 12;
        targetMonths.push(months[nextMonthIdx]);
    }

    let targetYears = [String(currYear)];
    if (currMonthIdx >= 9) { 
        targetYears.push(String(currYear + 1));
    }

    const getFmtDate = (dateObj) => `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
    const t0 = new Date(now);
    const t1 = new Date(now.getTime() + 86400000);
    const t2 = new Date(now.getTime() + 172800000);
    const targetDates = [getFmtDate(t0), getFmtDate(t1), getFmtDate(t2)];

    // === 🔍 3. 指令生成器 (你的核心策略：全部找回) ===
    let searchQueries = [];
    targetMonths.forEach(m => {
        searchQueries.push(`What will Gold (GC) settle at in ${m}?`);
        searchQueries.push(`What will Gold (GC) hit__ by end of ${m}?`); // 包含下划线
        searchQueries.push(`Fed decision in ${m}?`);
        searchQueries.push(`What price will Bitcoin hit in ${m}?`);
    });
    targetYears.forEach(y => {
        searchQueries.push(`How many Fed rate cuts in ${y}?`);
    });
    searchQueries.push(`Bitcoin all time high by ___?`);
    targetDates.forEach(d => {
        searchQueries.push(`Bitcoin price on ${d}?`);
        searchQueries.push(`Bitcoin above ___ on ${d}?`);
    });

    // ===========================================

    let scoutedSlugs = new Set();
    let debugLog = [];
    debugLog.push(`Task Start: Generated ${searchQueries.length} queries`);

    // 🚀 4. Algolia 多域名高精度搜索 (DNS 防错机制)
    const APP_ID = "P6O7N0849H";
    const API_KEY = "0699042c3ef3ef3083163683a3f3607f";
    const algoliaHosts = [
      `https://${APP_ID}-dsn.algolia.net`,
      `https://${APP_ID}-1.algolianet.com`,
      `https://${APP_ID}-2.algolianet.com`,
      `https://${APP_ID}-3.algolianet.com`
    ];

    for (const q of searchQueries) {
      let querySuccess = false;
      for (const host of algoliaHosts) {
        if (querySuccess) break;
        try {
          const algoliaUrl = `${host}/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.20.0)`;
          const algoliaResp = await axios.post(algoliaUrl, {
            "requests": [{
              "indexName": "polymarket_events_production",
              "params": `query=${encodeURIComponent(q)}&hitsPerPage=1`
            }]
          }, { headers: { 'x-algolia-api-key': API_KEY, 'x-algolia-application-id': APP_ID }, timeout: 3000 });

          const hit = algoliaResp.data.results[0].hits[0];
          if (hit && hit.slug) {
            scoutedSlugs.add(hit.slug);
            debugLog.push(`[OK] "${q}" -> ${hit.slug}`);
            querySuccess = true;
          }
        } catch (err) {
          if (host === algoliaHosts[algoliaHosts.length - 1]) {
            debugLog.push(`[ERR] "${q}": ${err.message}`);
          }
        }
      }
    }

    // 🚀 5. 第二阶段：提取数据 (原样还原你的过滤逻辑和输出格式)
    let processedData = [];
    for (const slug of scoutedSlugs) {
      try {
        const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers, timeout: 5000 });
        const event = eventResp.data[0];
        if (!event || !event.markets) continue;

        event.markets.forEach(m => {
            // 🛡️ 你的基础过滤
            if (!m.active || m.closed) return;
            const vol = Number(m.volume || 0);
            const liq = Number(m.liquidity || 0);
            if (vol < 100 && liq < 100) return;

            // 你的价格解析逻辑
            let prices = [], outcomes = [];
            try {
                prices = JSON.parse(m.outcomePrices) || [];
                outcomes = JSON.parse(m.outcomes) || [];
            } catch (e) { return; }

            let priceStr = outcomes.map((o, i) => {
                const pVal = (Number(prices[i]) * 100).toFixed(1);
                return `${o}: ${pVal}%`;
            }).join(" | ");

            // 你的字段映射
            processedData.push({
                slug: slug,
                ticker: m.slug,
                question: m.groupItemTitle || m.question,
                eventTitle: event.title,
                prices: priceStr,
                volume: Math.round(vol),
                liquidity: Math.round(liq),
                endDate: m.endDate ? m.endDate.split("T")[0] : "N/A"
            });
        });
      } catch (e) {
          debugLog.push(`[FETCH ERROR] ${slug}: ${e.message}`);
      }
    }

    // 按成交量排序
    processedData.sort((a, b) => b.volume - a.volume);

    // 🚀 6. 第三阶段：GitHub 存档 (保持不变)
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    const fileName = `Finance_LIVE_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    const contentPayload = processedData.length > 0 ? processedData : [{ info: "No data", debug: debugLog }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `Strategy Sync: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentPayload, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ 运行成功！处理了 ${searchQueries.length} 个词，找到 ${processedData.length} 条数据。`);
  } catch (err) {
    res.status(500).send(`❌ 全局错误: ${err.message}`);
  }
}
