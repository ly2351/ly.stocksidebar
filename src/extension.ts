import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as axios from "axios";

interface Stock {
    name: string;
    code: string;
    updown: number;   // 涨跌额
    percent: number;  // 涨跌幅（%）
    cur: number;      // 当前价
    high: number;     // 最高价
    low: number;      // 最低价
    open: number;     // 开盘价
    yestclose: number; // 昨收价
    amount: number;   // 成交额
    time: string;     // 更新时间
}

interface StockBase {
    代码: string;
    名称: string;
}

interface StockIndexItem {
    code: string;
    name: string;
    codeLower: string;
    nameLower: string;
}

///region 注册命令
export function activate(context: vscode.ExtensionContext) {
    const stockProvider = new StockProvider();
    vscode.window.registerTreeDataProvider("stockView", stockProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.refresh", () => stockProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.addStock", () => stockProvider.addStock())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.moveUp", (stock: Stock) => stockProvider.moveUp(stock))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.moveDown", (stock: Stock) => stockProvider.moveDown(stock))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.moveToTop", (stock: Stock) => stockProvider.moveToTop(stock))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.moveToBottom", (stock: Stock) => stockProvider.moveToBottom(stock))
    );


    // 注册右键菜单命令
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.deleteStock", (stock: Stock) => stockProvider.deleteStock(stock))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.addToStatusBar", (stock: Stock) => stockProvider.addToStatusBar(stock))
    );

    // 注册父项的刷新和新增命令
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.parentRefresh", () => stockProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("ly-stocksidebar.parentAddStock", () => stockProvider.addStock())
    );
    // 定义交易时间段
    function isMarketOpen(): boolean {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 (Sunday) to 6 (Saturday)

        // 周末不交易
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return false;
        }

        const hours = now.getHours();
        const minutes = now.getMinutes();

        // 交易时间范围：9:30 - 11:30 和 13:00 - 15:00
        if ((hours === 9 && minutes >= 30) || (hours > 9 && hours < 11) || (hours === 11 && minutes <= 30)) {
            return true;
        }
        if ((hours === 13 && minutes >= 0) || (hours > 13 && hours < 15)) {
            return true;
        }

        return false;
    }

    let refreshInterval: NodeJS.Timeout | undefined;

    // 启用或禁用定时器
    function toggleRefreshInterval() {
        if (isMarketOpen()) {
            if (!refreshInterval) {
                refreshInterval = setInterval(() => stockProvider.refresh(), 5000);
                console.log("定时器已启用，每5秒刷新一次股票数据。");
            }
        } else {
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = undefined;
                console.log("定时器已禁用，当前不在交易时间内。");
            }
        }
    }

    // 初始检查
    toggleRefreshInterval();

    // 每分钟检查一次是否需要启用或禁用定时器
    setInterval(toggleRefreshInterval, 60000);

    console.log("股票监控插件已激活！");
}
///endregion

class StockProvider implements vscode.TreeDataProvider<Stock | { type: 'parent' }> {
    private _onDidChangeTreeData: vscode.EventEmitter<Stock | { type: 'parent' } | undefined> =
        new vscode.EventEmitter<Stock | { type: 'parent' } | undefined>();
    readonly onDidChangeTreeData: vscode.Event<Stock | { type: 'parent' } | undefined> = this._onDidChangeTreeData.event;

    private stocks: Stock[] = [];
    private statusBarStocks: Stock[] = [];
    private statusBarItems: Map<string, vscode.StatusBarItem> = new Map();

    constructor() {
        this.loadStocks();
    }

    getTreeItem(element: Stock | { type: 'parent' }): vscode.TreeItem {
        if ((element as { type: 'parent' }).type === 'parent') {
            const treeItem = new vscode.TreeItem('股票列表', vscode.TreeItemCollapsibleState.Collapsed);
            treeItem.contextValue = 'stockParent';
            return treeItem;
        }
        const stock = element as Stock;
        const { name, code, percent, open, yestclose, cur, high, low, updown, amount, time } = element as Stock;
        const treeItem = new vscode.TreeItem(`${percent >= 0 ? '+' + percent : percent}   ${cur} 「${name}」`);
        treeItem.tooltip = `「今日行情」 ${name}（${code}）\n涨跌：${updown}   百分：${percent}%\n最高：${high}   最低：${low}\n今开：${open}   昨收：${yestclose}\n成交额：${amount}\n更新时间：${time}`;
        // treeItem.command = {
        //     command: "ly-stocksidebar.addToStatusBar",
        //     title: "添加到状态栏",
        //     arguments: [code]
        // };

        // 检查是否是状态栏股票
        const isStatusBarStock = this.statusBarStocks.some(sbStock => sbStock.code === stock.code);
        if (isStatusBarStock) {
            treeItem.contextValue = 'statusBarStock';
        }

        return treeItem;
    }

    getChildren(element?: Stock | { type: 'parent' }): Stock[] | Thenable<Stock[]> {
        if (!element) {
            return [{ type: 'parent' }] as any;
        }
        if ((element as { type: 'parent' }).type === 'parent') {
            return this.stocks;
        }
        return [];
    }

    private initializeStatusBarStocks(): void {
        /// 创建一个临时集合来存储当前需要的状态栏项
        const currentStatusBarStockCodes = new Set<string>();

        this.statusBarStocks.forEach(stock => {
            currentStatusBarStockCodes.add(stock.code);

            const stockInfo = `「${stock.name}」 ${stock.cur}  (${stock.percent >= 0 ? '+' + stock.percent : stock.percent}%)`;
            let statusBarItem = this.statusBarItems.get(stock.code);

            if (!statusBarItem) {
                // 如果状态栏项不存在，则创建新的状态栏项
                statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
                this.statusBarItems.set(stock.code, statusBarItem);
            }

            statusBarItem.text = ` ${stockInfo}`;
            statusBarItem.tooltip = `「今日行情」 ${stock.name}（${stock.code}）\n涨跌：${stock.updown}   百分：${stock.percent}%\n最高：${stock.high}   最低：${stock.low}\n今开：${stock.open}   昨收：${stock.yestclose}\n成交额：${stock.amount}\n更新时间：${stock.time}`;

            // 读取配置中的颜色
            const config = vscode.workspace.getConfiguration('ly-stocksidebar');
            const riseColor = config.get<string>('riseColor', 'LightBlue');
            const fallColor = config.get<string>('fallColor', 'NavajoWhite');

            statusBarItem.color = stock.percent >= 0 ? riseColor : fallColor;
            statusBarItem.show();
        });

        // 移除不再需要的状态栏项
        const itemsToRemove = Array.from(this.statusBarItems.keys()).filter(code => !currentStatusBarStockCodes.has(code));
        itemsToRemove.forEach(code => {
            const item = this.statusBarItems.get(code);
            if (item) {
                item.dispose();
                this.statusBarItems.delete(code);
            }
        });
    }

    async refresh(): Promise<void> {
        await this.loadStocks();
        this._onDidChangeTreeData.fire(undefined); // 修改这里，确保传递 undefined 而不是 void
        console.log("✅ 股票数据已刷新！" + new Date().toLocaleString());
    }

    private async loadStocks(): Promise<void> {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const stockCodes = config.get<string[]>('stocks', []); // 修改为 'ly-stocksidebar.stocks'
        const statusBarStockCodes = config.get<string[]>('statusBarStock', []); // 修改为 'ly-stocksidebar.statusBarStock'

        // 合并股票代码并去重
        const allStockCodes = Array.from(new Set([...stockCodes, ...statusBarStockCodes])).join(',');

        const allStocks = await this.fetchStockDataByCode(allStockCodes);

        // 分离 stocks 和 statusBarStocks
        this.stocks = allStocks.filter(stock => stockCodes.includes(stock.code));
        this.statusBarStocks = allStocks.filter(stock => statusBarStockCodes.includes(stock.code));

        // console.log("✅ 解析后的 stocks:", this.stocks);
        // console.log("✅ 解析后的 statusBarStocks:", this.statusBarStocks);
        // 初始化状态栏股票
        this.initializeStatusBarStocks();
    }

    private async fetchStockDataByCode(code: string): Promise<Stock[]> {
        try {
            console.log(`https://hq.sinajs.cn/list=${code}`);
            const response = await axios.default.get(`https://hq.sinajs.cn/list=${code}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Connection': 'keep-alive',
                    'Referer': 'https://finance.sina.com.cn/'
                },
                responseType: 'arraybuffer'
            });
            // **使用 TextDecoder 进行 GBK 解码**
            const decoder = new TextDecoder('gb18030'); // 适用于 GBK 编码
            const data = decoder.decode(new Uint8Array(response.data));

            // console.log(data); // 打印原始数据
            const stocks = this.parseStockData(data);
            // console.log(stocks); // 打印解析后的股票数据

            return stocks;
        } catch (error) {
            vscode.window.showErrorMessage("获取股票数据失败！");
            console.error("❌ 获取股票数据失败:", error);
            return [];
        }
    }

    async parseStockData(data: string): Promise<Stock[]> {
        const stockLines = data.trim().split('\n');

        return stockLines.map(line => {
            const match = line.match(/var hq_str_(\w+)="(.+)";/);
            if (!match) return null;

            const stockCode = match[1]; // 股票代码
            const stockValues = match[2].split(','); // 股票数据

            // 计算涨跌额和涨跌幅
            const yestclose = parseFloat(stockValues[2]);
            const currentPrice = parseFloat(stockValues[3]);
            const updown = currentPrice - yestclose;
            const percent = (updown / yestclose) * 100;

            return {
                name: stockValues[0],
                code: stockCode,
                updown: parseFloat(updown.toFixed(2)), // 四舍五入
                percent: parseFloat(percent.toFixed(2)), // 百分比
                cur: parseFloat(stockValues[3]), // 当前价
                high: parseFloat(stockValues[4]),
                low: parseFloat(stockValues[5]),
                open: parseFloat(stockValues[1]),
                yestclose,
                amount: parseFloat(stockValues[9]), // 成交额
                time: `${stockValues[30]} ${stockValues[31]}`
            } as Stock;
        }).filter((stock): stock is Stock => stock !== null);
    }

    // 添加股票
    async addStock(this: any): Promise<void> {
        try {
            // 1. 读取股票基础数据
            const allBasePath = path.join(__dirname, "..", "allbase.json");
            const allStocks: StockBase[] = JSON.parse(
                fs.readFileSync(allBasePath, "utf-8")
            );

            // 2. 构建搜索索引（只做一次）
            const stockIndex: StockIndexItem[] = allStocks.map(s => ({
                code: s.代码,
                name: s.名称,
                codeLower: s.代码.toLowerCase(),
                nameLower: s.名称.toLowerCase(),
            }));

            // 3. 创建 QuickPick
            const picker = vscode.window.createQuickPick<vscode.QuickPickItem>();
            picker.placeholder = "请输入股票代码或名称，如：300059 / 东方财富";
            picker.matchOnDescription = false;
            picker.matchOnDetail = false;

            let searchTimer: NodeJS.Timeout | undefined;

            // 4. 输入监听（防抖）
            picker.onDidChangeValue((value) => {
                if (searchTimer) {
                    clearTimeout(searchTimer);
                }

                searchTimer = setTimeout(() => {
                    const keyword = value.trim();
                    if (keyword.length < 2) {
                        picker.items = [];
                        return;
                    }

                    const results = this.searchStocks(keyword, stockIndex)
                        .slice(0, 10)
                        .map((stock: StockIndexItem) => ({
                            label: stock.code,
                            description: `| ${stock.name}`,
                        }));

                    picker.items = results;
                }, 200);
            });

            // 5. 处理选择结果
            picker.onDidAccept(async () => {
                const selected = picker.selectedItems[0];
                if (!selected) return;

                picker.hide();

                let selectedCode = this.normalizeStockCode(selected.label);
                const stocks = await this.fetchStockDataByCode(selectedCode);

                if (stocks && stocks.length > 0) {
                    this.stocks.push(stocks[0]);
                    this.saveStocks();
                    this._onDidChangeTreeData.fire(undefined);
                }
            });

            picker.onDidHide(() => picker.dispose());

            picker.show();
        } catch (error) {
            vscode.window.showErrorMessage("加载股票数据失败，请检查 allbase.json");
            console.error(error);
        }
    }

    searchStocks(
        keyword: string,
        stocks: {
            code: string;
            name: string;
            codeLower: string;
            nameLower: string;
        }[]
    ) {
        const kw = keyword.toLowerCase();

        // 纯数字：优先匹配股票代码（startsWith 更精准）
        if (/^\d+$/.test(kw)) {
            return stocks.filter(s => s.codeLower.startsWith(kw));
        }

        // 包含中文：匹配名称
        if (/[\u4e00-\u9fa5]/.test(kw)) {
            return stocks.filter(s => s.nameLower.includes(kw));
        }

        // 兜底：代码或名称包含
        return stocks.filter(s =>
            s.codeLower.includes(kw) ||
            s.nameLower.includes(kw)
        );
    }

    /// region 上移、下移、置顶、置底、删除、保存
    // 上移股票
    moveUp(stock: Stock) {
        const index = this.stocks.indexOf(stock);
        if (index > 0) {
            [this.stocks[index], this.stocks[index - 1]] = [this.stocks[index - 1], this.stocks[index]];
            this._onDidChangeTreeData.fire(undefined);
            this.saveStocks(); // 保存更新后的股票列表到 settings.json
        }
    }

    // 下移股票
    moveDown(stock: Stock) {
        const index = this.stocks.indexOf(stock);
        if (index < this.stocks.length - 1) {
            [this.stocks[index], this.stocks[index + 1]] = [this.stocks[index + 1], this.stocks[index]];
            this.saveStocks(); // 保存更新后的股票列表到 settings.json
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    // 置顶股票
    moveToTop(stock: Stock) {
        const index = this.stocks.indexOf(stock);
        if (index > 0) {
            this.stocks.splice(index, 1);
            this.stocks.unshift(stock);
            this.saveStocks(); // 保存更新后的股票列表到 settings.json
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    // 置底股票
    moveToBottom(stock: Stock) {
        const index = this.stocks.indexOf(stock);
        if (index < this.stocks.length - 1) {
            this.stocks.splice(index, 1);
            this.stocks.push(stock);
            this.saveStocks(); // 保存更新后的股票列表到 settings.json
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    // 删除股票
    async deleteStock(stock: Stock): Promise<void> {
        if (!stock) return;
        console.log("准备删除的股票:", stock.name);
        const index = this.stocks.findIndex(s => s.code === stock.code);
        if (index === -1) return;

        this.stocks.splice(index, 1);
        this.saveStocks();
        this._onDidChangeTreeData.fire(undefined);
    }

    // 保存更新后的股票列表到 settings.json
    private saveStocks(): void {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const updatedStocks = this.stocks.map(stock => stock.code);
        console.log("准备保存的股票列表:", updatedStocks);

        // 使用 Promise.resolve 包装 Thenable<void>
        Promise.resolve(config.update('stocks', updatedStocks, vscode.ConfigurationTarget.Global))
            .then(() => {
                console.log("✅ 股票列表已成功保存到 settings.json");
            })
            .catch((error) => {
                console.error("❌ 保存股票列表到 settings.json 失败:", error);
            });
    }

    /// endregion

    // 格式化股票代码（SH/ SZ）
    private formatStockCode(code: string): string {
        if (code.startsWith("6")) {
            return `sh${code}`;
        } else {
            return `sz${code}`;
        }
    }

    private normalizeStockCode(code: string): string {
        if (code.endsWith(".SZ")) {
            return `sz${code.slice(0, -3)}`;
        } else if (code.endsWith(".SH")) {
            return `sh${code.slice(0, -3)}`;
        } else {
            return code;
        }
    }

    // 添加股票到状态栏
    async addToStatusBar(stock: Stock): Promise<void> {
        // const stockInfo = `${stock.name} (${stock.code})`;
        // vscode.window.setStatusBarMessage(`📈 ${stockInfo}`, 5000);

        // 更新 settings.json 中的状态栏股票
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        const statusBarStocks = config.get<string[]>('statusBarStock', []);

        // 检查是否已经存在于状态栏股票中
        if (!statusBarStocks.includes(stock.code)) {
            statusBarStocks.push(stock.code);
            await Promise.resolve(config.update('statusBarStock', statusBarStocks, vscode.ConfigurationTarget.Global))
                .then(() => {
                    console.log("✅ 状态栏股票已成功添加到 settings.json");
                })
                .catch((error) => {
                    console.error("❌ 添加状态栏股票到 settings.json 失败:", error);
                });

            // 重新加载 stocks 和 statusBarStocks
            await this.loadStocks();
        } else {
            vscode.window.showInformationMessage(`股票 ${stock.name} 已经存在于状态栏中。`);
        }
    }
}