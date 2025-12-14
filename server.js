import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import axios from 'axios';
import path from 'path';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8881;

app.use(express.static('public'));

let cachedData = [];
let spotSymbols = [];
let spotSymbolSet = new Set();
let futuresExchangeInfo = new Map();

// Cache for Binance market data
const binanceMarketData = new Map();

async function fetchSpotSymbols() {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        spotSymbols = response.data.symbols
            .filter(s => s.status === 'TRADING')
            .map(s => s.symbol);
        spotSymbolSet = new Set(spotSymbols);
        console.log(`Fetched ${spotSymbols.length} spot symbols from Binance`);
    } catch (error) {
        console.error('Error fetching Binance spot symbols:', error);
    }
}

async function fetchFuturesExchangeInfo() {
    try {
        const response = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        response.data.symbols.forEach(s => {
            if (s.contractType === 'PERPETUAL') {
                futuresExchangeInfo.set(s.symbol, { baseAsset: s.baseAsset, quoteAsset: s.quoteAsset });
            }
        });
        console.log(`Fetched ${futuresExchangeInfo.size} perpetual futures symbols from Binance`);
    } catch (error) {
        console.error('Error fetching Binance futures exchange info:', error);
    }
}

async function updateBinanceMarketData() {
    console.log('Fetching market data from Binance...');
    try {
        const response = await axios.get('https://www.binance.com/bapi/composite/v1/public/marketing/symbol/list');
        const entries = response.data?.data || [];
        binanceMarketData.clear();

        for (const item of entries) {
            if (!item?.symbol) continue;
            binanceMarketData.set(item.symbol.toUpperCase(), {
                market_cap: Number(item.marketCap) || 0,
                fdv: Number(item.fullyDilutedMarketCap) || 0,
                mapperName: item.mapperName || null,
            });
        }

        console.log(`Updated Binance market data cache with ${binanceMarketData.size} entries.`);
    } catch (error) {
        console.error('Error fetching Binance market data:', error.message);
    }
}

function resolveSpotInfo({ baseAsset, quoteAsset = 'USDT', symbol }) {
    const candidate = `${baseAsset}${quoteAsset}`;
    if (spotSymbolSet.has(candidate)) {
        return { spotBase: baseAsset, spotSymbol: candidate };
    }

    const trimmedBase = baseAsset.replace(/^[0-9]+/, '');
    if (trimmedBase && trimmedBase !== baseAsset) {
        const trimmedCandidate = `${(trimmedBase)}${quoteAsset}`;
        if (spotSymbolSet.has(trimmedCandidate)) {
            return { spotBase: trimmedBase, spotSymbol: trimmedCandidate };
        }
    }

    const mapperName = binanceMarketData.get(symbol)?.mapperName;
    if (mapperName) {
        const mapperCandidate = `${mapperName}${quoteAsset}`;
        if (spotSymbolSet.has(mapperCandidate)) {
            return { spotBase: mapperName, spotSymbol: mapperCandidate };
        }
    }

    return null;
}


// Fetch data from Binance and CoinGecko
async function fetchData() {
    try {
        const [tickers, fundingRates] = await Promise.all([
            axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr'),
            axios.get('https://fapi.binance.com/fapi/v1/premiumIndex')
        ]);

        const tickersData = tickers.data;
        const fundingRatesData = fundingRates.data.reduce((acc, fr) => {
            acc[fr.symbol] = fr;
            return acc;
        }, {});
        
        const combinedData = tickersData.map(ticker => {
            const fundingRateInfo = fundingRatesData[ticker.symbol];
            const exchangeInfo = futuresExchangeInfo.get(ticker.symbol);
            const baseAsset = exchangeInfo ? exchangeInfo.baseAsset : ticker.symbol.replace('USDT', '');
            
            const spotInfo = resolveSpotInfo({ baseAsset, quoteAsset: exchangeInfo?.quoteAsset || 'USDT', symbol: ticker.symbol });
            const hasSpot = Boolean(spotInfo);
            const marketSymbol = spotInfo?.spotSymbol || ticker.symbol;
            const marketInfo = binanceMarketData.get(marketSymbol);
            const spotUrl = hasSpot ? `https://www.binance.com/zh-CN/trade/${spotInfo.spotBase}_USDT?type=spot` : null;

            return {
                symbol: ticker.symbol,
                name: baseAsset,
                price: parseFloat(ticker.lastPrice),
                change24h: parseFloat(ticker.priceChangePercent),
                fundingRate: fundingRateInfo ? parseFloat(fundingRateInfo.lastFundingRate) : 0,
                market_cap: marketInfo?.market_cap || 0,
                fdv: marketInfo?.fdv || 0,
                hasSpot,
                spotUrl
            };
        }).filter(d => d.symbol.endsWith('USDT')); // Only show USDT pairs for now

        cachedData = combinedData;

        // Broadcast data to all connected clients
        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(JSON.stringify(cachedData));
            }
        });

    } catch (error) {
        // It's better to not log the whole error object which can be huge
        if (error.response) {
            console.error('Error fetching data:', error.response.status, error.response.statusText);
        } else {
            console.error('Error fetching data:', error.message);
        }
    }
}

// WebSocket connection handler
wss.on('connection', ws => {
    console.log('Client connected');
    ws.send(JSON.stringify(cachedData)); // Send initial data on connection
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Serve index.html for any other requests
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Initial data fetches
async function init() {
    await fetchSpotSymbols();
    await fetchFuturesExchangeInfo();
    await updateBinanceMarketData(); // Initial fetch
    await fetchData(); 

    setInterval(fetchData, 1000); // Fetch frequently changing data
    setInterval(updateBinanceMarketData, 5 * 60 * 1000); // Update Binance market data every 5 minutes
}

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    init();
});
