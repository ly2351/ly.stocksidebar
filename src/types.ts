export interface Stock {
    name: string;
    code: string;
    updown: number;
    percent: number;
    cur: number;
    high: number;
    low: number;
    open: number;
    yestclose: number;
    amount: number;
    time: string;
}

export interface StockBase { 代码: string; 名称: string; }

export interface StockIndexItem {
    code: string;
    name: string;
    codeLower: string;
    nameLower: string;
}

interface StockRef {
    name: string;
    symbol: string;
    market: string;
}

export interface NewsItem {
    id: number;
    title: string;
    summary: string;
    impact: number;
    route: string;
    created_at: number;
    stocks: StockRef[];
    all_stocks: StockRef[];
    subj_ids: number[];
    bkj_infos?: any[];
    // 可根据需要添加更多字段
}

