# Flight Check - HKG ↔ Tokyo Weekend Flights

监控香港飞东京周末航班价格，专找香港快运 (Hong Kong Express) 晚上 8 点后起飞的航班。

## Features

- 🔍 搜索未来 3 个月所有周末 (周五-周日) 的航班
- ✈️ 支持东京羽田 (HND) 和成田 (NRT) 两个机场的所有组合
- 🕐 只筛选晚上 20:00 后起飞的去程航班
- 📊 价格趋势图表 + 详细航班信息表格
- 🌤️ 东京天气预报 + 滑雪条件评级
- 📋 点击复制航班详情

## Tech Stack

- **Backend**: Node.js + Express
- **Crawler**: Python + Selenium (Chrome)
- **Frontend**: Vanilla JS + Chart.js

## Setup

```bash
# 1. 安装 Node 依赖
npm install

# 2. 安装 Python 依赖 (需要 Python 3.8+)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. 安装 Chrome/Chromium
# Ubuntu/Debian:
sudo apt-get install chromium-browser chromium-chromedriver

# 4. 启动服务器
npm start
```

访问 http://localhost:3000

## Project Structure

```
.
├── server.js              # Express 服务器
├── services/
│   ├── ctrip.js          # 携程爬虫 Node.js 封装
│   └── ctrip_crawler.py  # Selenium 爬虫
├── public/               # 前端静态文件
├── data/                 # 本地 JSON 数据存储
└── requirements.txt      # Python 依赖
```

## Data Source

- 航班数据：携程 (Ctrip) - 通过 Selenium 爬取
- 天气数据：Open-Meteo API (免费)

## Known Issues

- 携程有反爬机制，可能会被验证页面拦截
- 需要保持 Chrome 版本与 ChromeDriver 兼容

## License

MIT
