document.addEventListener('DOMContentLoaded', () => {
    const statusMessage = document.getElementById('status-message');
    const lastUpdatedSpan = document.getElementById('last-updated');
    const pricesTableBody = document.querySelector('#prices-table tbody');
    const historyList = document.getElementById('history-list');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshBtn2 = document.getElementById('refresh-btn-2');
    const apiKeyInput = document.getElementById('api-key-input');
    const keyInputGroup = document.getElementById('key-input-group');
    const keyDisplayGroup = document.getElementById('key-display-group');
    const maskedKeySpan = document.getElementById('masked-key');
    const removeKeyBtn = document.getElementById('remove-key-btn');
    const priceChartCtx = document.getElementById('priceChart').getContext('2d');

    let historyData = [];
    let chartInstance = null;
    let currentWeatherData = {};
    let isRefreshing = false; // 防止重复点击标志

    // Helper: Show status message
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status ${type}`;
        statusMessage.style.display = 'block';
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 3000);
    }

    // Helper: Format currency - 人民币不显示小数点
    const formatCurrency = (amount, currency = 'CNY') => {
        if (currency === 'CNY' || currency === 'RMB') {
            return '¥' + Math.round(amount).toLocaleString('zh-CN');
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    };

    // Helper: Format date
    const formatDate = (isoString) => {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN');
    };

    // Helper: Format short date (MM-DD)
    const formatShortDate = (d) => d ? d.substring(5) : '-';

    // Helper: Escape HTML for data attribute
    const escapeHtml = (text) => {
        if (!text) return '';
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
    };

    // Helper: Get weather icon HTML
    const getWeatherIcon = (weatherMain) => {
        const mainEmojiMap = {
            'Clear': '☀️',
            'Clouds': '☁️',
            'Fog': '🌫️',
            'Drizzle': '🌧️',
            'Rain': '🌧️',
            'Snow': '❄️',
            'Thunderstorm': '⛈️',
            'Unknown': '❓'
        };
        return mainEmojiMap[weatherMain] || '☀️';
    };

    // Helper: Format weather display
    const formatWeatherDisplay = (weather) => {
        if (!weather) return '-';
        
        const weatherMain = weather.weather?.main || 'Unknown';
        const temp = weather.temp?.day ?? weather.temp ?? '-';
        const icon = getWeatherIcon(weatherMain);
        let html = `<div class="weather-info">${icon} ${temp}°C`;
        
        // 雪况评级
        const snowCondition = weather.snowCondition;
        if (snowCondition) {
            const snowClass = getSnowRatingClass(snowCondition.level);
            const snowEmoji = getSnowRatingEmoji(snowCondition.level);
            html += `<br><span class="snow-rating ${snowClass}">${snowEmoji} ${snowCondition.description}</span>`;
        }
        
        html += '</div>';
        return html;
    };

    // Helper: Get snow rating class based on level
    const getSnowRatingClass = (level) => {
        const classMap = {
            5: 'excellent',   // 极佳
            4: 'good',        // 很好
            3: 'fair',        // 一般
            2: 'poor',        // 较差
            1: 'bad'          // 很差
        };
        return classMap[level] || 'unknown';
    };

    // Helper: Get snow rating emoji based on level
    const getSnowRatingEmoji = (level) => {
        const emojiMap = {
            5: '❄️❄️',   // 极佳
            4: '❄️',      // 很好
            3: '🌨️',     // 一般
            2: '💧',      // 较差
            1: '😞'       // 很差
        };
        return emojiMap[level] || '❓';
    };

    // Helper: Generate share text
    const generateShareText = (flight) => {
        const dateStr = `${formatShortDate(flight.date)} → ${formatShortDate(flight.returnDate)}`;
        const fromAirport = flight.fromAirport || 'HKG';
        const toAirport = flight.outboundAirport || 'HND';
        const returnFromAirport = flight.returnAirport || toAirport;
        const returnToAirport = flight.returnToAirport || fromAirport;

        // 判断是否为混搭航线
        const isMixed = flight.routeType === 'mixed' || toAirport !== returnFromAirport;

        const routeLabel = flight.route || `${fromAirport}↔${toAirport}`;
        let text;
        if (isMixed) {
            text = `✈️ ${routeLabel} 混搭往返机票\n`;
        } else {
            text = `✈️ ${routeLabel} 往返机票\n`;
        }
        text += `📅 ${dateStr}\n`;
        text += `🛫 去程: ${flight.flightNumber} ${fromAirport}→${toAirport} ${flight.departureTime}-${flight.arrivalTime}\n`;

        if (flight.returnFlightNumber) {
            text += `🛬 返程: ${flight.returnFlightNumber} ${returnFromAirport}→${returnToAirport} ${flight.returnDepartureTime}-${flight.returnArrivalTime}\n`;
        }

        text += `💰 总价: ${formatCurrency(flight.price, flight.currency).replace(/<[^>]*>/g, '')}\n`;
        const weather = currentWeatherData[flight.date];
        const snowDesc = weather?.snowCondition?.description || '暂无数据';
        text += `🌨️ 汤泽雪况: ${snowDesc}`;

        return text;
    };

    // Helper: Copy to clipboard
    const copyToClipboard = async (text, row) => {
        console.log('[Copy] Attempting to copy text:', text.substring(0, 50) + '...');
        
        try {
            // 方法1: 使用现代 Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                showStatus('✅ 航班信息已复制到剪贴板！', 'success');
            } else {
                // 方法2: 降级方案 - 使用 execCommand
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                
                if (success) {
                    showStatus('✅ 航班信息已复制到剪贴板！', 'success');
                } else {
                    throw new Error('execCommand copy failed');
                }
            }
            
            // 视觉反馈
            row.style.backgroundColor = '#d4edda';
            setTimeout(() => {
                row.style.backgroundColor = '';
            }, 800);
            
        } catch (err) {
            console.error('[Copy] Failed to copy:', err);
            showStatus('❌ 复制失败: ' + (err.message || '请手动复制'), 'error');
            
            // 如果复制失败，显示文本让用户手动复制
            console.log('[Copy] Text content:\n', text);
        }
    };

    // Render chart
    function renderChart(currentSnapshot) {
        if (chartInstance) {
            chartInstance.destroy();
        }

        // 过滤有效的航班数据
        const validPrices = (currentSnapshot.prices || []).filter(f => {
            return f.price && f.price > 0 && f.date;
        });

        if (validPrices.length === 0) {
            return;
        }

        const labels = validPrices.map(f => formatShortDate(f.date));
        const data = validPrices.map(f => f.price);
        const currency = validPrices[0]?.currency || 'CNY';
        
        const minPrice = Math.min(...data);
        const minPriceIndex = data.indexOf(minPrice);

        const pointBackgroundColors = data.map((_, index) => 
            index === minPriceIndex ? '#27ae60' : '#4a90e2'
        );
        const pointRadii = data.map((_, index) => 
            index === minPriceIndex ? 8 : 5
        );
        const pointHoverRadii = data.map((_, index) => 
            index === minPriceIndex ? 10 : 7
        );

        chartInstance = new Chart(priceChartCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `总价 (${currency})`,
                    data: data,
                    borderColor: '#4a90e2',
                    backgroundColor: 'rgba(74, 144, 226, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointBackgroundColor: pointBackgroundColors,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: pointRadii,
                    pointHoverRadius: pointHoverRadii
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '周末航班价格趋势（周五-周日）'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.parsed.y} ${currency}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: '价格'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '出发日期'
                        }
                    }
                }
            }
        });
    }

    // Render the prices table
    function renderTable(dataIndex) {
        pricesTableBody.innerHTML = '';

        if (!historyData || historyData.length === 0) {
            pricesTableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center;padding:40px;color:#666;">
                        <div style="font-size: 1.2em;margin-bottom:10px;">📭 暂无航班数据</div>
                        <div style="font-size: 0.9em;">点击上方 <strong style="color:#27ae60;">🔄 更新价格</strong> 按钮开始搜索</div>
                        <div style="font-size: 0.8em;color:#999;margin-top:10px;">每次搜索约消耗 30-60 API credits</div>
                    </td>
                </tr>`;
            return;
        }

        const currentSnapshot = historyData[dataIndex];
        const previousSnapshot = dataIndex > 0 ? historyData[dataIndex - 1] : null;
        
        currentWeatherData = currentSnapshot.weather || {};

        lastUpdatedSpan.textContent = formatDate(currentSnapshot.timestamp);

        renderChart(currentSnapshot);

        // 过滤有效的航班数据
        const validPrices = (currentSnapshot.prices || []).filter(f => {
            return f.price && f.price > 0 && f.flightNumber && f.returnFlightNumber;
        });

        if (validPrices.length === 0) {
            pricesTableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center;padding:40px;color:#666;">
                        <div style="font-size: 1.2em;margin-bottom:10px;">⚠️ 数据不完整</div>
                        <div style="font-size: 0.9em;">请重新点击 <strong style="color:#27ae60;">🔄 更新价格</strong> 按钮搜索</div>
                    </td>
                </tr>`;
            return;
        }

        // Find the cheapest flight
        const cheapestFlight = validPrices.reduce((min, flight) => 
            flight.price < min.price ? flight : min, validPrices[0]
        );

        validPrices.forEach((flight, index) => {
            const row = document.createElement('tr');

            const fromAirport = flight.fromAirport || 'HKG';
            const toAirport = flight.outboundAirport || 'HND';
            const returnFromAirport = flight.returnAirport || toAirport;
            const returnToAirport = flight.returnToAirport || fromAirport;

            // 判断是否为混搭航线
            const isMixed = flight.routeType === 'mixed' || toAirport !== returnFromAirport;

            const dateDisplay = `${formatShortDate(flight.date)} ↓ ${formatShortDate(flight.returnDate)}`;

            const outboundStr = `${flight.flightNumber || '-'} ${fromAirport}→${toAirport} ${flight.departureTime || '-'}`;
            const returnStr = flight.returnFlightNumber ?
                `${flight.returnFlightNumber} ${returnFromAirport}→${returnToAirport} ${flight.returnDepartureTime || '-'}` :
                '-';

            const flightInfoDisplay = `
                <div class="flight-line">🛫 ${outboundStr}</div>
                <div class="flight-line">🛬 ${returnStr}</div>
            `;

            // 路线显示
            const toName = flight.outboundAirportName || toAirport;
            const fromName = flight.fromAirportName || fromAirport;
            let routeDisplay;
            if (isMixed) {
                const returnName = flight.returnAirportName || returnFromAirport;
                routeDisplay = `<strong>${fromName}→${toName}</strong><br><small style="color:#666;">/${returnName}→${fromName}</small>`;
            } else {
                routeDisplay = `<strong>${fromName}↔${toName}</strong>`;
            }

            const priceDisplay = formatCurrency(flight.price, flight.currency);

            const shareText = generateShareText(flight);

            if (flight === cheapestFlight) {
                row.classList.add('cheapest');
            }

            row.style.cursor = 'pointer';
            row.title = '点击复制航班信息';

            const weather = currentWeatherData[flight.date];
            const weatherDisplay = formatWeatherDisplay(weather);

            // 购票链接（先不设置onclick，后面用JS绑定）
            const hasBookingUrl = !!flight.bookingUrl;

            row.innerHTML = `
                <td class="col-route">${routeDisplay}</td>
                <td class="col-date">${dateDisplay}</td>
                <td class="col-flight">${flightInfoDisplay}</td>
                <td class="col-price">${priceDisplay}</td>
                <td class="col-weather">${weatherDisplay}</td>
                <td class="col-booking">
                    ${hasBookingUrl ? `<a href="${escapeHtml(flight.bookingUrl)}" target="_blank" class="booking-link js-booking-link" title="在 Skyscanner 上预订">🛒 预订</a>` : '<span style="color:#999;font-size:0.85em;">-</span>'}
                </td>
            `;

            // 绑定行点击事件（复制功能）
            row.addEventListener('click', (e) => {
                console.log('[Click] Row clicked, target:', e.target.tagName, e.target.className);
                
                // 如果点击的是购票链接，不触发复制
                if (e.target.closest('.js-booking-link')) {
                    console.log('[Click] Clicked on booking link, skipping copy');
                    return;
                }
                
                console.log('[Click] Triggering copy');
                copyToClipboard(shareText, row);
            });

            // 为购票链接单独绑定点击事件，阻止冒泡
            const bookingLink = row.querySelector('.js-booking-link');
            if (bookingLink) {
                bookingLink.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
            pricesTableBody.appendChild(row);
        });

        document.querySelectorAll('#history-list li').forEach((li, idx) => {
            if (idx === historyData.length - 1 - dataIndex) {
                li.classList.add('selected');
            } else {
                li.classList.remove('selected');
            }
        });
    }

    // Render history list
    function renderHistoryList() {
        historyList.innerHTML = '';
        [...historyData].reverse().forEach((snapshot, index) => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';

            const span = document.createElement('span');
            span.textContent = `记录: ${formatDate(snapshot.timestamp)}`;
            span.style.cursor = 'pointer';
            span.style.flexGrow = '1';

            span.addEventListener('click', () => {
                renderTable(historyData.length - 1 - index);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '&times;';
            deleteBtn.className = 'delete-btn';
            deleteBtn.style.marginLeft = '10px';
            deleteBtn.style.padding = '0 5px';
            deleteBtn.style.color = 'red';
            deleteBtn.style.border = 'none';
            deleteBtn.style.background = 'none';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '1.2em';
            deleteBtn.title = '删除记录';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这条记录吗？')) {
                    deleteSnapshot(snapshot.id);
                }
            });

            li.appendChild(span);
            li.appendChild(deleteBtn);
            historyList.appendChild(li);
        });
    }

    // Delete snapshot
    async function deleteSnapshot(id) {
        try {
            const response = await fetch(`/api/prices/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showStatus('记录已删除', 'success');
                await loadPrices();
            } else {
                showStatus('删除失败', 'error');
            }
        } catch (error) {
            console.error('Error deleting snapshot:', error);
            showStatus('删除失败', 'error');
        }
    }

    // Load prices from server
    async function loadPrices() {
        try {
            const response = await fetch('/api/prices');
            if (!response.ok) throw new Error('Failed to load prices');
            
            historyData = await response.json();
            
            if (historyData.length > 0) {
                renderTable(historyData.length - 1);
                renderHistoryList();
            } else {
                // 清空所有显示
                pricesTableBody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;padding:40px;color:#666;">
                            <div style="font-size: 1.2em;margin-bottom:10px;">📭 暂无航班数据</div>
                            <div style="font-size: 0.9em;">点击上方 <strong style="color:#27ae60;">🔄 更新价格</strong> 按钮开始搜索</div>
                        </td>
                    </tr>`;
                historyList.innerHTML = '';
                lastUpdatedSpan.textContent = '-';
                if (chartInstance) {
                    chartInstance.destroy();
                    chartInstance = null;
                }
            }
        } catch (error) {
            console.error('Error loading prices:', error);
            showStatus('加载数据失败', 'error');
        }
    }

    // Check config status
    async function checkConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            
            if (config.hasApiKey) {
                keyInputGroup.style.display = 'none';
                keyDisplayGroup.style.display = 'flex';
                maskedKeySpan.textContent = config.maskedKey || '已配置';
            } else {
                keyInputGroup.style.display = 'block';
                keyDisplayGroup.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking config:', error);
        }
    }

    // 请求通知权限
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // 发送桌面通知
    function sendNotification(title, body, icon = '✈️') {
        // 浏览器通知
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: icon,
                badge: icon,
                tag: 'flight-check-complete'
            });
        }
        
        // 同时播放提示音（可选）
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
            audio.volume = 0.3;
            audio.play().catch(() => {});
        } catch (e) {}
    }

    // 设置刷新按钮状态
    function setRefreshButtonsState(disabled) {
        const buttons = [refreshBtn, refreshBtn2].filter(Boolean);
        buttons.forEach(btn => {
            btn.disabled = disabled;
            if (disabled) {
                btn.dataset.originalText = btn.innerHTML;
                btn.innerHTML = '⏳ 搜索中...';
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.innerHTML = btn.dataset.originalText || '🔄 更新价格';
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });
    }

    // Refresh prices
    async function refreshPrices() {
        // 防止重复点击
        if (isRefreshing) {
            showStatus('正在搜索中，请稍候...', 'info');
            return;
        }

        isRefreshing = true;
        setRefreshButtonsState(true);
        
        // 请求通知权限（首次点击时）
        requestNotificationPermission();

        try {
            showStatus('正在搜索航班，请稍候...', 'info');
            
            const monthsSelect = document.getElementById('months-select');
            const months = monthsSelect ? parseInt(monthsSelect.value, 10) : 1;
            const routeSelect = document.getElementById('route-select');
            const route = routeSelect ? routeSelect.value : 'hkg-tokyo';
            const airlineSelect = document.getElementById('airline-select');
            const airline = airlineSelect ? airlineSelect.value : undefined;

            const body = { months, route };
            if (airline !== undefined) body.airline = airline || null;

            const response = await fetch('/api/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to refresh');
            }

            const result = await response.json();
            
            // 搜索完成，显示成功消息
            showStatus('✅ 航班搜索完成！', 'success');
            
            // 发送桌面通知
            const flightCount = result.count || 0;
            const minPrice = result.minPrice ? `最低 ¥${result.minPrice}` : '';
            sendNotification(
                '✈️ 航班搜索完成',
                `找到 ${flightCount} 个周末航班选项${minPrice ? '，' + minPrice : ''}，点击查看详情`
            );
            
            // 重新加载数据
            await loadPrices();
            
        } catch (error) {
            console.error('Error refreshing prices:', error);
            showStatus(error.message || '搜索失败', 'error');
            
            // 错误通知
            sendNotification(
                '❌ 搜索失败',
                error.message || '请检查 API Key 或网络连接'
            );
        } finally {
            // 恢复按钮状态
            isRefreshing = false;
            setRefreshButtonsState(false);
        }
    }

    // Save API Key
    async function saveApiKey() {
        const apiKey = apiKeyInput?.value?.trim();
        if (!apiKey) {
            showStatus('请输入 API Key', 'error');
            return;
        }
        
        try {
            showStatus('正在验证 API Key...', 'info');
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }
            
            const result = await response.json();
            showStatus(result.message, 'success');
            apiKeyInput.value = '';
            await checkConfig();
        } catch (error) {
            console.error('Error saving API key:', error);
            showStatus(error.message || '保存失败', 'error');
        }
    }
    
    // Event listeners
    if (saveKeyBtn) {
        saveKeyBtn.addEventListener('click', saveApiKey);
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshPrices);
    }
    if (refreshBtn2) {
        refreshBtn2.addEventListener('click', refreshPrices);
    }
    
    // Route selector: update airline dropdown on change
    const routeSelect = document.getElementById('route-select');
    const airlineSelect = document.getElementById('airline-select');
    if (routeSelect && airlineSelect) {
        routeSelect.addEventListener('change', () => {
            if (routeSelect.value === 'pek-hkg') {
                // 北京航线不限航司，锁定
                airlineSelect.value = '';
                airlineSelect.disabled = true;
            } else {
                airlineSelect.disabled = false;
            }
        });
    }

    removeKeyBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/config', { method: 'DELETE' });
            keyInputGroup.style.display = 'block';
            keyDisplayGroup.style.display = 'none';
            showStatus('配置已移除', 'success');
        } catch (error) {
            showStatus('移除失败', 'error');
        }
    });

    // Initialize
    checkConfig();
    loadPrices();
});
