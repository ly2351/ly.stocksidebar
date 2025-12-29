import * as vscode from "vscode";
import { StockProvider } from "./stockProvider";

export function activate(context: vscode.ExtensionContext) {
    const stockProvider = new StockProvider();
    vscode.window.registerTreeDataProvider("stockView", stockProvider);

    const commands: [string, (...args: any[]) => any][] = [
        ["ly-stocksidebar.refresh", () => stockProvider.refresh()],
        ["ly-stocksidebar.addStock", () => stockProvider.addStock()],
        ["ly-stocksidebar.moveUp", (s: any) => stockProvider.moveStock(s, -1)],
        ["ly-stocksidebar.moveDown", (s: any) => stockProvider.moveStock(s, 1)],
        ["ly-stocksidebar.moveToTop", (s: any) => stockProvider.moveToEdge(s, "top")],
        ["ly-stocksidebar.moveToBottom", (s: any) => stockProvider.moveToEdge(s, "bottom")],
        ["ly-stocksidebar.deleteStock", (s: any) => stockProvider.deleteStock(s)],
        ["ly-stocksidebar.addToStatusBar", (s: any) => stockProvider.addToStatusBar(s)],
        ["ly-stocksidebar.parentRefresh", () => stockProvider.refresh()],
        ["ly-stocksidebar.parentAddStock", () => stockProvider.addStock()]
    ];

    commands.forEach(([name, cb]) => context.subscriptions.push(vscode.commands.registerCommand(name, cb)));

    let refreshInterval: NodeJS.Timeout | undefined;

    const getConfig = () => {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        return {
            enableAutoRefresh: config.get<boolean>('enableAutoRefresh', true),
            refreshInterval: config.get<number>('refreshInterval', 5000)
        };
    };

    const isMarketOpen = () => {
        const now = new Date();
        const day = now.getDay();
        if (day === 0 || day === 6) return false;
        const h = now.getHours(), m = now.getMinutes();
        return (h === 9 && m >= 30) || (h > 9 && h < 11) || (h === 11 && m <= 30) || (h === 13 && m >= 0) || (h > 13 && h < 15);
    };

    const toggleRefreshInterval = () => {
        const { enableAutoRefresh, refreshInterval: interval } = getConfig();
        if (enableAutoRefresh && isMarketOpen() && !refreshInterval) {
            refreshInterval = setInterval(() => stockProvider.refresh(), interval);
            console.log(`定时器已启用，每${interval}ms刷新一次股票数据。`);
        } else if ((!enableAutoRefresh || !isMarketOpen()) && refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = undefined;
            console.log("定时器已禁用。");
        }
    };

    toggleRefreshInterval();
    setInterval(toggleRefreshInterval, 60000);

    // 监听配置变化
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ly-stocksidebar.enableAutoRefresh') || e.affectsConfiguration('ly-stocksidebar.refreshInterval')) {
            toggleRefreshInterval();
        }
    }));

    console.log("股票监控插件已激活！");
}

export function deactivate() {}
