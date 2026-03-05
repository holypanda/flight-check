# 启用真实携程爬虫

## 1. 检查 Chrome 安装

```bash
# 检查 Chromium
which chromium-browser

# 检查版本
chromium-browser --version
```

## 2. 安装 Chrome WebDriver

```bash
# 下载与 Chrome 版本匹配的 WebDriver
# 例如 Chrome 120.x 对应 chromedriver 120.x

wget https://chromedriver.storage.googleapis.com/LATEST_RELEASE
wget https://chromedriver.storage.googleapis.com/$(cat LATEST_RELEASE)/chromedriver_linux64.zip
unzip chromedriver_linux64.zip
sudo mv chromedriver /usr/local/bin/
```

## 3. 测试爬虫

```bash
# 使用虚拟环境
cd /root/flight-check
source venv/bin/activate

# 测试单次搜索（非 mock 模式）
python3 services/ctrip_crawler.py --dates "2026-03-07/2026-03-09"
```

## 4. 常见问题

### 问题：SessionNotCreatedException
**解决**：Chrome 和 WebDriver 版本不匹配，需下载对应版本

### 问题：WebDriver 找不到 Chrome
**解决**：设置 Chrome 路径
```python
options.binary_location = '/usr/bin/chromium-browser'
```

### 问题：被反爬虫拦截
**解决**：
- 添加代理 IP
- 降低请求频率（增加 `time.sleep()`）
- 使用真实用户代理

## 5. 生产环境建议

对于生产环境，建议：

1. **使用专用爬虫服务器** - 有图形界面的环境更稳定
2. **定期更新 Cookie/User-Agent** - 避免被封
3. **添加重试机制** - 失败时自动重试
4. **监控和告警** - 爬虫失败时通知

## 当前配置

- Mock 模式：立即返回模拟数据（用于开发和测试）
- 真实模式：访问携程网站（需要额外配置）

修改 `services/ctrip.js` 中的 `callPythonCrawler()` 来切换模式。
