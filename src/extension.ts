import * as vscode from "vscode";
import { StockProvider } from "./stockProvider";
import { fetchNews } from "./api";

export async function activate(context: vscode.ExtensionContext) {
    const stockProvider = new StockProvider(context);
    await stockProvider.refresh();
    vscode.window.registerTreeDataProvider("stockView", stockProvider);

    let maxId = 0; // 跟踪最大的新闻 ID

    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel('淘金助手');
    context.subscriptions.push(outputChannel);

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
    let timeOutputInterval: NodeJS.Timeout | undefined;

    const getConfig = () => {
        const config = vscode.workspace.getConfiguration('ly-stocksidebar');
        return {
            enableAutoRefresh: config.get<boolean>('enableAutoRefresh', true),
            refreshInterval: config.get<number>('refreshInterval', 5000),
            enableOutputChannel: config.get<boolean>('enableOutputChannel', true),
            outputInterval: config.get<number>('outputInterval', 20000)
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
            refreshInterval = setInterval(() => {
                stockProvider.refresh();
                // outputChannel.appendLine(`[${new Date().toLocaleString()}] 股票数据已刷新`);
            }, interval);
            console.log(`定时器已启用，每${interval}ms刷新一次股票数据。`);
        } else if ((!enableAutoRefresh || !isMarketOpen()) && refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = undefined;
            console.log("定时器已禁用。");
        }
    };

    const toggleOutputInterval = () => {
        const { enableOutputChannel, outputInterval: interval } = getConfig();
        if (enableOutputChannel && !timeOutputInterval) {
            timeOutputInterval = setInterval(async () => {
                const news = await fetchNews();
                let newMaxId = maxId;
                const newNews = news.filter(msg => {
                    if (msg.id > maxId) {
                        newMaxId = Math.max(newMaxId, msg.id);
                        return true;
                    }
                    return false;
                });
                maxId = newMaxId;

                if (newNews.length > 0) {
                    // 反转时间轴：按时间升序输出（最旧的先）
                    newNews.reverse().forEach((msg) => {
                        let impactStr = '';
                        let bkjStr = '';
                        let summaryStr = '';

                        if (msg.impact !== 0) {
                            impactStr = msg.impact === 1
                                ? '【利多 🚀️ 】'
                                : '【利空 🍜️ 】';
                        }

                        if (msg.summary) {
                            summaryStr = `${msg.summary}\r\n`;
                        }

                        if (msg.bkj_infos?.length) {
                            bkjStr =
                                `相关板块：${msg.bkj_infos
                                    .map(bkj => `[${bkj.name}]`)
                                    .join(' - ')}\r\n`;
                        }

                        const timeStr = new Date(msg.created_at * 1000).toLocaleString();

                        outputChannel.appendLine(
                            `${msg.title} ${impactStr}\r\n` +
                            `${summaryStr}` +
                            `${bkjStr}` +
                            `[XGB - ${timeStr}]\r\n` +
                            '--------------------------------------------------'
                        );
                    });

                    outputChannel.show(true);
                }
            }, interval);
            console.log(`输出通道定时器已启用，每${interval}ms刷新一次新闻。`);
        } else if (!enableOutputChannel && timeOutputInterval) {
            clearInterval(timeOutputInterval);
            timeOutputInterval = undefined;
            console.log("输出通道定时器已禁用。");
        }
    };

    context.subscriptions.push({ dispose: () => { if (timeOutputInterval) clearInterval(timeOutputInterval); } });

    toggleRefreshInterval();
    setInterval(toggleRefreshInterval, 60000);

    toggleOutputInterval();

    // 监听配置变化
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ly-stocksidebar.enableAutoRefresh') || e.affectsConfiguration('ly-stocksidebar.refreshInterval')) {
            toggleRefreshInterval();
        }
        if (e.affectsConfiguration('ly-stocksidebar.enableOutputChannel') || e.affectsConfiguration('ly-stocksidebar.outputInterval')) {
            toggleOutputInterval();
        }
    }));

    console.log("股票监控插件已激活！");
}

export function deactivate() { }
