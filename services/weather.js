/**
 * 越后汤泽天气服务模块
 * 使用 Open-Meteo API (免费) 获取天气和雪况信息
 * Open-Meteo: https://open-meteo.com/
 */

const https = require('https');

// 尝试使用 global fetch (Node 18+)，否则使用 https 模块
const useFetch = typeof fetch !== 'undefined';

/**
 * 使用 fetch API 获取数据
 */
async function fetchGet(url) {
    const response = await fetch(url, { 
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
}

// 越后汤泽坐标 (Echigo-Yuzawa, Niigata, Japan)
const YUZAWA_LAT = 36.93;
const YUZAWA_LON = 138.82;

/**
 * 发起 HTTPS 请求 (Node.js https 模块)
 */
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 15000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JSON'));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * 统一的数据获取接口
 */
async function httpGet(url) {
    try {
        // 优先尝试使用 fetch
        return await fetchGet(url);
    } catch (fetchErr) {
        console.log('Fetch failed, falling back to https:', fetchErr.message);
        // 如果 fetch 失败，回退到 https 模块
        return await httpsGet(url);
    }
}

/**
 * 获取天气预报（16天）
 * @returns {Promise<Array>} 天气数据数组
 */
async function getForecast() {
    // Open-Meteo API: 免费，无需 API key
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${YUZAWA_LAT}&longitude=${YUZAWA_LON}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weathercode&timezone=Asia%2FTokyo&forecast_days=16`;
    
    const data = await httpGet(url);
    
    if (!data.daily) {
        throw new Error('Invalid response from Open-Meteo');
    }
    
    const result = [];
    const daily = data.daily;
    
    for (let i = 0; i < daily.time.length; i++) {
        const date = daily.time[i];
        const maxTemp = daily.temperature_2m_max[i];
        const minTemp = daily.temperature_2m_min[i];
        const snowfall = daily.snowfall_sum[i] || 0; // cm
        const precipitation = daily.precipitation_sum[i] || 0;
        const weatherCode = daily.weathercode[i];
        
        const weatherInfo = interpretWeatherCode(weatherCode);
        const snowCondition = evaluateSnowCondition(maxTemp, minTemp, snowfall, weatherCode);
        
        result.push({
            date: date,
            temp: {
                day: Math.round((maxTemp + minTemp) / 2),
                min: Math.round(minTemp),
                max: Math.round(maxTemp)
            },
            weather: {
                main: weatherInfo.main,
                description: weatherInfo.description,
                icon: weatherInfo.icon
            },
            snow: Math.round(snowfall * 10) / 10, // cm
            precipitation: Math.round(precipitation * 10) / 10,
            snowCondition: snowCondition
        });
    }
    
    return result;
}

/**
 * 解析 Open-Meteo 天气代码
 * https://open-meteo.com/en/docs
 */
function interpretWeatherCode(code) {
    // WMO Weather interpretation codes
    const codeMap = {
        0: { main: 'Clear', description: '晴朗', icon: '01d' },
        1: { main: 'Clouds', description: '多云', icon: '02d' },
        2: { main: 'Clouds', description: '多云', icon: '03d' },
        3: { main: 'Clouds', description: '阴天', icon: '04d' },
        45: { main: 'Fog', description: '雾', icon: '50d' },
        48: { main: 'Fog', description: '雾凇', icon: '50d' },
        51: { main: 'Drizzle', description: '毛毛雨', icon: '09d' },
        53: { main: 'Drizzle', description: '中雨', icon: '09d' },
        55: { main: 'Drizzle', description: '大雨', icon: '09d' },
        61: { main: 'Rain', description: '小雨', icon: '10d' },
        63: { main: 'Rain', description: '中雨', icon: '10d' },
        65: { main: 'Rain', description: '大雨', icon: '10d' },
        71: { main: 'Snow', description: '小雪', icon: '13d' },
        73: { main: 'Snow', description: '中雪', icon: '13d' },
        75: { main: 'Snow', description: '大雪', icon: '13d' },
        77: { main: 'Snow', description: '雪粒', icon: '13d' },
        80: { main: 'Rain', description: '阵雨', icon: '09d' },
        81: { main: 'Rain', description: '中阵雨', icon: '09d' },
        82: { main: 'Rain', description: '强阵雨', icon: '09d' },
        85: { main: 'Snow', description: '阵雪', icon: '13d' },
        86: { main: 'Snow', description: '强阵雪', icon: '13d' },
        95: { main: 'Thunderstorm', description: '雷雨', icon: '11d' },
        96: { main: 'Thunderstorm', description: '雷伴冰雹', icon: '11d' },
        99: { main: 'Thunderstorm', description: '强雷伴冰雹', icon: '11d' }
    };
    
    return codeMap[code] || { main: 'Unknown', description: '未知', icon: '01d' };
}

/**
 * 评估雪况
 */
function evaluateSnowCondition(maxTemp, minTemp, snowfall, weatherCode) {
    const avgTemp = (maxTemp + minTemp) / 2;
    const isSnowing = weatherCode >= 71 && weatherCode <= 77 || weatherCode === 85 || weatherCode === 86;
    
    let score = 0;
    let condition = '';
    let description = '';
    
    // 温度评分：-5°C 到 -1°C 最佳
    if (avgTemp <= -8) {
        score += 25;
        condition = 'powder';
        description = '极冷粉雪';
    } else if (avgTemp <= -5) {
        score += 35;
        condition = 'powder';
        description = '粉雪';
    } else if (avgTemp <= -2) {
        score += 40;
        condition = 'excellent';
        description = '极佳';
    } else if (avgTemp <= 1) {
        score += 35;
        condition = 'excellent';
        description = '极佳';
    } else if (avgTemp <= 4) {
        score += 25;
        condition = 'good';
        description = '良好';
    } else if (avgTemp <= 7) {
        score += 15;
        condition = 'fair';
        description = '一般';
    } else {
        score += 5;
        condition = 'poor';
        description = '较差';
    }
    
    // 降雪评分 (cm)
    if (snowfall > 30) {
        score += 40;
        description = '大雪 - ' + description;
    } else if (snowfall > 15) {
        score += 30;
        description = '中雪 - ' + description;
    } else if (snowfall > 5) {
        score += 20;
        description = '小雪 - ' + description;
    } else if (snowfall > 0) {
        score += 10;
        description = '微量雪 - ' + description;
    }
    
    // 正在下雪额外加分
    if (isSnowing) {
        score += 15;
    }
    
    // 限制最高100分
    score = Math.min(100, score);
    
    // 根据分数确定等级 (1-5)
    let level = 1;
    if (score >= 80) level = 5;
    else if (score >= 65) level = 4;
    else if (score >= 50) level = 3;
    else if (score >= 30) level = 2;
    
    return {
        score,
        level,
        condition,
        description,
        isSnowing: isSnowing || snowfall > 0
    };
}

/**
 * 获取指定日期范围的天气数据
 * @param {Array<string>} dates - 日期数组 ['YYYY-MM-DD', ...]
 * @returns {Promise<Object>} 天气数据映射 { 'YYYY-MM-DD': weatherData }
 */
async function getWeatherForDates(dates) {
    try {
        const forecast = await getForecast();
        
        // 创建日期到天气数据的映射
        const weatherMap = {};
        dates.forEach(date => {
            const weather = forecast.find(w => w.date === date);
            if (weather) {
                weatherMap[date] = weather;
            }
        });
        
        return weatherMap;
    } catch (error) {
        console.error('Error fetching weather for dates:', error);
        return {};
    }
}

/**
 * 从航班数据中提取日期并获取天气
 * @param {Array} flights - 航班数组
 * @returns {Promise<Object>} 日期到天气的映射
 */
async function getWeatherForFlights(flights) {
    if (!flights || flights.length === 0) {
        return {};
    }
    
    // 提取所有唯一的出发日期
    const dates = [...new Set(flights.map(flight => flight.date))];
    
    return await getWeatherForDates(dates);
}

/**
 * 获取指定日期的天气
 * @param {string} date - 日期 'YYYY-MM-DD'
 * @returns {Promise<Object|null>} 天气数据
 */
async function getWeatherForDate(date) {
    const forecast = await getForecast();
    return forecast.find(w => w.date === date) || null;
}

module.exports = {
    getWeatherForDate,
    getForecast,
    getWeatherForDates,
    getWeatherForFlights,
    YUZAWA_LAT,
    YUZAWA_LON
};
