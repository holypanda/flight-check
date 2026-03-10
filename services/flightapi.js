/**
 * FlightAPI.io 服务模块
 * 用于获取实时航班价格数据
 * API文档: https://docs.flightapi.io/
 */

const axios = require('axios');

const BASE_URL = 'https://api.flightapi.io';

// 香港快运航空公司代码
const HK_EXPRESS_CODE = 'UO';

/**
 * 搜索单程航班
 * @param {Object} params - 搜索参数
 * @param {string} params.apiKey - API Key
 * @param {string} params.from - 出发机场 IATA 代码 (如 HKG)
 * @param {string} params.to - 到达机场 IATA 代码 (如 NRT)
 * @param {string} params.date - 出发日期 YYYY-MM-DD
 * @param {number} params.adults - 成人数量 (默认1)
 * @param {string} params.cabinClass - 舱位 Economy/Business/First/Premium_Economy (默认Economy)
 * @param {string} params.currency - 货币代码 (默认CNY)
 * @returns {Promise<Array>} 航班列表
 */
async function searchOneway(params) {
  const {
    apiKey,
    from,
    to,
    date,
    adults = 1,
    cabinClass = 'Economy',
    currency = 'HKD'
  } = params;

  if (!apiKey) {
    throw new Error('FlightAPI key is required');
  }

  // FlightAPI 使用小写的 cabin_class
  const cabinParam = cabinClass.toLowerCase();

  const url = `${BASE_URL}/onewaytrip/${apiKey}/${from}/${to}/${date}/${adults}/0/0/${cabinParam}/${currency}`;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[FlightAPI] Searching ${from} -> ${to} on ${date}${attempt > 1 ? ` (retry ${attempt}/${maxRetries})` : ''}`);
      const response = await axios.get(url, {
        timeout: 60000,
        headers: {
          'Accept': 'application/json'
        }
      });

      const data = response.data;

      if (!data.itineraries || data.itineraries.length === 0) {
        console.log(`[FlightAPI] No flights found`);
        return [];
      }

      return parseOnewayResponse(data, from, to, currency);
    } catch (error) {
      if (error.response) {
        if (error.response.status === 429) {
          throw new Error('FlightAPI rate limit exceeded. Please try again later.');
        }
        if (error.response.status === 404) {
          console.log(`[FlightAPI] No flights found for ${from} -> ${to} on ${date}`);
          return [];
        }
        // Retry on 400 errors (transient API failures)
        if (error.response.status === 400 && attempt < maxRetries) {
          const delay = attempt * 3000;
          console.warn(`[FlightAPI] HTTP 400, retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error('[FlightAPI] HTTP error:', error.response.status, error.response.data);
      } else if (error.code === 'ECONNABORTED' && attempt < maxRetries) {
        const delay = attempt * 3000;
        console.warn(`[FlightAPI] Timeout, retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      } else {
        console.error('[FlightAPI] Request error:', error.message);
      }
      return [];
    }
  }
  return [];
}

/**
 * 解析单程航班响应
 * Skyscanner 风格的数据结构
 */
function parseOnewayResponse(data, from, to, currency) {
  const { itineraries, legs, segments, places, carriers } = data;
  
  // 创建查找表
  const legMap = new Map(legs.map(l => [l.id, l]));
  const segmentMap = new Map(segments.map(s => [s.id, s]));
  const placeMap = new Map(places.map(p => [p.id, p]));
  const carrierMap = new Map(carriers.map(c => [c.id, c]));
  
  const flights = [];
  
  for (const itinerary of itineraries) {
    if (!itinerary.leg_ids || itinerary.leg_ids.length === 0) continue;
    
    const legId = itinerary.leg_ids[0];
    const leg = legMap.get(legId);
    
    if (!leg) continue;
    
    // 获取价格和购票链接
    let price = 0;
    let bookingUrl = null;
    let agentName = null;
    
    if (itinerary.pricing_options && itinerary.pricing_options.length > 0) {
      const pricingOption = itinerary.pricing_options[0];
      const priceObj = pricingOption.price;
      if (priceObj) {
        price = priceObj.amount || 0;
      }
      
      // 提取购票链接 (Skyscanner deep link)
      if (pricingOption.items && pricingOption.items.length > 0) {
        const item = pricingOption.items[0];
        if (item.url) {
          bookingUrl = buildBookingUrl(item.url);
        }
        agentName = item.agent_id || null;
      }
    }
    
    // 解析 leg，使用传入的 currency 参数
    const flight = parseLeg(leg, segmentMap, placeMap, carrierMap, price, currency, bookingUrl, agentName);
    if (flight) flights.push(flight);
  }
  
  return flights.sort((a, b) => a.price - b.price);
}

/**
 * 解析单个 Leg
 */
function parseLeg(leg, segmentMap, placeMap, carrierMap, price, currency, bookingUrl, agentName) {
  if (!leg.segment_ids || leg.segment_ids.length === 0) return null;
  
  const firstSegment = segmentMap.get(leg.segment_ids[0]);
  const lastSegment = segmentMap.get(leg.segment_ids[leg.segment_ids.length - 1]);
  
  if (!firstSegment || !lastSegment) return null;
  
  const origin = placeMap.get(leg.origin_place_id);
  const destination = placeMap.get(leg.destination_place_id);
  const carrier = carrierMap.get(firstSegment.marketing_carrier_id);
  
  const departure = new Date(leg.departure);
  const arrival = new Date(leg.arrival);
  const durationMinutes = leg.duration || Math.round((arrival - departure) / (1000 * 60));
  
  return {
    airline: carrier?.display_code || carrier?.alt_id || 'Unknown',
    airlineName: carrier?.name || 'Unknown',
    flightNumber: firstSegment.flight_number || 
                  `${carrier?.display_code || ''}${firstSegment.marketing_flight_number || ''}`,
    aircraft: firstSegment.aircraft_type || '',
    departure: {
      airport: origin?.display_code || '',
      airportName: origin?.name || '',
      terminal: '',
      time: formatTime(departure),
      date: formatDate(departure),
      datetime: leg.departure
    },
    arrival: {
      airport: destination?.display_code || '',
      airportName: destination?.name || '',
      terminal: '',
      time: formatTime(arrival),
      date: formatDate(arrival),
      datetime: leg.arrival
    },
    duration: formatDuration(durationMinutes),
    durationMinutes: durationMinutes,
    stops: leg.stop_count || 0,
    price: Math.round(price),
    currency: currency || 'HKD',
    cabinClass: 'Economy',
    bookingUrl: bookingUrl,
    agentName: agentName
  };
}

/**
 * 构建完整购票链接
 * 将 Skyscanner 的相对路径转为完整 URL
 */
function buildBookingUrl(urlPath) {
  if (!urlPath) return null;
  
  // 如果是完整 URL，直接返回
  if (urlPath.startsWith('http')) {
    return urlPath;
  }
  
  // Skyscanner 购票链接
  return `https://www.skyscanner.com${urlPath}`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 5);
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * 测试 API 连接
 */
async function testConnection(apiKey) {
  try {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    
    const flights = await searchOneway({
      apiKey,
      from: 'HKG',
      to: 'NRT',
      date: formatDate(date),
      adults: 1,
      cabinClass: 'Economy',
      currency: 'CNY'
    });
    
    return {
      success: flights.length > 0,
      message: flights.length > 0 ? 
        `API connected. Found ${flights.length} sample flights.` : 
        'API connected but no flights found.',
      sample: flights.slice(0, 2)
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  searchOneway,
  testConnection,
  HK_EXPRESS_CODE,
  formatDate
};
