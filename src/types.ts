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
