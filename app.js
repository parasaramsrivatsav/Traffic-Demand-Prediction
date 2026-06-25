// Global Application State
let appState = {
    modelWeights: null,
    map: null,
    currentMarker: null,
    hotspotMarkers: [],
    theme: 'dark'
};

// Geohash encoding/decoding helper functions
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BITS = [16, 8, 4, 2, 1];

function decodeGeohash(geohash) {
    if (!geohash || typeof geohash !== 'string') {
        return { lat: NaN, lon: NaN };
    }
    let isEven = true;
    let latMin = -90, latMax = 90;
    let lonMin = -180, lonMax = 180;
    
    for (let i = 0; i < geohash.length; i++) {
        const c = geohash[i].toLowerCase();
        const cd = BASE32.indexOf(c);
        if (cd === -1) continue;
        for (let j = 0; j < 5; j++) {
            const mask = BITS[j];
            if (isEven) {
                const lonMid = (lonMin + lonMax) / 2;
                if ((cd & mask) !== 0) {
                    lonMin = lonMid;
                } else {
                    lonMax = lonMid;
                }
            } else {
                const latMid = (latMin + latMax) / 2;
                if ((cd & mask) !== 0) {
                    latMin = latMid;
                } else {
                    latMax = latMid;
                }
            }
            isEven = !isEven;
        }
    }
    return {
        lat: (latMin + latMax) / 2,
        lon: (lonMin + lonMax) / 2
    };
}

function encodeGeohash(lat, lon, precision = 6) {
    let isEven = true;
    let latMin = -90, latMax = 90;
    let lonMin = -180, lonMax = 180;
    let geohash = "";
    let ch = 0;
    let bit = 0;
    
    while (geohash.length < precision) {
        if (isEven) {
            const lonMid = (lonMin + lonMax) / 2;
            if (lon > lonMid) {
                ch |= BITS[bit];
                lonMin = lonMid;
            } else {
                lonMax = lonMid;
            }
        } else {
            const latMid = (latMin + latMax) / 2;
            if (lat > latMid) {
                ch |= BITS[bit];
                latMin = latMid;
            } else {
                latMax = latMid;
            }
        }
        isEven = !isEven;
        if (bit < 4) {
            bit++;
        } else {
            geohash += BASE32[ch];
            ch = 0;
            bit = 0;
        }
    }
    return geohash;
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Icons
    lucide.createIcons();
    
    // 2. Fetch Model Weights
    try {
        const response = await fetch('model_weights.json');
        appState.modelWeights = await response.json();
        console.log('Model weights loaded successfully:', appState.modelWeights);
        
        // Sync insights metadata
        document.getElementById('ridgeR2').textContent = (appState.modelWeights.model_performance.r2 * 100).toFixed(2) + '%';
        document.getElementById('ridgeMAE').textContent = appState.modelWeights.model_performance.mae.toFixed(4);
        
    } catch (error) {
        console.error('Error loading model weights, using mock weights fallback:', error);
        appState.modelWeights = getMockWeightsFallback();
    }
    
    // 3. Setup Leaflet Map
    initMap();
    
    // 4. Render Insights Charts
    initCharts();
    
    // 5. Connect UI Event Listeners
    setupFormListeners();
    setupTabListeners();
    setupBatchPredictor();
    setupThemeToggle();
    
    // 6. Run Initial Prediction
    runPrediction();
});

// Setup Leaflet Map
function initMap() {
    const meta = appState.modelWeights.map_meta;
    
    // Initialize map
    appState.map = L.map('map', {
        center: [meta.center_lat, meta.center_lon],
        zoom: 13,
        zoomControl: true
    });
    
    // Add CartoDB Dark Matter tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(appState.map);
    
    // Add primary draggable marker
    const initLat = parseFloat(document.getElementById('latitude').value);
    const initLon = parseFloat(document.getElementById('longitude').value);
    
    appState.currentMarker = L.marker([initLat, initLon], {
        draggable: true
    }).addTo(appState.map);
    
    appState.currentMarker.bindPopup('<b>Selected Location</b><br>Drag me to change coordinates').openPopup();
    
    // Map Click event
    appState.map.on('click', (e) => {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;
        updateLocationInputs(lat, lon);
    });
    
    // Marker drag event
    appState.currentMarker.on('dragend', (e) => {
        const position = appState.currentMarker.getLatLng();
        updateLocationInputs(position.lat, position.lng);
    });
    
    // Plot historical hotspots from model weights
    plotHotspots();
}

// Plot top historical hotspots (from geohash target encodings)
function plotHotspots() {
    const encodings = appState.modelWeights.target_encodings.geohash;
    const globalMean = appState.modelWeights.global_mean;
    
    // Convert target encodings to list and sort by demand
    const hotspotList = Object.entries(encodings)
        .map(([geohash, meanDemand]) => ({ geohash, meanDemand }))
        .sort((a, b) => b.meanDemand - a.meanDemand)
        .slice(0, 40); // Top 40 hotspots
        
    hotspotList.forEach(item => {
        const coords = decodeGeohash(item.geohash);
        if (!isNaN(coords.lat) && !isNaN(coords.lon)) {
            // Determine color based on demand level
            let color = 'var(--color-green)';
            if (item.meanDemand > 0.1 && item.meanDemand <= 0.3) color = 'var(--color-amber)';
            else if (item.meanDemand > 0.3 && item.meanDemand <= 0.6) color = 'var(--color-red)';
            else if (item.meanDemand > 0.6) color = 'var(--color-critical)';
            
            const circle = L.circle([coords.lat, coords.lon], {
                color: color,
                fillColor: color,
                fillOpacity: 0.25,
                radius: 120,
                weight: 1
            }).addTo(appState.map);
            
            circle.bindTooltip(`
                <div style="font-family: var(--font-body); font-size: 11px;">
                    <strong>Geohash:</strong> ${item.geohash}<br>
                    <strong>Avg Demand:</strong> ${item.meanDemand.toFixed(4)}
                </div>
            `);
            
            // Clicking a hotspot centers map and updates inputs
            circle.on('click', (e) => {
                updateLocationInputs(coords.lat, coords.lon);
                L.DomEvent.stopPropagation(e);
            });
            
            appState.hotspotMarkers.push(circle);
        }
    });
}

// Update location inputs and trigger prediction
function updateLocationInputs(lat, lon) {
    document.getElementById('latitude').value = lat.toFixed(6);
    document.getElementById('longitude').value = lon.toFixed(6);
    
    const geohash = encodeGeohash(lat, lon, 6);
    document.getElementById('geohash').value = geohash;
    
    appState.currentMarker.setLatLng([lat, lon]);
    appState.map.panTo([lat, lon]);
    
    runPrediction();
}

// Connect form field listeners to run prediction real-time
function setupFormListeners() {
    const formInputs = [
        'latitude', 'longitude', 'day', 'timestamp', 
        'roadType', 'numLanes', 'largeVehicles', 'landmarks', 
        'temperature', 'weather'
    ];
    
    formInputs.forEach(id => {
        const input = document.getElementById(id);
        if (id === 'temperature') {
            input.addEventListener('input', (e) => {
                document.getElementById('tempValue').textContent = parseFloat(e.target.value).toFixed(1) + ' °C';
                runPrediction();
            });
        } else if (id === 'latitude' || id === 'longitude') {
            input.addEventListener('change', () => {
                const lat = parseFloat(document.getElementById('latitude').value) || 0;
                const lon = parseFloat(document.getElementById('longitude').value) || 0;
                updateLocationInputs(lat, lon);
            });
        } else {
            input.addEventListener('change', runPrediction);
        }
    });
}

// Tab navigation handler
function setupTabListeners() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active classes
            tabButtons.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active class
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            const activeTab = document.getElementById(tabId);
            activeTab.classList.add('active');
            
            // Leaflet map refresh when shown to prevent layout breakage
            if (tabId === 'mapTab') {
                setTimeout(() => {
                    appState.map.invalidateSize();
                }, 100);
            }
        });
    });
}

// Prediction Engine
function runPrediction() {
    if (!appState.modelWeights) return;
    
    const lat = parseFloat(document.getElementById('latitude').value) || 0;
    const lon = parseFloat(document.getElementById('longitude').value) || 0;
    const geohash = document.getElementById('geohash').value;
    const day = parseInt(document.getElementById('day').value);
    const timestampVal = document.getElementById('timestamp').value;
    const roadType = document.getElementById('roadType').value;
    const numLanes = parseInt(document.getElementById('numLanes').value);
    const largeVehicles = document.getElementById('largeVehicles').value;
    const landmarks = document.getElementById('landmarks').value;
    const temperature = parseFloat(document.getElementById('temperature').value);
    const weather = document.getElementById('weather').value;
    
    // Calculate prediction
    const demand = calculateDemand({
        lat, lon, geohash, day, timestampVal, roadType, numLanes, largeVehicles, landmarks, temperature, weather
    });
    
    updateGauge(demand);
}

// Core math helper to predict demand
function calculateDemand(inputs) {
    const weights = appState.modelWeights;
    const globalMean = weights.global_mean;
    
    // 1. Time Features
    const timeParts = inputs.timestampVal.split(':');
    const hour = parseInt(timeParts[0]) || 0;
    const minute = parseInt(timeParts[1]) || 0;
    const time_slot = hour * 4 + Math.floor(minute / 15);
    const rushHours = [7, 8, 9, 17, 18, 19];
    const rush_hour = rushHours.includes(hour) ? 1 : 0;
    
    // 2. Spatial interactions
    const lat_lon_product = inputs.lat * inputs.lon;
    const lat_squared = inputs.lat * inputs.lat;
    const lon_squared = inputs.lon * inputs.lon;
    
    // 3. Target Encodings
    const geohash_te = weights.target_encodings.geohash[inputs.geohash] !== undefined ? 
                       weights.target_encodings.geohash[inputs.geohash] : globalMean;
                       
    const RoadType_te = weights.target_encodings.RoadType[inputs.roadType] !== undefined ? 
                        weights.target_encodings.RoadType[inputs.roadType] : globalMean;
                        
    const LargeVehicles_te = weights.target_encodings.LargeVehicles[inputs.largeVehicles] !== undefined ? 
                             weights.target_encodings.LargeVehicles[inputs.largeVehicles] : globalMean;
                             
    const Landmarks_te = weights.target_encodings.Landmarks[inputs.landmarks] !== undefined ? 
                         weights.target_encodings.Landmarks[inputs.landmarks] : globalMean;
                         
    const Weather_te = weights.target_encodings.Weather[inputs.weather] !== undefined ? 
                       weights.target_encodings.Weather[inputs.weather] : globalMean;
                       
    // 4. Feature Vector mapping to model weights
    const featuresVector = {
        geohash_te,
        RoadType_te,
        LargeVehicles_te,
        Landmarks_te,
        Weather_te,
        day: inputs.day,
        NumberofLanes: inputs.numLanes,
        Temperature: inputs.temperature,
        hour,
        minute,
        time_slot,
        rush_hour,
        lat: inputs.lat,
        lon: inputs.lon,
        lat_lon_product,
        lat_squared,
        lon_squared
    };
    
    // 5. Predict: Intercept + sum(feature * coefficient)
    let prediction = weights.intercept;
    for (const [feat, val] of Object.entries(featuresVector)) {
        if (weights.coefficients[feat] !== undefined) {
            prediction += val * weights.coefficients[feat];
        }
    }
    
    // Clip demand between 0 and 1
    return Math.max(0.0, Math.min(1.0, prediction));
}

// Update prediction display UI elements (Gauge & Badges)
function updateGauge(score) {
    const demandText = document.getElementById('demandScore');
    const statusBadge = document.getElementById('demandStatus');
    const descText = document.getElementById('demandDescription');
    const circle = document.getElementById('predictionGauge');
    
    // Update score text
    demandText.textContent = score.toFixed(4);
    
    // Circular progress ring updates
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    const offset = circumference - (score * circumference);
    circle.style.strokeDashoffset = offset;
    
    // Status color configurations
    statusBadge.className = 'status-badge';
    
    if (score < 0.1) {
        statusBadge.classList.add('green');
        statusBadge.textContent = 'Low Load';
        descText.textContent = 'Traffic flow is optimal. High logistics efficiency expected.';
        circle.style.stroke = 'var(--color-green)';
    } else if (score >= 0.1 && score < 0.3) {
        statusBadge.classList.add('orange');
        statusBadge.textContent = 'Moderate Load';
        descText.textContent = 'Stable operations. Expected minor queue delays at dispatch.';
        circle.style.stroke = 'var(--color-amber)';
    } else if (score >= 0.3 && score < 0.6) {
        statusBadge.classList.add('red');
        statusBadge.textContent = 'High Load';
        descText.textContent = 'Heavy traffic density. Restructure delivery routes or dispatch slots.';
        circle.style.stroke = 'var(--color-red)';
    } else {
        statusBadge.classList.add('critical');
        statusBadge.textContent = 'Critical Load';
        descText.textContent = 'Extreme demand surge. Hub congestion imminent. Recommend immediate vehicle re-routing.';
        circle.style.stroke = 'var(--color-critical)';
    }
}

// Insights Charts Rendering
function initCharts() {
    // 1. Model Comparison Chart
    const comparisonCtx = document.getElementById('modelComparisonChart').getContext('2d');
    new Chart(comparisonCtx, {
        type: 'bar',
        data: {
            labels: ['LightGBM', 'CatBoost', 'XGBoost', 'GBDT Ensemble', 'Ridge Approximation'],
            datasets: [{
                label: 'R² Score (%)',
                data: [94.78, 94.50, 95.56, 95.15, 84.41],
                backgroundColor: [
                    'rgba(59, 130, 246, 0.5)',
                    'rgba(139, 92, 246, 0.5)',
                    'rgba(245, 158, 11, 0.5)',
                    'rgba(16, 185, 129, 0.7)',
                    'rgba(100, 116, 139, 0.5)'
                ],
                borderColor: [
                    'var(--accent-blue)',
                    'var(--accent-purple)',
                    'var(--color-amber)',
                    'var(--color-green)',
                    'var(--text-muted)'
                ],
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    min: 75,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: 'var(--text-secondary)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: 'var(--text-secondary)' }
                }
            }
        }
    });

    // 2. Feature Importances Chart
    // Get absolute coefficients from linear model
    const coefs = appState.modelWeights.coefficients;
    const importanceData = Object.entries(coefs)
        .map(([name, val]) => ({ name, val: Math.abs(val) }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 10); // top 10
        
    const importanceCtx = document.getElementById('featureImportanceChart').getContext('2d');
    new Chart(importanceCtx, {
        type: 'bar',
        data: {
            labels: importanceData.map(d => d.name),
            datasets: [{
                label: 'Absolute Coefficient Strength',
                data: importanceData.map(d => d.val),
                backgroundColor: 'rgba(139, 92, 246, 0.4)',
                borderColor: 'var(--accent-purple)',
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: 'var(--text-secondary)' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: 'var(--text-secondary)' }
                }
            }
        }
    });
}

// Batch Predictor handler
function setupBatchPredictor() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('csvFileInput');
    const selectBtn = document.getElementById('selectFileBtn');
    
    selectBtn.addEventListener('click', (e) => {
        fileInput.click();
        e.stopPropagation();
    });
    
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent-blue)';
        dropZone.style.background = 'rgba(59, 130, 246, 0.05)';
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.background = 'rgba(255, 255, 255, 0.01)';
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.background = 'rgba(255, 255, 255, 0.01)';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processCSV(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processCSV(e.target.files[0]);
        }
    });
}

// Parse CSV content, run calculations, and export result
function processCSV(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please upload a valid CSV file.');
        return;
    }
    
    const dropZone = document.getElementById('dropZone');
    const statusBox = document.getElementById('batchProcessingStatus');
    const resultBox = document.getElementById('batchResultContainer');
    
    dropZone.style.display = 'none';
    statusBox.style.display = 'flex';
    resultBox.style.display = 'none';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
            alert('CSV file is empty or missing data.');
            resetBatchPredictor();
            return;
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        
        // Find indices of columns
        const colIndices = {
            geohash: headers.indexOf('geohash'),
            day: headers.indexOf('day'),
            timestamp: headers.indexOf('timestamp'),
            roadType: headers.indexOf('RoadType'),
            numLanes: headers.indexOf('NumberofLanes'),
            largeVehicles: headers.indexOf('LargeVehicles'),
            landmarks: headers.indexOf('Landmarks'),
            temperature: headers.indexOf('Temperature'),
            weather: headers.indexOf('Weather')
        };
        
        // Validate headers (geohash, day, and timestamp are required at least)
        if (colIndices.geohash === -1 || colIndices.day === -1 || colIndices.timestamp === -1) {
            alert('Missing critical columns: geohash, day, or timestamp in CSV headers.');
            resetBatchPredictor();
            return;
        }
        
        const results = [];
        const previewRows = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(',');
            if (parts.length < headers.length) continue;
            
            const geohash = parts[colIndices.geohash];
            const coords = decodeGeohash(geohash);
            
            const inputs = {
                lat: coords.lat,
                lon: coords.lon,
                geohash: geohash,
                day: parseInt(parts[colIndices.day]) || 49,
                timestampVal: parts[colIndices.timestamp],
                roadType: colIndices.roadType !== -1 ? parts[colIndices.roadType] || "Unknown" : "Unknown",
                numLanes: colIndices.numLanes !== -1 ? parseInt(parts[colIndices.numLanes]) || 1 : 1,
                largeVehicles: colIndices.largeVehicles !== -1 ? parts[colIndices.largeVehicles] || "Unknown" : "Unknown",
                landmarks: colIndices.landmarks !== -1 ? parts[colIndices.landmarks] || "Unknown" : "Unknown",
                temperature: colIndices.temperature !== -1 && parts[colIndices.temperature] ? parseFloat(parts[colIndices.temperature]) : appState.modelWeights.temperature_median,
                weather: colIndices.weather !== -1 ? parts[colIndices.weather] || "Unknown" : "Unknown"
            };
            
            const demand = calculateDemand(inputs);
            
            // Build prediction CSV row output
            results.push({
                line: line,
                demand: demand.toFixed(6)
            });
            
            // Preview dataset (up to 10 rows)
            if (previewRows.length < 10) {
                previewRows.push([
                    geohash,
                    inputs.day,
                    inputs.timestampVal,
                    inputs.roadType,
                    inputs.numLanes,
                    inputs.weather,
                    inputs.temperature.toFixed(1),
                    demand.toFixed(4)
                ]);
            }
        }
        
        // Update UI
        document.getElementById('processedRowCount').textContent = results.length;
        renderPreviewTable(previewRows);
        
        // Setup Download button
        const downloadBtn = document.getElementById('downloadResultsBtn');
        downloadBtn.onclick = () => {
            let csvContent = "data:text/csv;charset=utf-8,";
            // Header
            csvContent += lines[0].trim() + ",predicted_demand\n";
            // Rows
            results.forEach(row => {
                csvContent += row.line + "," + row.demand + "\n";
            });
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `predictions_${file.name}`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
        
        statusBox.style.display = 'none';
        resultBox.style.display = 'flex';
    };
    
    reader.readAsText(file);
}

function renderPreviewTable(rows) {
    const table = document.getElementById('previewTable');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    
    thead.innerHTML = `
        <tr>
            <th>Geohash</th>
            <th>Day</th>
            <th>Time</th>
            <th>Road</th>
            <th>Lanes</th>
            <th>Weather</th>
            <th>Temp</th>
            <th>Predicted Demand</th>
        </tr>
    `;
    
    tbody.innerHTML = '';
    rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach((cell, idx) => {
            const td = document.createElement('td');
            if (idx === 7) {
                // Style predicted demand column nicely
                const val = parseFloat(cell);
                let badgeClass = 'green';
                if (val >= 0.1 && val < 0.3) badgeClass = 'orange';
                else if (val >= 0.3 && val < 0.6) badgeClass = 'red';
                else if (val >= 0.6) badgeClass = 'critical';
                
                td.innerHTML = `<span class="status-badge ${badgeClass}" style="padding: 2px 8px; font-size: 11px;">${cell}</span>`;
            } else {
                td.textContent = cell;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function resetBatchPredictor() {
    document.getElementById('dropZone').style.display = 'flex';
    document.getElementById('batchProcessingStatus').style.display = 'none';
    document.getElementById('batchResultContainer').style.display = 'none';
    document.getElementById('csvFileInput').value = '';
}

// Light / Dark Theme toggle
function setupThemeToggle() {
    const themeBtn = document.getElementById('themeToggle');
    themeBtn.addEventListener('click', () => {
        if (appState.theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeBtn.innerHTML = '<i data-lucide="moon"></i>';
            appState.theme = 'light';
        } else {
            document.documentElement.removeAttribute('data-theme');
            themeBtn.innerHTML = '<i data-lucide="sun"></i>';
            appState.theme = 'dark';
        }
        lucide.createIcons();
    });
}

// Mock weights fallback in case model_weights.json fails to load
function getMockWeightsFallback() {
    return {
        global_mean: 0.09394,
        temperature_median: 16.38,
        target_encodings: {
            geohash: { "qp02z1": 0.0488 },
            RoadType: { "Residential": 0.08, "Street": 0.05, "Highway": 0.12 },
            LargeVehicles: { "Allowed": 0.11, "Not Allowed": 0.07 },
            Landmarks: { "Yes": 0.10, "No": 0.08 },
            Weather: { "Sunny": 0.07, "Rainy": 0.11, "Snowy": 0.14, "Foggy": 0.10 }
        },
        features: ["geohash_te", "RoadType_te", "LargeVehicles_te", "Landmarks_te", "Weather_te", "day", "NumberofLanes", "Temperature", "hour", "minute", "time_slot", "rush_hour", "lat", "lon", "lat_lon_product", "lat_squared", "lon_squared"],
        coefficients: {
            "geohash_te": 0.85,
            "RoadType_te": 0.02,
            "LargeVehicles_te": 0.01,
            "Landmarks_te": 0.01,
            "Weather_te": 0.03,
            "day": 0.001,
            "NumberofLanes": 0.005,
            "Temperature": -0.001,
            "hour": 0.002,
            "minute": 0.0001,
            "time_slot": -0.0005,
            "rush_hour": 0.04,
            "lat": -0.1,
            "lon": 0.05,
            "lat_lon_product": 0.001,
            "lat_squared": -0.02,
            "lon_squared": 0.01
        },
        intercept: 0.02,
        map_meta: {
            center_lat: -5.3613,
            center_lon: 90.78,
            min_lat: -5.48,
            max_lat: -5.23,
            min_lon: 90.58,
            max_lon: 90.97
        },
        model_performance: {
            mae: 0.036,
            r2: 0.844
        }
    };
}
