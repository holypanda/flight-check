# Flight Check - 周末航班价格监控器

智能追踪香港/北京往返东京最便宜的红眼航班，附带越后汤泽滑雪场天气与雪况评级。专为周末短途滑雪旅行设计。

## 功能特性

- **多航线支持**: HKG ↔ 东京（羽田/成田）、北京（首都/大兴） ↔ HKG，包括混搭机场往返组合
- **智能搜索**: 自动生成周五出发、周日返回的所有周末日期对，跨机场组合寻找最低价
- **筛选条件**: 可按航司（默认香港快运 UO）、出发时间（19:55 后红眼航班）、搜索月份范围（1-12 个月）灵活配置
- **并发优化**: 去重 API 调用 + 5 并发池，将 8N 次顺序请求降为 4N 次并发请求
- **价格趋势图**: Chart.js 折线图展示各周末价格走势，最低价高亮标记
- **雪况评级**: 集成 Open-Meteo 天气 API，对越后汤泽的温度、降雪量、天气状况进行 5 级评分
- **一键复制**: 点击表格行即可复制航班信息文本，方便分享
- **购票直达**: Skyscanner 深度链接，直接跳转预订页面
- **桌面通知**: 搜索完成后浏览器推送通知，无需盯着页面等待
- **历史快照**: 保留最近 100 次搜索结果，可切换查看和对比历史数据

## 技术架构

```
Frontend (public/)        Express API (server.js)        Services
┌──────────────┐         ┌──────────────────┐          ┌─────────────────┐
│ Vanilla JS   │────────>│ /api/refresh     │─────────>│ flightSearch.js │
│ Chart.js     │         │ /api/prices      │          │   ├─ flightapi.js ──> FlightAPI.io
│ 中文 UI      │<────────│ /api/config      │          │   └─ utils.js
│              │         │ /api/weather     │─────────>│ weather.js ────────> Open-Meteo API
└──────────────┘         │ /api/test-conn   │          │ storage.js ────────> data/*.json
                         └──────────────────┘          └─────────────────┘
```

| 模块 | 职责 |
|------|------|
| `server.js` | Express 服务器，提供 REST API 和静态文件服务 |
| `services/flightSearch.js` | 搜索编排：生成机场组合、去重、并发调用、筛选、取最低价 |
| `services/flightapi.js` | FlightAPI.io 客户端，解析 Skyscanner 风格响应（itineraries/legs/segments/places/carriers） |
| `services/weather.js` | Open-Meteo 天气预报，WMO 天气码解读，雪况评分算法 |
| `services/storage.js` | JSON 文件持久化（`data/prices.json`、`data/config.json`），最多保留 100 条快照 |
| `services/scheduler.js` | Cron 调度器（当前已禁用，仅手动触发） |
| `services/utils.js` | 工具函数：周末日期对生成、sleep |
| `public/` | 前端：航班表格、价格图表、复制/分享、筛选控件 |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 获取 FlightAPI Key

前往 [flightapi.io](https://www.flightapi.io/) 注册并获取 API Key。

可通过 Web UI 输入，也可以手动创建配置文件：

```bash
mkdir -p data
echo '{"flightApiKey": "你的API Key"}' > data/config.json
```

### 3. 启动服务

```bash
npm start
```

打开浏览器访问 `http://localhost:3000`，输入 API Key 后点击「更新价格」开始搜索。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/prices` | 获取所有历史价格快照 |
| `DELETE` | `/api/prices/:id` | 删除指定快照 |
| `GET` | `/api/config` | 查看 API Key 配置状态（返回脱敏 Key） |
| `POST` | `/api/config` | 保存并验证 API Key |
| `DELETE` | `/api/config` | 移除 API Key |
| `POST` | `/api/refresh` | 触发航班搜索（支持 body 参数：`months`、`route`、`airline`） |
| `GET` | `/api/weather?dates=YYYY-MM-DD,...` | 获取指定日期的越后汤泽天气 |
| `POST` | `/api/test-connection` | 测试 API Key 有效性 |

### 搜索参数示例

```bash
# 搜索 HKG↔东京，未来 3 个月，仅香港快运
curl -X POST http://localhost:3000/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"months": 3, "route": "hkg-tokyo", "airline": "UO"}'

# 搜索北京↔HKG，未来 1 个月，不限航司
curl -X POST http://localhost:3000/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"months": 1, "route": "pek-hkg", "airline": null}'
```

## 搜索逻辑详解

1. **日期生成**: 根据搜索月份数，生成所有周五→周日的日期对
2. **机场组合**: 根据航线预设（如 HKG↔东京）生成所有机场组合，包括：
   - 直达：HKG↔HND、HKG↔NRT
   - 混搭：HKG→HND 去、NRT→HKG 回（反之亦然）
3. **去重调用**: 4 种组合实际只需 4 个唯一方向的 API 调用（HKG→HND、HND→HKG、HKG→NRT、NRT→HKG）
4. **并发执行**: 所有搜索任务通过 5 并发池执行，充分利用 FlightAPI 并发限制
5. **结果组合**: 将缓存的搜索结果按机场组合配对，筛选航司和出发时间，取每个周末的最低总价
6. **天气补充**: 用 Open-Meteo 获取出发日越后汤泽的天气预报和雪况评级

## 雪况评级算法

基于越后汤泽（新潟县）的天气数据，综合评分 0-100，映射为 5 个等级：

| 等级 | 分数 | 含义 |
|------|------|------|
| 5 | 80+ | 极佳 — 低温粉雪，大量降雪 |
| 4 | 65-79 | 很好 — 适合滑雪的温度和雪况 |
| 3 | 50-64 | 一般 — 温度偏高或降雪量少 |
| 2 | 30-49 | 较差 — 可能有湿雪或无新雪 |
| 1 | 0-29 | 很差 — 温度过高，不适合滑雪 |

评分因子：平均气温（-2°C 至 1°C 最优）、降雪量（>30cm 满分）、是否正在降雪。

## 项目结构

```
flight-check/
├── server.js                 # Express 服务器 & API 路由
├── package.json
├── services/
│   ├── flightSearch.js       # 周末航班搜索编排（航线预设、并发池、筛选组合）
│   ├── flightapi.js          # FlightAPI.io REST 客户端（含重试机制）
│   ├── weather.js            # Open-Meteo 天气 + 雪况评级
│   ├── storage.js            # JSON 文件读写（prices.json / config.json）
│   ├── scheduler.js          # Cron 调度器（已禁用）
│   ├── utils.js              # 周末日期对生成、sleep
│   ├── ctrip.js              # [已弃用] 携程爬虫
│   └── duffel.js             # [已弃用] Duffel API 客户端
├── public/
│   ├── index.html            # 主页面（中文 UI）
│   ├── script.js             # 前端逻辑（数据加载、图表、复制、通知）
│   └── style.css             # 响应式样式（移动端适配）
└── data/                     # 运行时数据（gitignore）
    ├── prices.json           # 价格历史快照
    └── config.json           # API Key 配置
```

## 注意事项

- FlightAPI.io 为付费服务，每次搜索约消耗 30-60 API credits
- 天气预报最多覆盖未来 16 天，超出范围的周末无天气数据
- 定时搜索已禁用以节省 API 额度，需手动点击按钮触发
- 数据存储在本地 JSON 文件中，最多保留 100 条快照

## License

MIT
