#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ctrip Flight Crawler - Simplified version for Node.js integration
爬取携程航班数据，输出 JSON 格式

Usage:
    python ctrip_crawler.py --from-city "香港" --to-city "东京" --from-code HKG --to-code HND --dates "2026-03-06,2026-03-13"

Output:
    JSON format compatible with the original Duffel API format
"""

import argparse
import json
import sys
import os
import time
import random
from datetime import datetime, timedelta

# User-Agent 轮换列表
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
]

# Try to import selenium dependencies
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    print("Warning: selenium not installed. Please run: pip install selenium", file=sys.stderr)


try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    print("Warning: pandas not installed. Please run: pip install pandas", file=sys.stderr)


class CtripCrawler:
    """携程航班数据爬虫"""
    
    # 筛选配置（可通过参数控制）
    DEFAULT_ALLOWED_AIRLINES = ['香港快运航空', 'Hong Kong Express', 'UO']
    
    def __init__(self, headless=True, max_wait_time=15, strict_filter=False, target_time=None, min_departure_time=None, min_return_time=None):
        self.headless = headless
        self.max_wait_time = max_wait_time
        self.strict_filter = strict_filter
        self.target_time = target_time
        self.min_departure_time = min_departure_time
        self.min_return_time = min_return_time
        self.driver = None
        self.results = []
        self.allowed_airlines = self.DEFAULT_ALLOWED_AIRLINES
        
    def init_driver(self):
        """初始化浏览器驱动"""
        options = webdriver.ChromeOptions()
        
        if self.headless:
            options.add_argument('--headless=new')
        
        # 基础参数
        options.add_argument('--incognito')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('--disable-extensions')
        options.add_argument('--disable-gpu')
        options.add_argument('--ignore-certificate-errors')
        options.add_argument('--window-size=1920,1080')
        
        # 随机 User-Agent
        user_agent = random.choice(USER_AGENTS)
        options.add_argument(f'--user-agent={user_agent}')
        print(f"Using User-Agent: {user_agent[:50]}...", file=sys.stderr)
        
        # 禁用自动化检测
        options.add_experimental_option('excludeSwitches', ['enable-automation', 'enable-logging'])
        options.add_experimental_option('useAutomationExtension', False)
        
        # 添加额外的隐私和反检测参数
        options.add_argument('--disable-features=IsolateOrigins,site-per-process')
        options.add_argument('--disable-site-isolation-trials')
        options.add_argument('--disable-web-security')
        options.add_argument('--disable-features=BlockInsecurePrivateNetworkRequests')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('--lang=zh-CN,zh,en-US,en')
        options.add_argument('--timezone=Asia/Shanghai')
        
        # Fix for snap Chromium / DevToolsActivePort error
        options.add_argument('--remote-debugging-pipe')  # 使用 pipe 而不是端口
        options.add_argument('--disable-setuid-sandbox')
        options.add_argument('--single-process')  # Required for running in container/snap environments
        
        # 额外的反爬参数
        options.add_argument('--disable-background-networking')
        options.add_argument('--disable-background-timer-throttling')
        options.add_argument('--disable-backgrounding-occluded-windows')
        options.add_argument('--disable-breakpad')
        options.add_argument('--disable-component-update')
        options.add_argument('--disable-default-apps')
        options.add_argument('--disable-features=TranslateUI')
        options.add_argument('--disable-hang-monitor')
        options.add_argument('--disable-ipc-flooding-protection')
        options.add_argument('--disable-popup-blocking')
        options.add_argument('--disable-prompt-on-repost')
        options.add_argument('--disable-renderer-backgrounding')
        options.add_argument('--force-color-profile=srgb')
        options.add_argument('--metrics-recording-only')
        options.add_argument('--no-first-run')
        options.add_argument('--safebrowsing-disable-auto-update')
        options.add_argument('--password-store=basic')
        options.add_argument('--use-mock-keychain')
        
        # 检测 Chrome/Chromium 路径
        # 注意：snap 安装的 Chromium 必须使用 /snap/bin/chromium 包装器命令
        chrome_paths = [
            '/snap/bin/chromium',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/snap/chromium/current/usr/lib/chromium-browser/chrome',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ]
        
        chrome_binary = None
        for path in chrome_paths:
            if os.path.exists(path):
                chrome_binary = path
                print(f"Found Chrome at: {path}", file=sys.stderr)
                break
        
        if chrome_binary:
            options.binary_location = chrome_binary
        else:
            print("Warning: Chrome binary not found in common locations, using default", file=sys.stderr)
        
        try:
            self.driver = webdriver.Chrome(options=options)
            
            # 使用 CDP 隐藏 webdriver 特征
            self.driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
                'source': '''
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5]
                    });
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['zh-CN', 'zh', 'en-US', 'en']
                    });
                    window.chrome = { runtime: {} };
                '''
            })
            
            # 修改 webdriver 属性
            self.driver.execute_script('''
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            ''')
            
            if not self.headless:
                self.driver.maximize_window()
            print("Chrome driver initialized successfully", file=sys.stderr)
        except Exception as e:
            print(f"Failed to initialize Chrome driver: {e}", file=sys.stderr)
            raise
        
    def close(self):
        """关闭浏览器"""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
            self.driver = None
            
    def search_flights(self, from_city, to_city, from_code, to_code, date):
        """
        搜索指定日期的航班
        
        Args:
            from_city: 出发城市名（如"香港"）
            to_city: 目的城市名（如"东京"）
            from_code: 出发机场代码（如"HKG"）
            to_code: 目的机场代码（如"HND"）
            date: 出发日期（格式：YYYY-MM-DD）
            
        Returns:
            list: 航班信息列表
        """
        if not self.driver:
            self.init_driver()
            
        flights = []
        
        try:
            # 使用直接搜索URL（机场代码格式）
            url = f"https://flights.ctrip.com/online/list/oneway-{from_code}-{to_code}?depdate={date}"
            print(f"Accessing: {url}", file=sys.stderr)
            
            # 添加随机延迟，模拟真实用户 (3-8秒随机延迟)
            delay = random.uniform(3, 8)
            print(f"Waiting {delay:.1f}s before request...", file=sys.stderr)
            time.sleep(delay)
            
            # 清理缓存和 cookies
            self.driver.delete_all_cookies()
            
            self.driver.get(url)
            
            # 页面加载后再次执行反检测脚本
            self._hide_automation_features()
            
            # 等待航班列表加载
            try:
                WebDriverWait(self.driver, 30).until(
                    EC.presence_of_element_located((By.CLASS_NAME, "flight-item"))
                )
                print(f"Flight list loaded for {date}", file=sys.stderr)
            except Exception as e:
                print(f"Timeout waiting for flight list: {e}", file=sys.stderr)
                # 再试一次
                print("Retrying...", file=sys.stderr)
                time.sleep(5)
                self.driver.refresh()
                try:
                    WebDriverWait(self.driver, 30).until(
                        EC.presence_of_element_located((By.CLASS_NAME, "flight-item"))
                    )
                    print(f"Flight list loaded on retry for {date}", file=sys.stderr)
                except:
                    # 保存调试信息
                    debug_html = f"/tmp/ctrip_debug_{date}.html"
                    with open(debug_html, 'w', encoding='utf-8') as f:
                        f.write(self.driver.page_source)
                    print(f"Debug HTML saved to {debug_html}", file=sys.stderr)
                    return flights
            
            # 额外等待确保数据加载
            time.sleep(5)
            
            # 尝试关闭弹窗
            self._close_popups()
            
            # 如果只搜索香港快运航空，尝试点击筛选器
            if self.allowed_airlines and len(self.allowed_airlines) == 1 and '香港快运' in self.allowed_airlines[0]:
                self._filter_by_airline('香港快运')
            
            # 获取航班数据
            flights = self._extract_flight_data(from_city, to_city, from_code, to_code, date)
            print(f"Extracted {len(flights)} flights for {date}", file=sys.stderr)
            
        except Exception as e:
            print(f"Error searching flights for {date}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            
        return flights
    
    def _hide_automation_features(self):
        """隐藏自动化特征，避免被检测"""
        try:
            self.driver.execute_script('''
                // 覆盖 webdriver 属性
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // 添加假的 plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        return [
                            {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'},
                            {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai'},
                            {name: 'Native Client', filename: 'internal-nacl-plugin'}
                        ];
                    }
                });
                
                // 覆盖 permissions
                if (navigator.permissions) {
                    const originalQuery = navigator.permissions.query;
                    navigator.permissions.query = (parameters) => {
                        if (parameters.name === 'notifications') {
                            return Promise.resolve({state: 'prompt'});
                        }
                        return originalQuery(parameters);
                    };
                }
                
                // 添加 chrome 对象
                window.chrome = window.chrome || {};
                window.chrome.runtime = window.chrome.runtime || {};
                
                // 覆盖 notification 权限
                if (window.Notification) {
                    Object.defineProperty(Notification, 'permission', {
                        get: () => 'default'
                    });
                }
            ''')
        except Exception as e:
            print(f"Error hiding automation features: {e}", file=sys.stderr)
    
    def _close_popups(self):
        """关闭弹窗和广告"""
        try:
            js_close = """
                var loginModals = document.querySelectorAll('.lg_loginbox_modal, .modal, .dialog');
                loginModals.forEach(function(el) { el.style.display = 'none'; });
                var ads = document.querySelectorAll('.ad, .advertisement, .notice-box');
                ads.forEach(function(el) { el.remove(); });
                var overlays = document.querySelectorAll('.overlay, .mask, [class*="overlay"]');
                overlays.forEach(function(el) { el.style.display = 'none'; });
            """
            self.driver.execute_script(js_close)
        except:
            pass
    
    def _filter_by_airline(self, airline_name):
        """通过页面筛选器选择指定航空公司"""
        try:
            print(f"Trying to filter by airline: {airline_name}", file=sys.stderr)
            
            # 尝试找到航空公司筛选区域并点击
            # 常见的选择器模式
            airline_selectors = [
                # 航空公司筛选标题
                "//div[contains(text(), '航空公司') or contains(@class, 'airline-filter')]",
                "//span[contains(text(), '航空公司')]",
                # 香港快运航空复选框
                "//span[contains(text(), '香港快运') or contains(text(), 'UO')]/ancestor::label",
                "//div[contains(text(), '香港快运') or contains(text(), 'UO')]",
                # 更多选择器
                "//*[contains(@class, 'filter-airline')]",
            ]
            
            # 先尝试展开筛选器（如果需要）
            for selector in airline_selectors[:2]:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    for elem in elements:
                        if elem.is_displayed():
                            elem.click()
                            print(f"Clicked airline filter section", file=sys.stderr)
                            time.sleep(1)
                            break
                except:
                    continue
            
            # 尝试点击香港快运航空选项
            hk_express_selectors = [
                "//span[contains(text(), '香港快运') or contains(text(), 'UO')]/ancestor::label//input",
                "//span[contains(text(), '香港快运') or contains(text(), 'UO')]/preceding-sibling::input",
                "//div[contains(text(), '香港快运')]",
                "//label[contains(., '香港快运')]//input",
            ]
            
            for selector in hk_express_selectors:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    for elem in elements:
                        if elem.is_displayed() and not elem.is_selected():
                            elem.click()
                            print(f"Selected Hong Kong Express filter", file=sys.stderr)
                            time.sleep(2)  # 等待页面刷新
                            return True
                except Exception as e:
                    continue
            
            print("Could not find airline filter, will filter results manually", file=sys.stderr)
            return False
            
        except Exception as e:
            print(f"Error filtering by airline: {e}", file=sys.stderr)
            return False
    
    def _extract_flight_data(self, from_city, to_city, from_code, to_code, date):
        """提取航班数据"""
        flights = []
        
        try:
            # 获取页面源码中的数据
            page_source = self.driver.page_source
            
            # 尝试从页面中提取 JSON 数据
            if 'window.__INITIAL_STATE__' in page_source:
                try:
                    import re
                    match = re.search(r'window\.__INITIAL_STATE__\s*=\s*({.+?});', page_source)
                    if match:
                        data = json.loads(match.group(1))
                        flights.extend(self._parse_initial_state(data, from_city, to_city, from_code, to_code, date))
                except Exception as e:
                    print(f"Error parsing INITIAL_STATE: {e}", file=sys.stderr)
            
            # 如果上面的方法失败，尝试直接解析 DOM 元素
            if not flights:
                flights.extend(self._parse_dom_flights(from_city, to_city, from_code, to_code, date))
                
        except Exception as e:
            print(f"Error extracting flight data: {e}", file=sys.stderr)
            
        return flights
    
    def _is_allowed_airline(self, airline_name):
        """检查航空公司是否在允许列表中"""
        if self.allowed_airlines is None:
            return True
        if not airline_name:
            return False
        airline_name = str(airline_name).strip()
        for allowed in self.allowed_airlines:
            if allowed.lower() in airline_name.lower():
                return True
        return False
    
    def _is_exact_time(self, departure_time):
        """检查出发时间是否符合目标时间"""
        if self.target_time is None:
            return True
        if not departure_time:
            return False
        try:
            time_str = str(departure_time).strip()
            if ' ' in time_str:
                time_str = time_str.split(' ')[1]
            time_parts = time_str.split(':')
            hour_minute = f"{time_parts[0]}:{time_parts[1]}"
            return hour_minute == self.target_time
        except:
            return False
    
    def _parse_time(self, time_str):
        """将时间字符串解析为分钟数（用于比较）"""
        try:
            time_str = str(time_str).strip()
            if ' ' in time_str:
                time_str = time_str.split(' ')[1]
            time_parts = time_str.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            return hour * 60 + minute
        except:
            return 0
    
    def _is_after_min_time(self, departure_time, min_time, include_early_morning=True):
        """检查出发时间是否在指定时间之后"""
        if min_time is None:
            return True
        if not departure_time:
            return False
        try:
            departure_minutes = self._parse_time(departure_time)
            min_minutes = self._parse_time(min_time)
            
            if include_early_morning:
                early_morning_end = 6 * 60
                if departure_minutes < early_morning_end:
                    return True
            
            return departure_minutes >= min_minutes
        except:
            return False
    
    def _parse_initial_state(self, data, from_city, to_city, from_code, to_code, date):
        """解析页面初始状态数据"""
        flights = []
        
        try:
            # 尝试不同的数据路径
            flight_list = None
            
            if 'flightList' in data:
                flight_list = data['flightList']
            elif 'searchResult' in data and 'flightList' in data['searchResult']:
                flight_list = data['searchResult']['flightList']
            elif 'data' in data and 'flightItineraryList' in data['data']:
                flight_list = data['data']['flightItineraryList']
            
            if not flight_list:
                return flights
            
            for item in flight_list:
                try:
                    # 处理不同的数据结构
                    if 'flightSegments' in item:
                        segments = item['flightSegments'][0]
                        flight_list_detail = segments.get('flightList', [])
                        if flight_list_detail:
                            flight = flight_list_detail[0]
                        else:
                            continue
                    else:
                        flight = item
                    
                    # 提取航空公司名称
                    airline = flight.get('marketAirlineName', flight.get('airlineName', 'Unknown'))
                    
                    # 筛选：只保留香港航空
                    if not self._is_allowed_airline(airline):
                        continue
                    
                    # 提取出发时间
                    departure_time = flight.get('departureDateTime', '')
                    
                    # 筛选指定时间的航班
                    if not self._is_exact_time(departure_time):
                        continue
                    
                    # 提取价格信息
                    price = self._extract_price(item)
                    
                    # 构建航班信息
                    flight_no = flight.get('flightNo', flight.get('flightNumber', 'Unknown'))
                    
                    # 生成携程购票链接
                    booking_url = f"https://flights.ctrip.com/online/list/oneway-{from_city}-{to_city}?depdate={date}"
                    
                    flight_info = {
                        'route': f"{from_code}-{to_code}",
                        'from': from_code,
                        'to': to_code,
                        'price': price,
                        'currency': 'CNY',
                        'date': date,
                        'returnDate': None,
                        'airline': airline,
                        'flightNumber': flight_no,
                        'departureTime': departure_time,
                        'arrivalTime': flight.get('arrivalDateTime', ''),
                        'duration': flight.get('duration', ''),
                        'fromCity': from_city,
                        'toCity': to_city,
                        'fromAirport': flight.get('departureAirportName', ''),
                        'toAirport': flight.get('arrivalAirportName', ''),
                        'stopCount': flight.get('stopCount', 0),
                        'aircraft': flight.get('aircraftName', ''),
                        'bookingUrl': booking_url,
                    }
                    
                    flights.append(flight_info)
                    
                except Exception as e:
                    print(f"Error parsing flight item: {e}", file=sys.stderr)
                    continue
                    
        except Exception as e:
            print(f"Error in _parse_initial_state: {e}", file=sys.stderr)
            
        return flights
    
    def _extract_price(self, item):
        """提取价格信息"""
        try:
            if 'priceList' in item and item['priceList']:
                prices = item['priceList']
                economy_prices = [p for p in prices if p.get('cabin') == 'Y']
                if economy_prices:
                    min_price = min(economy_prices, key=lambda x: x.get('adultPrice', float('inf')))
                    return min_price.get('adultPrice', 0)
                return prices[0].get('adultPrice', 0)
            elif 'price' in item:
                return item['price']
        except:
            pass
        return 0
    
    def _parse_dom_flights(self, from_city, to_city, from_code, to_code, date):
        """通过 DOM 元素解析航班数据"""
        flights = []
        import re
        
        try:
            # 查找所有航班元素
            flight_elements = self.driver.find_elements(By.CLASS_NAME, "flight-item")
            print(f"Found {len(flight_elements)} flight elements in DOM", file=sys.stderr)
            
            for elem in flight_elements:
                try:
                    # 获取元素文本内容
                    text = elem.text
                    lines = [l.strip() for l in text.split('\n') if l.strip()]
                    
                    if len(lines) < 5:
                        continue
                    
                    # 解析航空公司
                    airline = lines[0] if lines else "Unknown"
                    
                    # 解析航班号
                    flight_no = "Unknown"
                    aircraft = ""
                    for line in lines:
                        match = re.search(r'\b([A-Z]{2,3}\d{2,4})\b', line)
                        if match:
                            flight_no = match.group(1)
                            aircraft_match = re.search(r'([\u4e00-\u9fa5\w]+\([^)]+\))', line)
                            if aircraft_match:
                                aircraft = aircraft_match.group(1)
                            break
                    
                    # 解析时间
                    times = []
                    for line in lines:
                        time_matches = re.findall(r'(\d{2}:\d{2})', line)
                        times.extend(time_matches)
                    
                    departure_time = times[0] if len(times) > 0 else ""
                    arrival_time = times[1] if len(times) > 1 else ""
                    
                    # 解析价格
                    price = 0
                    for line in lines:
                        price_match = re.search(r'¥(\d+)', line.replace(',', ''))
                        if price_match:
                            price = int(price_match.group(1))
                            break
                    
                    # 解析时长
                    duration = ""
                    for line in lines:
                        duration_match = re.search(r'(\d+小时\d+分|\d+h\s*\d+m|\d+小时|\d+h)', line)
                        if duration_match:
                            duration = duration_match.group(1)
                            break
                    
                    # 解析机场信息
                    from_airport = ""
                    to_airport = ""
                    for line in lines:
                        if "机场" in line or "T1" in line or "T2" in line or "T3" in line:
                            if not from_airport:
                                from_airport = line
                            elif not to_airport:
                                to_airport = line
                                break
                    
                    # 生成携程购票链接
                    booking_url = f"https://flights.ctrip.com/online/list/oneway-{from_code}-{to_code}?depdate={date}"
                    
                    flight_info = {
                        'route': f"{from_code}-{to_code}",
                        'from': from_code,
                        'to': to_code,
                        'price': price,
                        'currency': 'CNY',
                        'date': date,
                        'returnDate': None,
                        'airline': airline,
                        'flightNumber': flight_no,
                        'departureTime': departure_time,
                        'arrivalTime': arrival_time,
                        'duration': duration,
                        'fromCity': from_city,
                        'toCity': to_city,
                        'fromAirport': from_airport,
                        'toAirport': to_airport,
                        'aircraft': aircraft,
                        'bookingUrl': booking_url,
                    }
                    
                    flights.append(flight_info)
                    print(f"  Parsed: {airline} {flight_no} {departure_time} ¥{price}", file=sys.stderr)
                    
                except Exception as e:
                    print(f"  Error parsing flight element: {e}", file=sys.stderr)
                    continue
                
        except Exception as e:
            print(f"Error in _parse_dom_flights: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            
        return flights
    
    def search_round_trip(self, from_city, to_city, from_code, to_code, depart_date, return_date, return_from_code=None):
        """
        搜索往返航班，计算往返总价
        
        筛选条件:
        - 去程必须在 20:00 之后出发
        - 返程必须在 20:00 之后出发
        """
        # 返程出发机场（默认和去程目的地相同）
        return_from = return_from_code or to_code
        
        filter_desc = "all airlines, all times" if not self.strict_filter else f"airlines: {self.allowed_airlines}, time: {self.target_time}"
        time_filter_desc = ""
        if self.min_departure_time:
            time_filter_desc += f", outbound after {self.min_departure_time}"
        if self.min_return_time:
            time_filter_desc += f", return after {self.min_return_time}"
        airport_desc = f"{from_code}->{to_code}, return from {return_from}"
        print(f"Searching {depart_date} ~ {return_date} - {airport_desc} - Filter: {filter_desc}{time_filter_desc}", file=sys.stderr)
        
        # 搜索去程
        outbound_flights = self.search_flights(from_city, to_city, from_code, to_code, depart_date)
        
        # 搜索返程（可能从不同的机场出发）
        return_flights = self.search_flights(to_city, from_city, return_from, from_code, return_date)
        
        # 记录筛选前的数量
        print(f"  Found {len(outbound_flights)} outbound flights, {len(return_flights)} return flights", file=sys.stderr)
        
        # 筛选符合条件的航班（航空公司过滤）
        outbound_flights = [f for f in outbound_flights if self._is_allowed_airline(f.get('airline'))]
        return_flights = [f for f in return_flights if self._is_allowed_airline(f.get('airline'))]
        
        # 筛选指定时间的航班（如果指定了目标时间）
        if self.target_time:
            outbound_flights = [f for f in outbound_flights if self._is_exact_time(f.get('departureTime'))]
            return_flights = [f for f in return_flights if self._is_exact_time(f.get('departureTime'))]
        
        # 应用时间过滤（去程 20:00 之后，返程 20:00 之后）
        if self.min_departure_time:
            outbound_flights = [f for f in outbound_flights if self._is_after_min_time(f.get('departureTime'), self.min_departure_time)]
        if self.min_return_time:
            return_flights = [f for f in return_flights if self._is_after_min_time(f.get('departureTime'), self.min_return_time)]
        
        print(f"  After filtering: {len(outbound_flights)} outbound, {len(return_flights)} return flights", file=sys.stderr)
        
        if not outbound_flights:
            print(f"  No outbound flights found for {depart_date} (after 20:00 filter)", file=sys.stderr)
            return None
        if not return_flights:
            print(f"  No return flights found for {return_date} (after 20:00 filter)", file=sys.stderr)
            return None
        
        # 计算最低往返价格
        min_outbound = min([f['price'] for f in outbound_flights if f['price'] > 0], default=0)
        min_return = min([f['price'] for f in return_flights if f['price'] > 0], default=0)
        
        total_price = min_outbound + min_return if min_outbound and min_return else 0
        
        # 选择最低价航班组合
        best_outbound = None
        best_return = None
        
        for f in outbound_flights:
            if f['price'] == min_outbound:
                best_outbound = f
                break
                
        for f in return_flights:
            if f['price'] == min_return:
                best_return = f
                break
        
        if best_outbound:
            result = best_outbound.copy()
            result['returnDate'] = return_date
            result['returnPrice'] = min_return
            result['returnFlightNumber'] = best_return['flightNumber'] if best_return else None
            result['returnAirline'] = best_return['airline'] if best_return else None
            result['returnDepartureTime'] = best_return['departureTime'] if best_return else None
            result['returnArrivalTime'] = best_return['arrivalTime'] if best_return else None
            result['returnDuration'] = best_return['duration'] if best_return else None
            result['returnBookingUrl'] = best_return['bookingUrl'] if best_return else None
            # 添加返程机场信息
            result['returnFromAirport'] = return_from
            result['returnToAirport'] = from_code
            # 如果返程机场和去程目的地不同，标记为混搭
            if return_from != to_code:
                result['mixedAirports'] = True
                result['route'] = f"{from_code}-{to_code}+{return_from}-{from_code}"
            result['totalPrice'] = total_price
            # 使用往返总价作为价格
            result['price'] = total_price
            # 生成往返组合购票链接（包含航班号参数）
            outbound_flight = best_outbound['flightNumber'] if best_outbound and best_outbound['flightNumber'] not in ['Unknown', None, ''] else ''
            return_flight = best_return['flightNumber'] if best_return and best_return['flightNumber'] not in ['Unknown', None, ''] else ''
            if outbound_flight and return_flight:
                result['bookingUrl'] = f"https://flights.ctrip.com/online/list/roundtrip-{from_city}-{to_city}?depdate={depart_date}_{return_date}&flightnos={outbound_flight},{return_flight}"
            elif outbound_flight:
                result['bookingUrl'] = f"https://flights.ctrip.com/online/list/roundtrip-{from_city}-{to_city}?depdate={depart_date}_{return_date}&flightnos={outbound_flight}"
            else:
                result['bookingUrl'] = f"https://flights.ctrip.com/online/list/roundtrip-{from_city}-{to_city}?depdate={depart_date}_{return_date}"
            airport_info = f"({return_from}→{from_code})" if return_from != to_code else ""
            print(f"  Selected: {result['flightNumber']} + {result['returnFlightNumber']}{airport_info} = CNY {total_price}", file=sys.stderr)
            return result
        
        return None


def get_target_dates(days=90):
    """获取未来指定天数的周五-周日日期对"""
    dates = []
    today = datetime.now()
    limit = today + timedelta(days=days)
    
    current = today
    
    # 找到下一个周五
    while current.weekday() != 4:  # Friday is 4
        current += timedelta(days=1)
    
    while current <= limit:
        departure = current.strftime('%Y-%m-%d')
        return_date = (current + timedelta(days=2)).strftime('%Y-%m-%d')  # Sunday
        
        dates.append({
            'depart': departure,
            'return': return_date
        })
        
        current += timedelta(days=7)
    
    return dates


def main():
    parser = argparse.ArgumentParser(description='Ctrip Flight Crawler')
    parser.add_argument('--from-city', default='香港', help='Departure city name')
    parser.add_argument('--to-city', default='东京', help='Destination city name')
    parser.add_argument('--from-code', default='HKG', help='Departure airport code')
    parser.add_argument('--to-code', default='HND', help='Destination airport code')
    parser.add_argument('--return-from-code', help='Return departure airport code (default: same as to-code)')
    parser.add_argument('--search-one-way', action='store_true', help='Search one-way flights only')
    parser.add_argument('--dates', help='Comma-separated dates (YYYY-MM-DD format)')
    parser.add_argument('--days', type=int, default=30, help='Number of days to search')
    parser.add_argument('--headless', action='store_true', default=True, help='Run in headless mode')
    parser.add_argument('--strict-filter', action='store_true', help='Enable strict filtering (Hong Kong Airlines only, specific time)')
    parser.add_argument('--hk-express-only', action='store_true', help='Search Hong Kong Express/UO flights only')
    parser.add_argument('--target-time', help='Target departure time (e.g., 23:55)')
    parser.add_argument('--min-departure-time', default='20:00', help='Minimum departure time for outbound flights (default: 20:00)')
    parser.add_argument('--min-return-time', default='20:00', help='Minimum departure time for return flights (default: 20:00')
    
    args = parser.parse_args()
    
    # 检查依赖
    if not SELENIUM_AVAILABLE:
        print(json.dumps({
            "error": "selenium not installed. Run: pip install selenium pandas",
            "timestamp": datetime.now().isoformat(),
            "prices": []
        }, ensure_ascii=False))
        return
    
    # 解析日期
    if args.dates:
        date_pairs = []
        for date_str in args.dates.split(','):
            date_str = date_str.strip()
            if '/' in date_str:
                depart, return_d = date_str.split('/')
                date_pairs.append({'depart': depart, 'return': return_d})
            else:
                depart = date_str
                return_d = (datetime.strptime(date_str, '%Y-%m-%d') + timedelta(days=2)).strftime('%Y-%m-%d')
                date_pairs.append({'depart': depart, 'return': return_d})
    else:
        date_pairs = get_target_dates(args.days)
    
    # 创建爬虫实例
    crawler = CtripCrawler(
        headless=args.headless, 
        strict_filter=args.strict_filter, 
        target_time=args.target_time,
        min_departure_time=args.min_departure_time,
        min_return_time=args.min_return_time
    )
    
    # 如果只搜索香港快运航空，设置航空公司筛选
    if args.hk_express_only:
        crawler.allowed_airlines = ['香港快运航空', 'Hong Kong Express', 'UO']
        print("Searching Hong Kong Express flights only", file=sys.stderr)
    
    # 返程出发机场（默认和去程目的地相同）
    return_from_code = args.return_from_code or args.to_code
    
    try:
        all_results = []
        
        for pair in date_pairs[:5]:  # 最多搜索5个周末
            try:
                print(f"Searching {pair['depart']} to {pair['return']}...", file=sys.stderr)
                
                if args.search_one_way:
                    if args.return_from_code:
                        result = crawler.search_flights(
                            args.to_city,
                            args.from_city,
                            return_from_code,
                            args.from_code,
                            pair['return']
                        )
                        for f in result:
                            f['isReturn'] = True
                            f['date'] = pair['return']
                        all_results.extend(result)
                    else:
                        result = crawler.search_flights(
                            args.from_city,
                            args.to_city,
                            args.from_code,
                            args.to_code,
                            pair['depart']
                        )
                        for f in result:
                            f['isOutbound'] = True
                            f['date'] = pair['depart']
                        all_results.extend(result)
                else:
                    result = crawler.search_round_trip(
                        args.from_city,
                        args.to_city,
                        args.from_code,
                        args.to_code,
                        pair['depart'],
                        pair['return'],
                        return_from_code
                    )
                    
                    if result:
                        all_results.append(result)
                        print(f"Found flight: {result['airline']} {result['flightNumber']} - CNY {result['price']}", file=sys.stderr)
                
                # 适当延迟，避免被封
                time.sleep(2)
                
            except Exception as e:
                print(f"Error processing date pair {pair}: {e}", file=sys.stderr)
                continue
        
        # 输出结果
        output = {
            "timestamp": datetime.now().isoformat(),
            "source": "ctrip",
            "prices": all_results
        }
        
        print(json.dumps(output, ensure_ascii=False))
        
    finally:
        crawler.close()


if __name__ == '__main__':
    main()
