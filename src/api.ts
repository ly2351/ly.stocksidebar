import axios from "axios";
import { Stock } from "./types";

export async function fetchStockDataByCode(code: string): Promise<Stock[]> {
    try {
        const response = await axios.get(`https://hq.sinajs.cn/list=${code}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                'Connection': 'keep-alive',
                'Referer': 'https://finance.sina.com.cn/'
            },
            responseType: 'arraybuffer'
        });

        const decoder = new TextDecoder('gb18030');
        const data = decoder.decode(new Uint8Array(response.data));
        return parseStockData(data);
    } catch (error) {
        return [];
    }
}

function parseStockData(data: string): Stock[] {
    return data.trim().split('\n').map(line => {
        const match = line.match(/var hq_str_(\w+)="(.+)";/);
        if (!match) return null;
        const stockCode = match[1], vals = match[2].split(',');
        const yestclose = parseFloat(vals[2]), cur = parseFloat(vals[3]);
        const updown = parseFloat((cur - yestclose).toFixed(2));
        const percent = parseFloat(((updown / yestclose) * 100).toFixed(2));
        return {
            name: vals[0],
            code: stockCode,
            updown,
            percent,
            cur,
            high: parseFloat(vals[4]),
            low: parseFloat(vals[5]),
            open: parseFloat(vals[1]),
            yestclose,
            amount: parseFloat(vals[9]),
            time: `${vals[30]} ${vals[31]}`
        } as Stock;
    }).filter((s): s is Stock => s !== null);
}
