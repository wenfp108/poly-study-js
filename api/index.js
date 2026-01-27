const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;

    // 🌟 核心指令集 (无视日期，只看意图)
    const templates = [
      { core: "What will Gold (GC) hit", type: "monthly" },
      { core: "What will Gold (GC) settle", type: "monthly" },
      { core: "Fed decision", type: "monthly" },
      { core: "Fed rate cuts", type: "yearly" }, // 自动适配今年/明年
      { core: "What price will Bitcoin hit", type: "monthly" },
      { core: "Bitcoin price on", type: "daily" }, // 自动适配 T+2
      { core: "Bitcoin above", type: "daily" },    // 自动适配 T+2
      { core: "Bitcoin all time high", type: "ath" }
    ];

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 动态时间工厂 (V8.3 升级版) ===
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // 1. 月度窗口 (15号轮动)
    const currentMonthIdx = now.getMonth();
    let targetMonths = [months[currentMonthIdx], shortMonths[currentMonthIdx]];
    if (now.getDate() >= 15) {
      const nextIdx = (currentMonthIdx + 1) % 12;
      targetMonths.push(months[nextIdx], shortMonths[nextIdx]);
    }

    // 2. 年度窗口 (今年 + 明年)
    const currentYear = now.getFullYear();
    const targetYears = [String(currentYear), String(currentYear + 1)]; // ["2026", "2027"]

    // 3. 日度窗口 (T+2 黄金三天: 今天, 明天, 后天)
    const getFmtDate = (d) => [`${shortMonths[d.getMonth()]} ${d.getDate()}`, `${months[d.getMonth()]} ${d.getDate()}`];
    
    const day0 = getFmtDate(now);
    const day1 = getFmtDate(new Date(now.getTime() + 86400000));
    const day2 = getFmtDate(new Date(now.getTime() + 86400000 * 2));
    
    const targetDays = [...day0, ...day1, ...day2]; // 包含全称和缩写

    // ===========================================

    let scoutedSlugs = new Set();

    // 🚀 第一阶段：模版扫描 (Scouting)
    for (const t of templates) {
      // 提取核心词
      let searchKey = "";
      if (t.core.includes("Gold")) searchKey = "Gold (GC)";
      else if (t.core.includes("Fed")) searchKey = "Fed";
      else searchKey = "Bitcoin";

      const url = `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(searchKey)}&active=true&closed=false&limit=50`;
      const resp = await axios.get(url, { headers });
      const items = resp.data || [];

      items.forEach(item => {
        const title = item.title;
        const vol = Number(item.volume || 0);
        const slug = item.eventSlug || item.slug;

        // 🛡️ 成交量门槛 $1000
        if (vol < 1000 || !title || !slug) return;

        // 🛡️ 智能匹配逻辑
        let isMatch = false;
        
        // 必须包含 searchKey 的核心部分 (防止搜 Bitcoin 出来 Ethereum)
        if (!title.toLowerCase().includes(searchKey.split(" ")[0].toLowerCase())) return;

        if (t.type === "monthly") {
          // 必须包含: (Jan/Feb) AND (hit/settle/decision)
          let action = t.core.split(" ").pop().toLowerCase(); // hit, settle...
          // 特殊处理 "Fed decision"
          if (t.core.includes("Fed decision")) action = "decision";
          
          if (targetMonths.some(m => title.includes(m)) && title.toLowerCase().includes(action)) {
             isMatch = true;
          }
        } 
        else if (t.type === "daily") {
          // 必须包含: (Jan 28/29/30) AND (price/above)
          let action = "";
          if (t.core.includes("price on")) action = "price";
          else if (t.core.includes("above")) action = "above";
          
          if (targetDays.some(d => title.includes(d)) && title.toLowerCase().includes(action)) {
             isMatch = true;
          }
        }
        else if (t.type === "yearly") {
          // 必须包含: (2026/2027) AND (rate cuts)
          if (targetYears.some(y => title.includes(y)) && title.toLowerCase().includes("rate cut")) {
             isMatch = true;
          }
        }
        else if (t.type === "ath") {
          if (title.toLowerCase().includes("all time high")) isMatch = true;
        }

        if (isMatch) scoutedSlugs.add(slug);
      });
    }

    // 🚀 第二阶段：精准抓取 (Fetching)
    let finalReport = [];
    for (const slug of scoutedSlugs) {
      const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers });
      const event = eventResp.data[0];
      if (!event || !event.markets) continue;

      let analysis = {};
      event.markets.forEach(m => {
        if (!m.outcomePrices) return;
        const prices = JSON.parse(m.outcomePrices);
        const outcomes = JSON.parse(m.outcomes) || ["Yes", "No"];
        let signals = prices.map((p, i) => `${outcomes[i]}: ${(Number(p)*100).toFixed(1)}%`);
        
        const date = m.endDate ? m.endDate.split("T")[0] : "LongTerm";
        if (!analysis[date]) analysis[date] = [];
        analysis[date].push({ choice: m.groupItemTitle || m.question, signal: signals.join(" | "), vol: `$${Math.round(m.volume)}` });
      });

      if (Object.keys(analysis).length > 0) {
        finalReport.push({ title: event.title, total_vol: `$${Math.round(event.volume)}`, analysis });
      }
    }

    // 🚀 第三阶段：GitHub 推送
    const nowStr = now.toISOString().split('T')[0];
    const path = `data/strategy/${nowStr}/V8.3_AutoWindow_${Date.now()}.json`;
    
    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: "The Architect's Alpha: T+2 & Yearly Update",
      content: Buffer.from(JSON.stringify(finalReport, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ V8.3 全自动时间窗口扫描完成。捕获 ${finalReport.length} 条数据。`);
  } catch (err) {
    res.status(500).send(`❌ 错误: ${err.message}`);
  }
}
