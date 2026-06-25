const fs = require('fs');
const path = require('path');

// Geohash decoding helper
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

// Gauss-Jordan elimination to solve A * x = B
function solveLinearSystem(A, B) {
    const n = B.length;
    const M = [];
    for (let i = 0; i < n; i++) {
        M[i] = [...A[i], B[i]];
    }
    
    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let r = i + 1; r < n; r++) {
            if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) {
                maxRow = r;
            }
        }
        
        const temp = M[i];
        M[i] = M[maxRow];
        M[maxRow] = temp;
        
        const pivot = M[i][i];
        if (Math.abs(pivot) < 1e-12) {
            throw new Error("Matrix is singular or near-singular");
        }
        
        for (let j = i; j <= n; j++) {
            M[i][j] /= pivot;
        }
        
        for (let r = 0; r < n; r++) {
            if (r !== i) {
                const factor = M[r][i];
                for (let j = i; j <= n; j++) {
                    M[r][j] -= factor * M[i][j];
                }
            }
        }
    }
    return M.map(row => row[n]);
}

function main() {
    console.log("Starting lightweight model preparation using Node.js...");
    
    const workspaceRoot = path.resolve(__dirname, '..');
    const trainPath = path.join(workspaceRoot, 'e88186124ec611f1', 'dataset', 'train.csv');
    
    if (!fs.existsSync(trainPath)) {
        console.error(`Train dataset not found at ${trainPath}`);
        process.exit(1);
    }
    
    console.log(`Reading training dataset from ${trainPath}...`);
    const content = fs.readFileSync(trainPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const header = lines[0].split(',');
    
    // Parse dataset rows
    const rows = [];
    const temperatures = [];
    const demands = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        if (parts.length < 11) continue;
        
        const demand = parseFloat(parts[4]);
        const tempVal = parts[9] ? parseFloat(parts[9]) : NaN;
        
        demands.push(demand);
        if (!isNaN(tempVal)) {
            temperatures.append ? temperatures.append(tempVal) : temperatures.push(tempVal);
        }
        
        rows.push({
            geohash: parts[1],
            day: parseInt(parts[2]),
            timestamp: parts[3],
            demand: demand,
            roadType: parts[5] || "Unknown",
            numLanes: parseInt(parts[6]),
            largeVehicles: parts[7] || "Unknown",
            landmarks: parts[8] || "Unknown",
            temperature: tempVal,
            weather: parts[10] || "Unknown"
        });
    }
    
    console.log(`Loaded ${rows.length} valid rows.`);
    
    // Calculate median temperature
    temperatures.sort((a, b) => a - b);
    const tempMedian = temperatures[Math.floor(temperatures.length / 2)];
    console.log(`Median Temperature: ${tempMedian}`);
    
    // Impute missing temperatures and decode geohashes
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    
    rows.forEach(row => {
        if (isNaN(row.temperature)) {
            row.temperature = tempMedian;
        }
        const coords = decodeGeohash(row.geohash);
        row.lat = coords.lat;
        row.lon = coords.lon;
        
        if (!isNaN(row.lat) && !isNaN(row.lon)) {
            if (row.lat < minLat) minLat = row.lat;
            if (row.lat > maxLat) maxLat = row.lat;
            if (row.lon < minLon) minLon = row.lon;
            if (row.lon > maxLon) maxLon = row.lon;
        }
        
        // Time features
        const timeParts = row.timestamp.split(':');
        row.hour = parseInt(timeParts[0]);
        row.minute = parseInt(timeParts[1]);
        row.time_slot = row.hour * 4 + Math.floor(row.minute / 15);
        const rushHours = [7, 8, 9, 17, 18, 19];
        row.rush_hour = rushHours.includes(row.hour) ? 1 : 0;
        
        // Spatial interactions
        row.lat_lon_product = row.lat * row.lon;
        row.lat_squared = row.lat * row.lat;
        row.lon_squared = row.lon * row.lon;
    });
    
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    console.log(`Spatial bounds: Lat [${minLat.toFixed(4)}, ${maxLat.toFixed(4)}], Lon [${minLon.toFixed(4)}, ${maxLon.toFixed(4)}]`);
    console.log(`Center Map on: Lat ${centerLat.toFixed(4)}, Lon ${centerLon.toFixed(4)}`);
    
    // Calculate global mean demand
    const globalMeanDemand = demands.reduce((a, b) => a + b, 0) / demands.length;
    console.log(`Global Mean Demand: ${globalMeanDemand.toFixed(6)}`);
    
    // Compute Target Encodings
    const catCols = ['geohash', 'roadType', 'largeVehicles', 'landmarks', 'weather'];
    const targetEncodings = {
        geohash: {},
        roadType: {},
        largeVehicles: {},
        landmarks: {},
        weather: {}
    };
    
    catCols.forEach(col => {
        const counts = {};
        const sums = {};
        rows.forEach(row => {
            const val = row[col];
            counts[val] = (counts[val] || 0) + 1;
            sums[val] = (sums[val] || 0) + row.demand;
        });
        
        Object.keys(counts).forEach(val => {
            targetEncodings[col][val] = sums[val] / counts[val];
        });
    });
    
    // Add target encodings to rows
    rows.forEach(row => {
        catCols.forEach(col => {
            row[`${col}_te`] = targetEncodings[col][row[col]] !== undefined ? targetEncodings[col][row[col]] : globalMeanDemand;
        });
    });
    
    // Prepare design matrix X and target vector y
    // We add an intercept column (constant 1) as the last feature
    const featuresList = [
        'geohash_te',
        'roadType_te',
        'largeVehicles_te',
        'landmarks_te',
        'weather_te',
        'day',
        'numLanes',
        'temperature',
        'hour',
        'minute',
        'time_slot',
        'rush_hour',
        'lat',
        'lon',
        'lat_lon_product',
        'lat_squared',
        'lon_squared'
    ];
    
    const M = featuresList.length + 1; // plus intercept
    const N = rows.length;
    
    console.log(`Building design matrix X of size ${N} x ${M}...`);
    
    // We will accumulate X^T * X and X^T * y directly to save memory
    const XTX = Array(M).fill(0).map(() => Array(M).fill(0));
    const XTy = Array(M).fill(0);
    
    for (let i = 0; i < N; i++) {
        const row = rows[i];
        // Construct row feature vector
        const x_row = [];
        for (let j = 0; j < featuresList.length; j++) {
            x_row.push(row[featuresList[j]]);
        }
        x_row.push(1.0); // intercept
        
        const y_val = row.demand;
        
        // Accumulate XTX and XTy
        for (let r = 0; r < M; r++) {
            const val_r = x_row[r];
            XTy[r] += val_r * y_val;
            for (let c = 0; c < M; c++) {
                XTX[r][c] += val_r * x_row[c];
            }
        }
    }
    
    // Add Ridge regularization (L2 penalty) to the diagonal to ensure stability
    // alpha = 1.0 (excluding the intercept)
    const alpha = 1.0;
    for (let r = 0; r < M - 1; r++) {
        XTX[r][r] += alpha;
    }
    
    console.log("Solving Ridge regression linear system...");
    const weightsVector = solveLinearSystem(XTX, XTy);
    
    // Extract coefficients and intercept
    const coefficients = {};
    for (let j = 0; j < featuresList.length; j++) {
        coefficients[featuresList[j]] = weightsVector[j];
    }
    const intercept = weightsVector[M - 1];
    
    // Evaluate performance
    let sumAbsError = 0;
    let sumSqError = 0;
    let sumSqTotal = 0;
    
    for (let i = 0; i < N; i++) {
        const row = rows[i];
        let pred = intercept;
        for (let j = 0; j < featuresList.length; j++) {
            pred += row[featuresList[j]] * coefficients[featuresList[j]];
        }
        const error = row.demand - pred;
        sumAbsError += Math.abs(error);
        sumSqError += error * error;
        sumSqTotal += (row.demand - globalMeanDemand) * (row.demand - globalMeanDemand);
    }
    
    const mae = sumAbsError / N;
    const r2 = 1.0 - (sumSqError / sumSqTotal);
    console.log(`Model fit complete!`);
    console.log(`Lightweight OLS Model MAE: ${mae.toFixed(5)}`);
    console.log(`Lightweight OLS Model R2: ${r2.toFixed(5)}`);
    
    // Export weights structure
    const outputWeights = {
        global_mean: globalMeanDemand,
        temperature_median: tempMedian,
        target_encodings: {
            geohash: targetEncodings.geohash,
            RoadType: targetEncodings.roadType,
            LargeVehicles: targetEncodings.largeVehicles,
            Landmarks: targetEncodings.landmarks,
            Weather: targetEncodings.weather
        },
        features: [
            "geohash_te",
            "RoadType_te",
            "LargeVehicles_te",
            "Landmarks_te",
            "Weather_te",
            "day",
            "NumberofLanes",
            "Temperature",
            "hour",
            "minute",
            "time_slot",
            "rush_hour",
            "lat",
            "lon",
            "lat_lon_product",
            "lat_squared",
            "lon_squared"
        ],
        // Match names to what python had
        coefficients: {
            "geohash_te": coefficients.geohash_te,
            "RoadType_te": coefficients.roadType_te,
            "LargeVehicles_te": coefficients.largeVehicles_te,
            "Landmarks_te": coefficients.landmarks_te,
            "Weather_te": coefficients.weather_te,
            "day": coefficients.day,
            "NumberofLanes": coefficients.numLanes,
            "Temperature": coefficients.temperature,
            "hour": coefficients.hour,
            "minute": coefficients.minute,
            "time_slot": coefficients.time_slot,
            "rush_hour": coefficients.rush_hour,
            "lat": coefficients.lat,
            "lon": coefficients.lon,
            "lat_lon_product": coefficients.lat_lon_product,
            "lat_squared": coefficients.lat_squared,
            "lon_squared": coefficients.lon_squared
        },
        intercept: intercept,
        map_meta: {
            min_lat: minLat,
            max_lat: maxLat,
            min_lon: minLon,
            max_lon: maxLon,
            center_lat: centerLat,
            center_lon: centerLon
        },
        model_performance: {
            mae: mae,
            r2: r2,
            ensemble_mae_reference: 0.02168,
            ensemble_r2_reference: 0.9515
        }
    };
    
    const outputPath = path.join(__dirname, 'model_weights.json');
    console.log(`Writing model weights to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(outputWeights, null, 2), 'utf-8');
    console.log("Model weights successfully exported!");
}

main();
