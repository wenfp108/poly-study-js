import fs from 'fs';
import path from 'path';

// 路径锁定
const ROOT = process.cwd();
const LOCAL_DATA = path.resolve(ROOT, 'data');
const BANK_ROOT = path.resolve(ROOT, '../central_bank');

async function archivePolyData() {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 开始归档 Polymarket 情报: ${today}`);

    // 定义双路目标路径
    const targets = [
        { local: 'strategy', bank: 'polymarket/strategy' },
        { local: 'trends',   bank: 'polymarket/trends' }
    ];

    targets.forEach(t => {
        const sourcePath = path.join(LOCAL_DATA, t.local, today);
        const targetPath = path.join(BANK_ROOT, t.bank, today);

        // 1. 确保中央银行目录存在
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
            console.log(`📁 创建中央银行目录: ${t.bank}/${today}`);
        }

        // 2. 搬运文件
        if (fs.existsSync(sourcePath)) {
            const files = fs.readdirSync(sourcePath);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const srcFile = path.join(sourcePath, file);
                    const destFile = path.join(targetPath, file);
                    
                    fs.copyFileSync(srcFile, destFile);
                    
                    // 确认搬运后删除本地临时文件
                    if (fs.existsSync(destFile)) {
                        fs.unlinkSync(srcFile);
                        console.log(`✅ [${t.local}] 已存入金库: ${file}`);
                    }
                }
            });
        }
    });
}

archivePolyData().catch(console.error);
