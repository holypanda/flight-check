const cron = require('node-cron');
const storage = require('./storage');

// Schedule job to run every hour - 已禁用自动定时任务
const SCHEDULE = '0 * * * *';
let schedulerEnabled = false; // 设为 false 禁用定时任务

/**
 * 获取未来几个月的周末日期对（周五出发，周日返回）
 * @param {number} months - 未来几个月
 * @returns {Array} [{ friday: '2025-03-14', sunday: '2025-03-16' }, ...]
 */
function getWeekendPairs(months = 3) {
    const pairs = [];
    const today = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    let current = new Date(today);
    
    while (current <= endDate) {
        // 如果是周五，添加到列表
        if (current.getDay() === 5) { // 5 = Friday
            const friday = new Date(current);
            const sunday = new Date(current);
            sunday.setDate(sunday.getDate() + 2);
            
            pairs.push({
                friday: friday.toISOString().split('T')[0],
                sunday: sunday.toISOString().split('T')[0]
            });
        }
        current.setDate(current.getDate() + 1);
    }
    
    return pairs;
}

function startScheduler() {
    // 定时任务已禁用 - 只在手动点击"更新价格"时搜索
    console.log('Scheduler: Auto-search is DISABLED. Click "🔄 更新价格" button to search manually.');
    
    if (schedulerEnabled) {
        console.log(`Scheduler would run with pattern: ${SCHEDULE}`);
        // 如需启用定时任务，取消下面的注释:
        /*
        cron.schedule(SCHEDULE, async () => {
            console.log('Running scheduled flight price search...');
            // ... 定时任务代码
        });
        */
    }
    
    // 启动时不执行初始搜索
    console.log('Initial search on startup: DISABLED');
    console.log('To search flights, use the web UI or POST /api/refresh');
}

module.exports = {
    startScheduler,
    getWeekendPairs
};
