const fs = require('fs');
const path = require('path');

async function archivePolyData() {
    const today = new Date().toISOString().split('T')[0];
    const ROOT = process.cwd();
    const LOCAL_DATA = path.resolve(ROOT, 'data');
    const BANK_ROOT = path.resolve(ROOT, 'central_bank');

    console.log(`📅 启动收割程序，目标日期: ${today}`);

    // 定义需要搬运的分类
    const targets = [
        { local: 'strategy', bank: 'polymarket/strategy' },
        { local: 'trends',   bank: 'polymarket/trends' }
    ];

    targets.forEach(t => {
        const sourcePath = path.join(LOCAL_DATA, t.local, today);
        const targetPath = path.join(BANK_ROOT, t.bank, today);

        // 1. 搬运逻辑
        if (fs.existsSync(sourcePath)) {
            const files = fs.readdirSync(sourcePath).filter(f => f.endsWith('.json'));
            
            if (files.length > 0) {
                if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });

                files.forEach(file => {
                    const srcFile = path.join(sourcePath, file);
                    const destFile = path.join(targetPath, file);
                    fs.copyFileSync(srcFile, destFile);
                    console.log(`📦 已存入中央银行: ${file}`);
                });
            }
        }
    });

    // 2. 焚毁逻辑：清空 data 目录下的所有子文件夹
    // 只保留 data 本身，删除其下所有内容
    if (fs.existsSync(LOCAL_DATA)) {
        const items = fs.readdirSync(LOCAL_DATA);
        items.forEach(item => {
            const itemPath = path.join(LOCAL_DATA, item);
            // 如果你打算自己在 data 根目录留个 .gitkeep，这里避开它
            if (item !== '.gitkeep') {
                fs.rmSync(itemPath, { recursive: true, force: true });
                console.log(`🔥 已清理本地残留: ${item}`);
            }
        });
    }
}

archivePolyData().catch(console.error);
