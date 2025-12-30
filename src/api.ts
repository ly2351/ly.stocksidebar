import * as iconv from 'iconv-lite';
import { Stock, NewsItem } from "./types";

export async function fetchStockDataByCode(code: string): Promise<Stock[]> {
    try {
        const response = await fetch(`https://hq.sinajs.cn/list=${code}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                'Connection': 'keep-alive',
                'Referer': 'https://finance.sina.com.cn/'
            }
        });

        if (!response.ok) return [];

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const data = iconv.decode(buffer, 'gb18030');
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

export async function fetchNews(): Promise<NewsItem[]> {
    try {
        const response = await fetch('https://baoer-api.xuangubao.cn/api/v6/message/newsflash?limit=20&subj_ids=9,10,723,35,469&platform=pcweb', {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://xuangubao.cn/',
                'Origin': 'https://xuangubao.cn'
            }
        });

        if (!response.ok) return [];

        const data = await response.json() as { data: { messages: NewsItem[] } };
        const news = data.data?.messages || [];
        console.log(`[API] 获取到 ${news.length} 条新闻数据`);
        return news;
    } catch (error) {
        console.error('[API] 获取新闻数据失败:', error);
        return [];
    }
}
