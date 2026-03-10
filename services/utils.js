/**
 * 工具函数
 */

/**
 * 获取未来 N 天的周末日期对（周五出发，周日返回）
 * @param {number} days - 未来多少天（默认30）
 * @returns {Array} [{ friday: '2025-03-14', sunday: '2025-03-16' }, ...]
 */
function getWeekendPairs(days = 30) {
    const pairs = [];
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

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

/**
 * 延迟函数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    getWeekendPairs,
    sleep
};
