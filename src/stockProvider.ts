import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Stock, StockBase, StockIndexItem } from "./types";
import { fetchStockDataByCode } from "./api";

export class StockProvider implements vscode.TreeDataProvider<Stock | { type: 'parent' }> {
    private _onDidChangeTreeData = new vscode.EventEmitter<Stock | { type: 'parent' } | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private stocks: Stock[] = [];
    private statusBarStocks: Stock[] = [];
    private statusBarItems: Map<string, vscode.StatusBarItem> = new Map();

    constructor() { this.loadStocks(); }

    getTreeItem(element: Stock | { type: 'parent' }): vscode.TreeItem {
        if ("type" in element && element.type === 'parent') {
            const treeItem = new vscode.TreeItem('股票列表', vscode.TreeItemCollapsibleState.Expanded);
            treeItem.contextValue = 'stockParent';
            return treeItem;
        }
        const s = element as Stock;
        const treeItem = new vscode.TreeItem(`${s.percent >= 0 ? '+' + s.percent : s.percent}%  ${s.cur}  ${s.name}`);
        treeItem.id = s.code;
        treeItem.contextValue = 'stock';
        treeItem.iconPath = s.percent >= 0 ? 'arrow-up' : 'arrow-down';
        treeItem.tooltip = `**${s.name} (${s.code})**\n- 涨跌：${s.updown}\n- 涨幅：${s.percent}%\n- 最高：${s.high}\n- 最低：${s.low}\n- 成交额：${s.amount}\n- 更新时间：${s.time}`;
        if (this.statusBarStocks.some(sb => sb.code === s.code)) treeItem.contextValue = 'statusBarStock';
        return treeItem;
    }

    getChildren(element?: Stock | { type: 'parent' }): Stock[] | Thenable<Stock[]> {
        if (!element) return [{ type: 'parent' }] as any;
        if ("type" in element && element.type === 'parent') {
            if (this.stocks.length === 0) {
                return this.loadStocks().then(() => this.stocks);
            }
            return this.stocks;
        }
        return [];
    }

    private initializeStatusBarStocks(): void {
        const currentCodes = new Set(this.stocks.map((s: Stock) => s.code));
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const riseColor = config.get<string>('riseColor', 'LightBlue');
        const fallColor = config.get<string>('fallColor', 'NavajoWhite');

        this.statusBarStocks.forEach(s => {
            let item = this.statusBarItems.get(s.code);
            if (!item) {
                item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
                this.statusBarItems.set(s.code, item);
            }
            item.text = `「${s.name}」 ${s.cur}  (${s.percent >= 0 ? '+' + s.percent : s.percent}%)`;
            item.tooltip = `「今日行情」 ${s.name}（${s.code}）\n涨跌：${s.updown}   百分：${s.percent}%\n最高：${s.high}   最低：${s.low}\n今开：${s.open}   昨收：${s.yestclose}\n成交额：${s.amount}\n更新时间：${s.time}`;
            item.color = s.percent >= 0 ? riseColor : fallColor;
            item.show();
        });

        Array.from(this.statusBarItems.keys())
            .filter(code => !currentCodes.has(code))
            .forEach(code => { this.statusBarItems.get(code)?.dispose(); this.statusBarItems.delete(code); });
    }

    async refresh(): Promise<void> {
        await this.loadStocks();
        this._onDidChangeTreeData.fire(undefined);
        console.log("✅ 股票数据已刷新！" + new Date().toLocaleString());
    }

    private async loadStocks(): Promise<void> {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const stockCodes = config.get<string[]>('stocks', []);
        const statusBarCodes = config.get<string[]>('statusBarStock', []);
        const allCodes = Array.from(new Set([...stockCodes, ...statusBarCodes])).join(',');

        const allStocks = await fetchStockDataByCode(allCodes);
        this.stocks = allStocks.filter(s => stockCodes.includes(s.code));
        this.statusBarStocks = allStocks.filter(s => statusBarCodes.includes(s.code));

        this.initializeStatusBarStocks();
    }

    private searchStocks(keyword: string, stocks: StockIndexItem[]) {
        const kw = keyword.toLowerCase();
        if (/^\d+$/.test(kw)) return stocks.filter(s => s.codeLower.startsWith(kw));
        if (/[\u4e00-\u9fa5]/.test(kw)) return stocks.filter(s => s.nameLower.includes(kw));
        return stocks.filter(s => s.codeLower.includes(kw) || s.nameLower.includes(kw));
    }

    async addStock(): Promise<void> {
        try {
            const allBasePath = path.join(__dirname, "..", "allbase.json");
            const allStocks: StockBase[] = JSON.parse(fs.readFileSync(allBasePath, "utf-8"));
            const stockIndex = allStocks.map(s => ({
                code: s.代码, name: s.名称, codeLower: s.代码.toLowerCase(), nameLower: s.名称.toLowerCase()
            }));

            const picker = vscode.window.createQuickPick<vscode.QuickPickItem>();
            picker.placeholder = "请输入股票代码或名称，如：300059 / 东方财富";

            let timer: NodeJS.Timeout | undefined;
            picker.onDidChangeValue(value => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    const kw = value.trim();
                    if (kw.length < 2) { picker.items = []; return; }
                    picker.items = this.searchStocks(kw, stockIndex)
                        .slice(0, 10)
                        .map(s => ({ label: s.code, description: `| ${s.name}` }));
                }, 200);
            });

            picker.onDidAccept(async () => {
                const selected = picker.selectedItems[0];
                if (!selected) return picker.hide();
                picker.hide();
                const stocks = await fetchStockDataByCode(this.normalizeStockCode(selected.label));
                if (stocks.length) { this.stocks.push(stocks[0]); this.saveStocks(); this._onDidChangeTreeData.fire(undefined); }
            });

            picker.onDidHide(() => picker.dispose());
            picker.show();
        } catch (error) {
            vscode.window.showErrorMessage("加载股票数据失败，请检查 allbase.json");
            console.error(error);
        }
    }

    moveStock(stock: Stock, delta: number) {
        const idx = this.stocks.indexOf(stock);
        if (idx === -1) return;
        const newIdx = idx + delta;
        if (newIdx < 0 || newIdx >= this.stocks.length) return;
        [this.stocks[idx], this.stocks[newIdx]] = [this.stocks[newIdx], this.stocks[idx]];
        this._onDidChangeTreeData.fire(undefined);
        this.saveStocks();
    }

    moveToEdge(stock: Stock, edge: "top" | "bottom") {
        const idx = this.stocks.indexOf(stock);
        if (idx === -1) return;
        this.stocks.splice(idx, 1);
        edge === "top" ? this.stocks.unshift(stock) : this.stocks.push(stock);
        this._onDidChangeTreeData.fire(undefined);
        this.saveStocks();
    }

    async deleteStock(stock: Stock) {
        const idx = this.stocks.findIndex(s => s.code === stock.code);
        if (idx === -1) return;
        this.stocks.splice(idx, 1);
        this._onDidChangeTreeData.fire(undefined);
        this.saveStocks();
    }

    private saveStocks() {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const codes = this.stocks.map(s => s.code);
        config.update('stocks', codes, vscode.ConfigurationTarget.Global)
            .then(() => console.log("✅ 股票列表已保存"), (err: any) => console.error("❌ 保存股票列表失败:", err));
    }

    private normalizeStockCode(code: string) {
        if (code.endsWith(".SZ")) return `sz${code.slice(0, -3)}`;
        if (code.endsWith(".SH")) return `sh${code.slice(0, -3)}`;
        return code;
    }

    async addToStatusBar(stock: Stock) {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const statusBar = config.get<string[]>('statusBarStock', []);
        if (!statusBar.includes(stock.code)) {
            statusBar.push(stock.code);
            await config.update('statusBarStock', statusBar, vscode.ConfigurationTarget.Global);
            await this.loadStocks();
        } else {
            vscode.window.showInformationMessage(`股票 ${stock.name} 已经存在于状态栏中。`);
        }
    }
}
