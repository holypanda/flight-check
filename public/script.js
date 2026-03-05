document.addEventListener('DOMContentLoaded', () => {
    const statusMessage = document.getElementById('status-message');
    const lastUpdatedSpan = document.getElementById('last-updated');
    const pricesTableBody = document.querySelector('#prices-table tbody');
    const historyList = document.getElementById('history-list');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyInputGroup = document.getElementById('key-input-group');
    const keyDisplayGroup = document.getElementById('key-display-group');
    const maskedKeySpan = document.getElementById('masked-key');
    const removeKeyBtn = document.getElementById('remove-key-btn');
    const priceChartCtx = document.getElementById('priceChart').getContext('2d');

    let historyData = [];
    let chartInstance = null;
    let currentWeatherData = {};

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
    const formatCurrency = (amount, currency = 'USD') => {
        if (currency === 'CNY') {
            return '¥' + Math.round(amount).toLocaleString('zh-CN');
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    };

    // Helper: Format date
    const formatDate = (isoString) => {
        const date = new Date(isoString);
        return date.toLocaleString();
    };

    // Helper: Format time to HH:MM (remove seconds if present)
    const formatTime = (timeStr) => {
        if (!timeStr) return '-';
        // Handle formats like "19:45:00" or "2026-03-06T19:45:00"
        const timePart = timeStr.includes('T') ? timeStr.split('T')[1] : 
                        timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr;
        const parts = timePart.split(':');
        if (parts.length >= 2) {
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }
        return timeStr;
    };

    // Helper: Escape HTML for data attribute
    const escapeHtml = (text) => {
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
    };

    // Helper: Generate WeChat share text
    const generateShareText = (flight, fromAirport, toAirport, returnFromAirport, isMixed, priceDisplay) => {
        const formatShortDate = (d) => d ? d.substring(5) : '-';
        const returnToAirport = fromAirport;
        const dateStr = flight.returnDate ? 
            `${formatShortDate(flight.date)} → ${formatShortDate(flight.returnDate)}` :
            formatShortDate(flight.date);
        
        const routeName = isMixed ? 
            `香港(${toAirport})→东京(${returnFromAirport})→香港` : 
            `香港↔东京${toAirport}`;
        
        let text = `✈️ ${routeName} 往返机票\n`;
        text += `📅 ${dateStr}\n`;
        text += `🛫 去程: ${flight.flightNumber} ${fromAirport}→${toAirport} ${formatTime(flight.departureTime)}-${formatTime(flight.arrivalTime)}\n`;
        
        if (flight.returnFlightNumber) {
            text += `🛬 返程: ${flight.returnFlightNumber} ${returnFromAirport}→${returnToAirport} ${formatTime(flight.returnDepartureTime)}-${formatTime(flight.returnArrivalTime)}\n`;
        }
        
        text += `💰 ${priceDisplay.replace(/<[^>]*>/g, '')}\n`;
        
        if (flight.bookingUrl) {
            text += `🔗 ${flight.bookingUrl}`;
        }
        
        return text;
    };

    // Helper: Get weather icon HTML
    const getWeatherIcon = (weatherMain, iconCode) => {
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
        
        if (weatherMain && mainEmojiMap[weatherMain]) {
            return mainEmojiMap[weatherMain];
        }
        
        if (!iconCode) return '☀️';
        const iconMap = {
            '01d': '☀️', '01n': '🌙',
            '02d': '⛅', '02n': '☁️',
            '03d': '☁️', '03n': '☁️',
            '04d': '☁️', '04n': '☁️',
            '09d': '🌧️', '09n': '🌧️',
            '10d': '🌦️', '10n': '🌧️',
            '11d': '⛈️', '11n': '⛈️',
            '13d': '❄️', '13n': '❄️',
            '50d': '🌫️', '50n': '🌫️'
        };
        return iconMap[iconCode] || '☀️';
    };

    // Helper: Get snow condition emoji and color
    const getSnowConditionDisplay = (snowCondition) => {
        if (!snowCondition) return { emoji: '❓', color: '#999', text: '无数据' };
        
        const levelEmojis = ['❓', '⬜', '🟫', '🟨', '🟩', '❄️'];
        const levelColors = ['#999', '#ccc', '#8B4513', '#FFD700', '#32CD32', '#00CED1'];
        const levelTexts = ['无数据', '较差', '一般', '良好', '极佳', '粉雪'];
        
        const level = snowCondition.level || 1;
        return {
            emoji: levelEmojis[level] || levelEmojis[0],
            color: levelColors[level] || levelColors[0],
            text: snowCondition.description || levelTexts[level] || levelTexts[0]
        };
    };

    // Helper: Format weather display for a date
    const formatWeatherDisplay = (weather) => {
        // 检查天气数据是否有效（空对象 {} 也视为无效）
        if (!weather || Object.keys(weather).length === 0 || !weather.weather) {
            return '<span class="weather-unavailable" title="天气数据暂时不可用">-</span>';
        }
        
        const isMobile = window.innerWidth <= 768;
        const icon = getWeatherIcon(weather.weather?.main, weather.weather?.icon);
        const temp = weather.temp?.day !== undefined ? `${weather.temp.day}°C` : '-';
        const desc = weather.weather?.description || '';
        const snow = weather.snow > 0 ? `降雪 ${weather.snow}cm` : '';
        const snowCond = getSnowConditionDisplay(weather.snowCondition);
        
        if (isMobile) {
            // 移动端紧凑显示
            return `
                <div class="weather-info">
                    <div class="weather-main">
                        <span class="weather-icon">${icon}</span>
                        <span class="weather-temp">${temp}</span>
                    </div>
                    <div class="snow-condition" style="color: ${snowCond.color}; font-weight: bold; font-size: 0.85em;">
                        ${snowCond.emoji} ${snowCond.text}
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="weather-info">
                <div class="weather-main">
                    <span class="weather-icon">${icon}</span>
                    <span class="weather-temp">${temp}</span>
                </div>
                <div class="weather-desc">${desc}${snow ? ' · ' + snow : ''}</div>
                <div class="snow-condition" style="color: ${snowCond.color}; font-weight: bold;">
                    ${snowCond.emoji} ${snowCond.text}
                </div>
            </div>
        `;
    };

    // Helper: Copy text to clipboard
    const copyToClipboard = async (text, rowElement) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            
            rowElement.style.backgroundColor = '#d4edda';
            showStatus('航班信息已复制', 'info');
            setTimeout(() => {
                rowElement.style.backgroundColor = '';
            }, 1000);
        } catch (err) {
            console.error('Copy failed:', err);
            showStatus('复制失败，请手动复制', 'error');
        }
    };

    // Render Chart
    function renderChart(snapshot) {
        if (chartInstance) {
            chartInstance.destroy();
        }

        if (!snapshot.prices || snapshot.prices.length === 0) {
            return;
        }

        const labels = snapshot.prices.map(p => p.date);
        const data = snapshot.prices.map(p => p.price);
        const currency = snapshot.prices[0]?.currency || 'CNY';

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
                    label: `Price (${currency})`,
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
                        text: 'Flight Prices by Departure Date'
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
                            text: 'Price'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Departure Date'
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
            pricesTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">暂无数据，请点击"更新价格"按钮获取航班信息</td></tr>';
            return;
        }

        const currentSnapshot = historyData[dataIndex];
        const previousSnapshot = dataIndex > 0 ? historyData[dataIndex - 1] : null;
        
        currentWeatherData = currentSnapshot.weather || {};

        lastUpdatedSpan.textContent = formatDate(currentSnapshot.timestamp);

        renderChart(currentSnapshot);

        // Find the cheapest flight
        const cheapestFlight = currentSnapshot.prices.reduce((min, flight) => 
            flight.price < min.price ? flight : min, currentSnapshot.prices[0]
        );

        currentSnapshot.prices.forEach((flight, index) => {
            const row = document.createElement('tr');

            const fromAirport = 'HKG';
            const toAirport = flight.outboundAirport || flight.toAirport || 'HND';
            const returnFromAirport = flight.returnAirport || flight.returnFromAirport || toAirport;
            const returnToAirport = 'HKG';
            
            const isMixed = flight.mixedAirports || (returnFromAirport !== toAirport);
            
            const formatShortDate = (d) => d ? d.substring(5) : '-';
            // 检测是否为移动端
            const isMobile = window.innerWidth <= 768;
            
            let dateDisplay;
            if (isMobile) {
                // 移动端紧凑显示
                dateDisplay = flight.returnDate ?
                    `<small>${formatShortDate(flight.date)}→${formatShortDate(flight.returnDate)}</small>` :
                    formatShortDate(flight.date);
            } else {
                dateDisplay = flight.returnDate ?
                    `${formatShortDate(flight.date)} ↓ ${formatShortDate(flight.returnDate)}` :
                    formatShortDate(flight.date);
            }

            // 航班信息格式化（时间格式化为 HH:MM）
            let outboundStr, returnStr;
            if (isMobile) {
                // 移动端简化显示
                outboundStr = `${flight.flightNumber || '-'} <span class="airport-route">${fromAirport}→${toAirport}</span> ${formatTime(flight.departureTime)}`;
                returnStr = flight.returnFlightNumber ? 
                    `${flight.returnFlightNumber} <span class="airport-route">${returnFromAirport}→${returnToAirport}</span> ${formatTime(flight.returnDepartureTime)}` : 
                    '-';
            } else {
                outboundStr = `${flight.flightNumber || '-'} ${fromAirport}→${toAirport} ${formatTime(flight.departureTime)}→${formatTime(flight.arrivalTime)}`;
                returnStr = flight.returnFlightNumber ? 
                    `${flight.returnFlightNumber} ${returnFromAirport}→${returnToAirport} ${formatTime(flight.returnDepartureTime)}→${formatTime(flight.returnArrivalTime)}` : 
                    '-';
            }
            
            const flightInfoDisplay = `
                <div class="flight-line">🛫 ${outboundStr}</div>
                <div class="flight-line">🛬 ${returnStr}</div>
            `;

            let routeDisplay;
            if (isMixed) {
                routeDisplay = `<strong>${fromAirport}-${toAirport}</strong><span class="mixed-badge" title="去程${toAirport}，返程${returnFromAirport}">🔄</span>`;
            } else {
                routeDisplay = `<strong>${fromAirport}-${toAirport}</strong>`;
            }

            const priceDisplay = formatCurrency(flight.price, flight.currency);

            const priceText = flight.price ? `¥${flight.price}` : '-';
            const shareText = generateShareText(flight, fromAirport, toAirport, returnFromAirport, isMixed, priceText);

            if (flight === cheapestFlight) {
                row.classList.add('cheapest');
            }

            row.style.cursor = 'pointer';
            row.title = '点击复制航班信息';

            const weather = currentWeatherData[flight.date];
            const weatherDisplay = formatWeatherDisplay(weather);

            row.innerHTML = `
                <td class="col-route">${routeDisplay}</td>
                <td class="col-date">${dateDisplay}</td>
                <td class="col-flight">${flightInfoDisplay}</td>
                <td class="col-price">${priceDisplay}</td>
                <td class="col-weather">${weatherDisplay}</td>
            `;

            row.addEventListener('click', () => copyToClipboard(shareText, row));
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
            span.textContent = `Snapshot: ${formatDate(snapshot.timestamp)}`;
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
            deleteBtn.title = 'Delete Snapshot';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this snapshot?')) {
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
                showStatus('Snapshot deleted successfully', 'info');
                fetchData();
            } else {
                throw new Error('Failed to delete snapshot');
            }
        } catch (error) {
            console.error('Error deleting snapshot:', error);
            showStatus('Error deleting snapshot', 'error');
        }
    }

    // Fetch data from API
    async function fetchData() {
        try {
            const response = await fetch('/api/prices');
            if (!response.ok) throw new Error('Network response was not ok');

            historyData = await response.json();

            if (historyData.length > 0) {
                const latestSnapshot = historyData[historyData.length - 1];
                currentWeatherData = latestSnapshot.weather || {};
                
                renderHistoryList();
                renderTable(historyData.length - 1);
            } else {
                showStatus('No price history found.', 'info');
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            showStatus('Failed to load price data.', 'error');
        }
    }

    // Restart crawler handler
    saveKeyBtn.addEventListener('click', async () => {
        saveKeyBtn.disabled = true;
        saveKeyBtn.textContent = '爬取中...';

        try {
            const response = await fetch('/api/restart-crawler', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to restart crawler');
            }

            showStatus('价格已更新!', 'info');
            await fetchData();
            checkConfig();
        } catch (error) {
            console.error('Error restarting crawler:', error);
            showStatus(error.message, 'error');
        } finally {
            saveKeyBtn.disabled = false;
            saveKeyBtn.textContent = '更新价格';
        }
    });

    // Check if crawler is enabled
    async function checkConfig() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();

            if (data.hasApiKey) {
                keyInputGroup.style.display = 'none';
                keyDisplayGroup.style.display = 'flex';
                keyDisplayGroup.style.alignItems = 'center';
                keyDisplayGroup.style.gap = '10px';
                maskedKeySpan.textContent = '运行中';
            } else {
                keyInputGroup.style.display = 'flex';
                keyInputGroup.style.alignItems = 'center';
                keyInputGroup.style.gap = '10px';
                keyDisplayGroup.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking config:', error);
        }
    }

    // Disable crawler handler
    removeKeyBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to disable the crawler?')) {
            return;
        }

        try {
            const response = await fetch('/api/config', { method: 'DELETE' });
            if (response.ok) {
                showStatus('Crawler disabled', 'info');
                checkConfig();
            } else {
                throw new Error('Failed to disable crawler');
            }
        } catch (error) {
            console.error('Error disabling crawler:', error);
            showStatus('Error disabling crawler', 'error');
        }
    });

    // Countdown timer for next update
    function updateCountdown() {
        const now = new Date();
        const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
        const diff = nextHour - now;
        
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.textContent = `(下次更新: ${minutes}分${seconds.toString().padStart(2, '0')}秒后)`;
        }
    }
    
    setInterval(updateCountdown, 1000);
    updateCountdown();

    // Initial load
    checkConfig();
    fetchData();
    
    // 窗口大小变化时重新渲染表格（移动端/桌面端切换）
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (historyData.length > 0) {
                renderTable(historyData.length - 1);
            }
        }, 250);
    });
});
