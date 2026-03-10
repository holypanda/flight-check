/**
 * 航班搜索服务 - 使用 FlightAPI.io
 * 替代原来的 ctrip.js，提供更稳定的航班数据
 */

const flightApi = require('./flightapi');
const { getWeekendPairs, sleep } = require('./utils');

// 航线预设配置
const ROUTE_PRESETS = {
  'hkg-tokyo': {
    name: 'HKG ↔ 东京',
    origins: ['HKG'],
    destinations: ['HND', 'NRT'],
    currency: 'HKD',
    minDepartTime: '19:55',
    airlineCode: 'UO',
    airportNames: { HKG: '香港', HND: '羽田', NRT: '成田' }
  },
  'pek-hkg': {
    name: '北京 ↔ HKG',
    origins: ['PEK', 'PKX'],
    destinations: ['HKG'],
    currency: 'CNY',
    minDepartTime: '19:55',
    airlineCode: null,
    airportNames: { PEK: '首都', PKX: '大兴', HKG: '香港' }
  }
};

/**
 * 从航线预设生成机场组合和唯一路线
 */
function buildCombosFromPreset(preset) {
  const combos = [];
  const uniqueRouteSet = new Set();

  for (const origin of preset.origins) {
    for (const dest of preset.destinations) {
      // 直达：去程 origin→dest，返程 dest→origin
      combos.push({
        out: { from: origin, to: dest },
        ret: { from: dest, to: origin },
        name: `${origin} ↔ ${dest}`,
        type: 'direct'
      });
      uniqueRouteSet.add(`${origin}-${dest}`);
      uniqueRouteSet.add(`${dest}-${origin}`);
    }
  }

  // 混搭：多个 destination 时，去程到 A，返程从 B
  if (preset.destinations.length > 1) {
    for (const origin of preset.origins) {
      for (const destOut of preset.destinations) {
        for (const destRet of preset.destinations) {
          if (destOut === destRet) continue;
          combos.push({
            out: { from: origin, to: destOut },
            ret: { from: destRet, to: origin },
            name: `${origin}→${destOut} / ${destRet}→${origin}`,
            type: 'mixed',
            returnFrom: destRet
          });
          uniqueRouteSet.add(`${origin}-${destOut}`);
          uniqueRouteSet.add(`${destRet}-${origin}`);
        }
      }
    }
  }

  // 混搭：多个 origin 时，去程从 A，返程到 B
  if (preset.origins.length > 1) {
    for (const dest of preset.destinations) {
      for (const originOut of preset.origins) {
        for (const originRet of preset.origins) {
          if (originOut === originRet) continue;
          combos.push({
            out: { from: originOut, to: dest },
            ret: { from: dest, to: originRet },
            name: `${originOut}→${dest} / ${dest}→${originRet}`,
            type: 'mixed',
            returnFrom: dest
          });
          uniqueRouteSet.add(`${originOut}-${dest}`);
          uniqueRouteSet.add(`${dest}-${originRet}`);
        }
      }
    }
  }

  const uniqueRoutes = Array.from(uniqueRouteSet).map(key => {
    const [from, to] = key.split('-');
    return { from, to };
  });

  return { combos, uniqueRoutes };
}

/**
 * 并发池：限制最大并发数执行异步任务
 * @param {Array} tasks - 任务列表
 * @param {number} concurrency - 最大并发数
 * @param {Function} fn - 异步执行函数
 */
async function runWithConcurrency(tasks, concurrency, fn) {
  const executing = new Set();
  for (const task of tasks) {
    const p = fn(task).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

/**
 * 搜索周末航班（周五出发，周日返回）
 *
 * 优化策略：
 * - 去重：4 个机场组合只需 4 个唯一 API 调用（HKG↔HND, HKG↔NRT 的去程/返程）
 * - 并发：利用 FlightAPI 5 并发上限，用并发池跨周末流水线执行
 * - 原来 N 个周末需要 8N 次顺序请求，现在只需 4N 次请求通过 5 并发池处理
 */
async function searchWeekendFlights(config, days = 30, routeId = 'hkg-tokyo', airlineOverride) {
  const { apiKey } = config;

  if (!apiKey) {
    throw new Error('FlightAPI key is required. Please add it to data/config.json');
  }

  const preset = ROUTE_PRESETS[routeId];
  if (!preset) {
    throw new Error(`Unknown route: ${routeId}`);
  }

  const { combos: ALL_COMBOS, uniqueRoutes: UNIQUE_ROUTES } = buildCombosFromPreset(preset);
  const { currency, minDepartTime } = preset;
  // airlineOverride: undefined = use preset default, null = any airline, string = specific code
  const airlineCode = airlineOverride !== undefined ? airlineOverride : preset.airlineCode;
  const origins = new Set(preset.origins);

  console.log(`[FlightSearch] Starting search for route "${preset.name}" (${routeId})`);
  console.log(`[FlightSearch] Currency: ${currency}, Airline: ${airlineCode || 'any'}, MinTime: ${minDepartTime}`);

  const weekendPairs = getWeekendPairs(days);
  console.log(`[FlightSearch] Found ${weekendPairs.length} weekend pairs`);

  // Step 1: 生成所有唯一搜索任务（去重）
  const searchTasks = [];
  for (const { friday, sunday } of weekendPairs) {
    for (const route of UNIQUE_ROUTES) {
      // 去程：from 在 origins 中 → 用周五日期；否则是返程 → 用周日日期
      const isOutbound = origins.has(route.from);
      const date = isOutbound ? friday : sunday;
      searchTasks.push({
        from: route.from,
        to: route.to,
        date,
        key: `${route.from}-${route.to}-${date}`
      });
    }
  }

  console.log(`[FlightSearch] Total unique API calls: ${searchTasks.length} (${weekendPairs.length} weekends × ${UNIQUE_ROUTES.length} routes, concurrency=5)`);

  // Step 2: 用并发池执行所有搜索（最多 5 并发）
  const results = new Map();
  let completed = 0;

  await runWithConcurrency(searchTasks, 5, async (task) => {
    const flights = await flightApi.searchOneway({
      apiKey,
      from: task.from,
      to: task.to,
      date: task.date,
      adults: 1,
      cabinClass: 'Economy',
      currency: currency
    });
    results.set(task.key, flights);
    completed++;
    if (completed % UNIQUE_ROUTES.length === 0) {
      console.log(`[FlightSearch] Progress: ${completed}/${searchTasks.length} API calls completed`);
    }
  });

  console.log(`[FlightSearch] All ${searchTasks.length} API calls completed, combining results...`);

  // Step 3: 用缓存的搜索结果组合所有机场组合，找每个周末最便宜的
  const allResults = [];

  for (const { friday, sunday } of weekendPairs) {
    console.log(`\n[FlightSearch] Evaluating ${friday} -> ${sunday}`);

    let bestRoute = null;

    for (const combo of ALL_COMBOS) {
      const outKey = `${combo.out.from}-${combo.out.to}-${friday}`;
      const retKey = `${combo.ret.from}-${combo.ret.to}-${sunday}`;
      const outboundFlights = results.get(outKey) || [];
      const returnFlights = results.get(retKey) || [];

      // 筛选航班
      const filteredOutbound = outboundFlights.filter(f => {
        const matchAirline = airlineCode ? f.airline === airlineCode : true;
        const matchTime = minDepartTime ? f.departure.time >= minDepartTime : true;
        return matchAirline && matchTime;
      });

      if (filteredOutbound.length === 0) {
        console.log(`  [${combo.name}] No matching outbound flights on ${friday}`);
        continue;
      }

      const filteredReturn = returnFlights.filter(f => {
        const matchAirline = airlineCode ? f.airline === airlineCode : true;
        const matchTime = minDepartTime ? f.departure.time >= minDepartTime : true;
        return matchAirline && matchTime;
      });

      if (filteredReturn.length === 0) {
        console.log(`  [${combo.name}] No matching return flights on ${sunday}`);
        continue;
      }

      // 取最便宜的去程和返程组合
      const cheapestOutbound = filteredOutbound.sort((a, b) => a.price - b.price)[0];
      const cheapestReturn = filteredReturn.sort((a, b) => a.price - b.price)[0];
      const totalPrice = cheapestOutbound.price + cheapestReturn.price;

      console.log(`  [${combo.name}] Found: Outbound $${cheapestOutbound.price}, Return $${cheapestReturn.price}, Total $${totalPrice}`);

      const routeData = convertToFrontendFormat(
        cheapestOutbound,
        cheapestReturn,
        combo.out.from,
        combo.out.to,
        friday,
        sunday,
        totalPrice,
        combo.type,
        combo.returnFrom || null,
        preset.airportNames
      );

      if (!bestRoute || totalPrice < bestRoute.price) {
        bestRoute = routeData;
      }
    }

    if (bestRoute) {
      allResults.push(bestRoute);
    } else {
      console.log(`  No valid flights found for this weekend`);
    }
  }

  console.log(`\n[FlightSearch] Completed. Found ${allResults.length} weekend options`);
  return allResults;
}

/**
 * 转换为前端期望的数据格式
 */
function convertToFrontendFormat(outbound, returnFlight, fromAirport, toAirport, departDate, returnDate, totalPrice, routeType = 'direct', returnFromAirport = null, airportNames = {}) {
  // 判断是否为混搭航线
  const isMixed = routeType === 'mixed';
  const returnAirportCode = isMixed ? returnFromAirport : toAirport;

  // 构建路线显示名称
  let routeDisplay;
  if (isMixed) {
    routeDisplay = `${fromAirport}→${toAirport} / ${returnFromAirport}→${fromAirport}`;
  } else {
    routeDisplay = `${fromAirport}↔${toAirport}`;
  }

  const nameOf = (code) => airportNames[code] || code;

  return {
    // 基础信息
    route: routeDisplay,
    routeType: routeType, // 'direct' 或 'mixed'
    date: departDate,
    returnDate: returnDate,

    // 价格
    price: totalPrice,
    currency: outbound.currency || 'HKD',

    // 去程信息
    outboundAirport: toAirport,
    outboundAirportName: nameOf(toAirport),
    fromAirport: fromAirport,
    fromAirportName: nameOf(fromAirport),
    flightNumber: outbound.flightNumber,
    departureTime: outbound.departure.time,
    arrivalTime: outbound.arrival.time,

    // 返程信息
    returnAirport: returnAirportCode,
    returnAirportName: nameOf(returnAirportCode),
    returnToAirport: fromAirport,
    returnToAirportName: nameOf(fromAirport),
    returnFlightNumber: returnFlight.flightNumber,
    returnDepartureTime: returnFlight.departure.time,
    returnArrivalTime: returnFlight.arrival.time,

    // 其他信息（使用去程航空公司，如混搭可能是不同航空公司）
    airline: outbound.airlineName || 'Unknown',
    airlineCode: outbound.airline || 'Unknown',
    aircraft: outbound.aircraft,
    duration: outbound.duration,
    returnDuration: returnFlight.duration,
    stops: outbound.stops,
    returnStops: returnFlight.stops,

    // 购票链接 (优先使用往返程中可用的链接)
    bookingUrl: outbound.bookingUrl || returnFlight.bookingUrl || null,
    outboundBookingUrl: outbound.bookingUrl || null,
    returnBookingUrl: returnFlight.bookingUrl || null,
    agentName: outbound.agentName || returnFlight.agentName || null,

    // 原始数据保留
    outboundDetails: outbound,
    returnDetails: returnFlight
  };
}

/**
 * 测试 API 连接
 */
async function testConnection(apiKey) {
  return flightApi.testConnection(apiKey);
}

module.exports = {
  searchWeekendFlights,
  testConnection,
  ROUTE_PRESETS
};
